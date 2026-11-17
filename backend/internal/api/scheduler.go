package api

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

// Sincronização automática diária de todas as listas.
//
// Às DAILY_SYNC_AT (padrão 03:00, horário local do processo — no Docker defina TZ)
// todas as listas são sincronizadas. As que falharem são tentadas de novo alguns
// minutos depois e, se falharem outra vez, são apagadas. Para não apagar tudo por
// causa de uma queda da internet local, nada é apagado se a conectividade com a
// internet não for confirmada antes de cada etapa.

const (
	dailyConcurrency = 6
	dailyRetryDelay  = 3 * time.Minute
)

// DailySyncReport resume a última execução automática.
type DailySyncReport struct {
	StartedAt  int64  `json:"startedAt"`  // unix ms
	FinishedAt int64  `json:"finishedAt"` // unix ms
	Total      int    `json:"total"`
	OK         int    `json:"ok"`
	Removed    int    `json:"removed"`
	Kept       int    `json:"kept"` // falharam mas não foram apagadas (sem internet)
	Note       string `json:"note,omitempty"`
}

type dailySyncState struct {
	mu      sync.Mutex
	enabled bool
	at      string // "HH:MM"
	hour    int
	minute  int
	next    time.Time
	running bool
	phase   string // "sync" | "waiting" | "retry"
	done    int
	total   int
	last    *DailySyncReport
}

// StartDailySync inicia o agendador. `at` no formato HH:MM; "off" desativa.
func (a *APIHandler) StartDailySync(at string) {
	at = strings.TrimSpace(at)
	switch strings.ToLower(at) {
	case "off", "false", "0", "disabled":
		log.Printf("  ➜ Sync diário: desativado (DAILY_SYNC_AT=%s)", at)
		return
	}
	var h, m int
	if _, err := fmt.Sscanf(at, "%d:%d", &h, &m); err != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		log.Printf("  ➜ Sync diário: horário inválido %q, usando 03:00", at)
		h, m = 3, 0
	}

	st := &a.daily
	st.mu.Lock()
	st.enabled = true
	st.hour, st.minute = h, m
	st.at = fmt.Sprintf("%02d:%02d", h, m)
	st.next = nextDailyRun(time.Now(), h, m)
	next := st.next
	st.mu.Unlock()

	log.Printf("  ➜ Sync diário: todo dia às %02d:%02d (próximo: %s)", h, m, next.Format("02/01 15:04 MST"))

	// Checa a cada 30s em vez de um timer longo: continua correto após o
	// computador hibernar ou o relógio do sistema ser ajustado.
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for now := range t.C {
			st.mu.Lock()
			due := !now.Before(st.next)
			if due {
				st.next = nextDailyRun(now, st.hour, st.minute)
			}
			st.mu.Unlock()
			if due {
				a.RunDailySync()
			}
		}
	}()
}

func nextDailyRun(now time.Time, h, m int) time.Time {
	t := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
	if !t.After(now) {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

// internetOK confirma que a máquina tem saída para a internet, para que uma queda
// local não seja confundida com listas quebradas.
func internetOK() bool {
	for _, addr := range []string{"1.1.1.1:443", "8.8.8.8:53", "208.67.222.222:443"} {
		if c, err := net.DialTimeout("tcp", addr, 5*time.Second); err == nil {
			c.Close()
			return true
		}
	}
	return false
}

// RunDailySync sincroniza todas as listas e apaga as que falharem duas vezes.
func (a *APIHandler) RunDailySync() {
	st := &a.daily
	st.mu.Lock()
	if st.running {
		st.mu.Unlock()
		log.Printf("  ➜ Sync diário: já está em andamento, ignorando.")
		return
	}
	st.running = true
	st.phase = "sync"
	st.done, st.total = 0, 0
	st.mu.Unlock()

	report := &DailySyncReport{StartedAt: time.Now().UnixMilli()}
	defer func() {
		report.FinishedAt = time.Now().UnixMilli()
		st.mu.Lock()
		st.running = false
		st.phase = ""
		st.last = report
		st.mu.Unlock()
		a.proxy.InvalidateCache()
		log.Printf("  ➜ Sync diário concluído: %d lista(s) · %d ok · %d apagada(s) · %d mantida(s) com erro. %s",
			report.Total, report.OK, report.Removed, report.Kept, report.Note)
	}()

	if !internetOK() {
		report.Note = "Sem conexão com a internet; sincronização adiada para amanhã."
		return
	}

	ids, err := a.database.GetServerIDs()
	if err != nil {
		report.Note = "Falha ao listar servidores: " + err.Error()
		return
	}
	report.Total = len(ids)
	if len(ids) == 0 {
		return
	}
	log.Printf("  ➜ Sync diário: sincronizando %d lista(s)...", len(ids))

	progress := func(SyncBatchResultItem) {
		st.mu.Lock()
		st.done++
		st.mu.Unlock()
	}

	// 1ª passada: só marca erro
	st.mu.Lock()
	st.total = len(ids)
	st.mu.Unlock()
	var failed []int64
	for _, r := range a.syncMany(ids, false, dailyConcurrency, progress) {
		if r.Success {
			report.OK++
		} else {
			failed = append(failed, r.ID)
		}
	}
	a.proxy.InvalidateCache()
	if len(failed) == 0 {
		return
	}

	// 2ª passada, depois de um intervalo: quem falhar de novo é apagado
	log.Printf("  ➜ Sync diário: %d lista(s) falharam; nova tentativa em %s.", len(failed), dailyRetryDelay)
	st.mu.Lock()
	st.phase = "waiting"
	st.mu.Unlock()
	time.Sleep(dailyRetryDelay)

	if !internetOK() {
		report.Kept = len(failed)
		report.Note = "Sem conexão com a internet na nova tentativa; nenhuma lista foi apagada."
		return
	}

	st.mu.Lock()
	st.phase = "retry"
	st.done, st.total = 0, len(failed)
	st.mu.Unlock()
	for _, r := range a.syncMany(failed, true, dailyConcurrency, progress) {
		if r.Success {
			report.OK++
		} else {
			report.Removed++
			log.Printf("  ✕ Sync diário: servidor #%d apagado (%s)", r.ID, r.Message)
		}
	}
}

// DailySyncStatus expõe o agendamento e o andamento para o painel.
func (a *APIHandler) DailySyncStatus(w http.ResponseWriter, r *http.Request) {
	st := &a.daily
	st.mu.Lock()
	defer st.mu.Unlock()

	resp := map[string]interface{}{
		"enabled": st.enabled,
		"at":      st.at,
		"running": st.running,
		"phase":   st.phase,
		"done":    st.done,
		"total":   st.total,
		"lastRun": st.last,
	}
	if st.enabled {
		resp["nextRun"] = st.next.UnixMilli()
	}
	sendJSON(w, http.StatusOK, resp)
}

// DailySyncAtFromEnv lê DAILY_SYNC_AT (padrão 03:00).
func DailySyncAtFromEnv() string {
	if v, ok := os.LookupEnv("DAILY_SYNC_AT"); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return "03:00"
}
