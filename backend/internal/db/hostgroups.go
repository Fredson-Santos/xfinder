package db

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

// Contas Xtream do mesmo host (mesmo painel) têm praticamente o mesmo catálogo
// e os mesmos stream_id — só mudam usuário/senha e vencimento. A busca então
// varre só uma conta "representante" por host e anexa as demais como fontes
// extras (failover entre contas), em vez de varrer o catálogo de todas.

// hostAccount é uma conta online, com o necessário para montar a URL de stream.
type hostAccount struct {
	id                                     int64
	name, sType                            string
	host, port, username, password, expiry sql.NullString
	mediaCount                             int
}

type hostGroups struct {
	gen      uint64                  // geração do banco em que foi montado
	reps     []int64                 // uma conta por host (a de catálogo mais completo)
	accounts map[int64][]hostAccount // representante → contas do grupo (representante primeiro)
}

// HostKey normaliza o host de uma conta Xtream para "host:porta".
// "http://123ev.vip:80" (porta vazia) e "123ev.vip" (porta 80) dão a mesma chave.
func HostKey(host, port string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	defPort := "80"
	switch {
	case strings.HasPrefix(h, "https://"):
		h, defPort = h[len("https://"):], "443"
	case strings.HasPrefix(h, "http://"):
		h = h[len("http://"):]
	}
	if i := strings.IndexAny(h, "/?#"); i >= 0 {
		h = h[:i]
	}
	if i := strings.LastIndex(h, ":"); i >= 0 {
		if p := h[i+1:]; p != "" {
			port = p
		}
		h = h[:i]
	}
	port = strings.TrimSpace(port)
	if port == "" {
		port = defPort
	}
	return h + ":" + port
}

// invalidateGroups descarta o agrupamento em cache; chamado por toda escrita
// que muda servidores, status ou catálogos.
// A geração evita que uma leitura feita durante a escrita (leituras não travam)
// deixe em cache um agrupamento já desatualizado.
func (d *DB) invalidateGroups() { d.groupsGen.Add(1); d.groups.Store(nil) }

// loadHostGroups devolve o agrupamento atual (em cache até a próxima escrita).
func (d *DB) loadHostGroups() (*hostGroups, error) {
	gen := d.groupsGen.Load()
	if g := d.groups.Load(); g != nil && g.gen == gen {
		return g, nil
	}

	rows, err := d.conn.Query(`
		SELECT s.id, s.name, s.type, s.host, s.port, s.username, s.password, s.expiry,
		       (SELECT count(*) FROM media m WHERE m.server_id = s.id)
		FROM servers s
		WHERE s.status = 'ok'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byKey := map[string][]hostAccount{}
	for rows.Next() {
		var a hostAccount
		if err := rows.Scan(&a.id, &a.name, &a.sType, &a.host, &a.port, &a.username, &a.password, &a.expiry, &a.mediaCount); err != nil {
			return nil, err
		}
		key := fmt.Sprintf("id:%d", a.id) // M3U / sem host: não agrupa
		if a.sType == "xtream" && a.host.Valid && strings.TrimSpace(a.host.String) != "" {
			key = HostKey(a.host.String, a.port.String)
		}
		byKey[key] = append(byKey[key], a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	g := &hostGroups{gen: gen, accounts: map[int64][]hostAccount{}}
	for _, accs := range byKey {
		// Representante: catálogo mais completo; empate → vence mais tarde; depois menor id.
		// As demais seguem por vencimento (mais longo primeiro) — ordem do failover.
		sort.SliceStable(accs, func(i, j int) bool {
			a, b := accs[i], accs[j]
			if a.mediaCount != b.mediaCount {
				return a.mediaCount > b.mediaCount
			}
			if a.expiry.String != b.expiry.String {
				return a.expiry.String > b.expiry.String
			}
			return a.id < b.id
		})
		rep := accs[0]
		rest := append([]hostAccount(nil), accs[1:]...)
		sort.SliceStable(rest, func(i, j int) bool { return rest[i].expiry.String > rest[j].expiry.String })
		if rep.mediaCount == 0 {
			continue // nenhum catálogo sincronizado neste host
		}
		g.reps = append(g.reps, rep.id)
		g.accounts[rep.id] = append([]hostAccount{rep}, rest...)
	}
	sort.Slice(g.reps, func(i, j int) bool { return g.reps[i] < g.reps[j] })

	if d.groupsGen.Load() == gen {
		d.groups.Store(g)
	}
	return g, nil
}
