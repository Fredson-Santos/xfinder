package api

import (
	"context"
	"os/exec"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"xfinder/internal/db"
	"xfinder/internal/m3u"
	"xfinder/internal/models"
	"xfinder/internal/proxy"
	"xfinder/internal/xtream"
)

type APIHandler struct {
	database *db.DB
	proxy    *proxy.ProxyHandler
}

func NewAPIHandler(database *db.DB, prx *proxy.ProxyHandler) *APIHandler {
	return &APIHandler{
		database: database,
		proxy:    prx,
	}
}

func sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func sendError(w http.ResponseWriter, status int, msg string) {
	sendJSON(w, status, map[string]string{"error": msg})
}

func (a *APIHandler) ListServers(w http.ResponseWriter, r *http.Request) {
	servers, err := a.database.GetServers()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if servers == nil {
		servers = []models.Server{}
	}
	sendJSON(w, http.StatusOK, servers)
}

type AddServerRequest struct {
	Name       string  `json:"name"`
	ServerType string  `json:"serverType"`
	Host       *string `json:"host"`
	Port       *string `json:"port"`
	Username   *string `json:"username"`
	Password   *string `json:"password"`
	M3UUrl     *string `json:"m3uUrl"`
	Expiry     *string `json:"expiry"`
}

func (a *APIHandler) AddServer(w http.ResponseWriter, r *http.Request) {
	var req AddServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "JSON inválido")
		return
	}

	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.ServerType) == "" {
		sendError(w, http.StatusBadRequest, "name e serverType são obrigatórios")
		return
	}

	s := &models.Server{
		Name:     req.Name,
		Type:     req.ServerType,
		Host:     req.Host,
		Port:     req.Port,
		Username: req.Username,
		Password: req.Password,
		M3UUrl:   req.M3UUrl,
		Expiry:   req.Expiry,
	}

	id, err := a.database.InsertServer(s)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]int64{"id": id})
}

type BatchServerItem struct {
	Name       string  `json:"name"`
	ServerType string  `json:"serverType"`
	Host       *string `json:"host"`
	Port       *string `json:"port"`
	Username   *string `json:"username"`
	Password   *string `json:"password"`
	M3UUrl     *string `json:"m3uUrl"`
	Expiry     *string `json:"expiry"`
}

type BatchRequest struct {
	Servers []BatchServerItem `json:"servers"`
}

func (a *APIHandler) AddServersBatch(w http.ResponseWriter, r *http.Request) {
	var req BatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "JSON inválido")
		return
	}

	if len(req.Servers) == 0 {
		sendError(w, http.StatusBadRequest, "Nenhum servidor fornecido")
		return
	}

	type CreatedServer struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	}

	var created []CreatedServer
	for _, item := range req.Servers {
		if strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.ServerType) == "" {
			continue
		}
		s := &models.Server{
			Name:     item.Name,
			Type:     item.ServerType,
			Host:     item.Host,
			Port:     item.Port,
			Username: item.Username,
			Password: item.Password,
			M3UUrl:   item.M3UUrl,
			Expiry:   item.Expiry,
		}
		id, err := a.database.InsertServer(s)
		if err == nil {
			created = append(created, CreatedServer{ID: id, Name: item.Name})
		}
	}

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"servers": created,
		"count":   len(created),
	})
}

func (a *APIHandler) DeleteServer(w http.ResponseWriter, r *http.Request, idStr string) {
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		sendError(w, http.StatusBadRequest, "ID inválido")
		return
	}

	if err := a.database.DeleteServer(id); err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	a.proxy.InvalidateCache()
	sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type DeleteBatchRequest struct {
	ServerIDs []int64 `json:"serverIds"`
}

// DeleteServersBatch remove vários servidores (e seus conteúdos) de uma vez
func (a *APIHandler) DeleteServersBatch(w http.ResponseWriter, r *http.Request) {
	var req DeleteBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	if len(req.ServerIDs) == 0 {
		sendError(w, http.StatusBadRequest, "Nenhum servidor fornecido")
		return
	}

	removed := 0
	for _, id := range req.ServerIDs {
		if err := a.database.DeleteServer(id); err == nil {
			removed++
		}
	}
	a.proxy.InvalidateCache()
	sendJSON(w, http.StatusOK, map[string]int{"removed": removed})
}

func (a *APIHandler) CleanupExpired(w http.ResponseWriter, r *http.Request) {
	removed, err := a.database.CleanExpiredServers()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.proxy.InvalidateCache()
	sendJSON(w, http.StatusOK, map[string]interface{}{
		"ok":      true,
		"removed": removed,
	})
}

// SyncServerInternal executa a lógica de sincronização para um servidor
func (a *APIHandler) SyncServerInternal(id int64, deleteOnError bool) (string, error) {
	server, err := a.database.GetServerByID(id)
	if err != nil || server == nil {
		return "", fmt.Errorf("servidor %d não encontrado", id)
	}

	a.database.UpdateServerStatus(id, "syncing")

	var mediaList []models.Media
	var syncErr error

	if server.Type == "xtream" {
		host := ""
		if server.Host != nil {
			host = *server.Host
		}
		port := ""
		if server.Port != nil {
			port = *server.Port
		}
		user := ""
		if server.Username != nil {
			user = *server.Username
		}
		pass := ""
		if server.Password != nil {
			pass = *server.Password
		}

		// Valida e atualiza status da conta
		if info, err := xtream.GetInfo(host, port, user, pass); err == nil && info != nil {
			if strings.ToLower(info.UserInfo.Status) == "expired" {
				syncErr = fmt.Errorf("conta expirada no provedor")
			} else {
				var expStr *string
				if info.UserInfo.ExpDate != "" {
					expTs, _ := strconv.ParseInt(info.UserInfo.ExpDate, 10, 64)
					if expTs > 0 {
						if expTs*1000 < time.Now().UnixNano()/1e6 {
							syncErr = fmt.Errorf("conta expirou em %s", time.Unix(expTs, 0).Format("2006-01-02"))
						} else {
							tStr := time.Unix(expTs, 0).Format("2006-01-02")
							expStr = &tStr
						}
					}
				}
				var activeCons, maxCons *int
				if c, err := strconv.Atoi(info.UserInfo.ActiveCons); err == nil {
					activeCons = &c
				}
				if m, err := strconv.Atoi(info.UserInfo.MaxConnections); err == nil {
					maxCons = &m
				}
				a.database.UpdateServerStats(id, expStr, activeCons, maxCons)
			}
		}

		if syncErr == nil {
			mediaList, syncErr = xtream.SyncCatalogue(host, port, user, pass)
		}
	} else if server.Type == "m3u" {
		if server.M3UUrl != nil && *server.M3UUrl != "" {
			mediaList, syncErr = m3u.ParseM3U(*server.M3UUrl)
		} else {
			syncErr = fmt.Errorf("URL M3U não configurada")
		}
	} else {
		syncErr = fmt.Errorf("tipo de servidor desconhecido: %s", server.Type)
	}

	if syncErr != nil {
		if deleteOnError {
			a.database.DeleteServer(id)
		} else {
			a.database.UpdateServerStatus(id, "error")
		}
		return "", syncErr
	}

	if err := a.database.ReplaceMedia(id, mediaList); err != nil {
		a.database.UpdateServerStatus(id, "error")
		return "", fmt.Errorf("falha ao salvar mídia: %w", err)
	}

	a.database.UpdateServerStatus(id, "ok")
	return fmt.Sprintf("Sincronizado com sucesso! %d itens catalogados.", len(mediaList)), nil
}

func (a *APIHandler) SyncServer(w http.ResponseWriter, r *http.Request, idStr string) {
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		sendError(w, http.StatusBadRequest, "ID inválido")
		return
	}

	// Por padrão, se houver erro ou a conta for inválida/expirada, remove o servidor automaticamente
	deleteOnError := r.URL.Query().Get("deleteOnError") != "false"
	msg, syncErr := a.SyncServerInternal(id, deleteOnError)
	a.proxy.InvalidateCache()

	if syncErr != nil {
		sendError(w, http.StatusInternalServerError, syncErr.Error())
		return
	}

	sendJSON(w, http.StatusOK, map[string]string{"message": msg})
}

type SyncBatchRequest struct {
	ServerIDs     []int64 `json:"serverIds"`
	DeleteOnError bool    `json:"deleteOnError"`
	Concurrency   int     `json:"concurrency"`
}

type SyncBatchResultItem struct {
	ID      int64  `json:"id"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// SyncServersBatch sincroniza múltiplos servidores simultaneamente com Goroutines
func (a *APIHandler) SyncServersBatch(w http.ResponseWriter, r *http.Request) {
	var req SyncBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, "JSON inválido")
		return
	}

	if len(req.ServerIDs) == 0 {
		sendError(w, http.StatusBadRequest, "Nenhum servidor fornecido")
		return
	}

	concurrency := req.Concurrency
	if concurrency <= 0 || concurrency > 20 {
		concurrency = 8 // Concorrência padrão equilibrada
	}

	deleteOnError := true
	if r.URL.Query().Get("deleteOnError") == "false" {
		deleteOnError = false
	}

	sem := make(chan struct{}, concurrency)
	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		results []SyncBatchResultItem
		success int
		failed  int
	)

	for _, srvID := range req.ServerIDs {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			msg, err := a.SyncServerInternal(id, deleteOnError)

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed++
				results = append(results, SyncBatchResultItem{
					ID:      id,
					Success: false,
					Message: err.Error(),
				})
			} else {
				success++
				results = append(results, SyncBatchResultItem{
					ID:      id,
					Success: true,
					Message: msg,
				})
			}
		}(srvID)
	}

	wg.Wait()
	a.proxy.InvalidateCache()

	sendJSON(w, http.StatusOK, map[string]interface{}{
		"total":   len(req.ServerIDs),
		"success": success,
		"failed":  failed,
		"results": results,
	})
}

func (a *APIHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		sendJSON(w, http.StatusOK, []interface{}{})
		return
	}

	var onlyTypes []string
	if tp := strings.TrimSpace(r.URL.Query().Get("type")); tp == "movie" || tp == "series" || tp == "live" {
		onlyTypes = []string{tp}
	}
	limit := 300
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 1000 {
		limit = l
	}

	results, err := a.database.SearchMediaTypes(q, limit, onlyTypes)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []models.SearchResult{}
	}

	sendJSON(w, http.StatusOK, results)
}

func (a *APIHandler) GetEpisodes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	serverType := q.Get("serverType")
	if serverType != "xtream" {
		sendError(w, http.StatusBadRequest, "Episódios disponíveis apenas para servidores Xtream")
		return
	}

	host := q.Get("host")
	port := q.Get("port")
	username := q.Get("username")
	password := q.Get("password")
	seriesID := q.Get("seriesId")

	data, err := xtream.GetSeriesInfo(host, port, username, password, seriesID)
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	sendJSON(w, http.StatusOK, data)
}


// ExportServers exporta os servidores cadastrados nos formatos CSV ou TXT
func (a *APIHandler) ExportServers(w http.ResponseWriter, r *http.Request) {
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "csv"
	}

	servers, err := a.database.GetServers()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	dateStr := time.Now().Format("2006-01-02")

	if format == "txt" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="xfinder_servidores_%s.txt"`, dateStr))

		fmt.Fprintf(w, "# XFinder - Servidores Salvos (%d servidores)\r\n", len(servers))
		fmt.Fprintf(w, "# Data de exportação: %s\r\n\r\n", time.Now().Format("2006-01-02 15:04:05"))

		for _, s := range servers {
			if s.Type == "xtream" {
				host := ""
				if s.Host != nil {
					host = strings.TrimRight(*s.Host, "/")
				}
				port := ""
				if s.Port != nil && *s.Port != "" {
					port = *s.Port
					if !strings.Contains(host, ":"+port) {
						host = fmt.Sprintf("%s:%s", host, port)
					}
				}
				user := ""
				if s.Username != nil {
					user = *s.Username
				}
				pass := ""
				if s.Password != nil {
					pass = *s.Password
				}
				exp := ""
				if s.Expiry != nil && *s.Expiry != "" {
					exp = fmt.Sprintf(" [Expiração: %s]", *s.Expiry)
				}
				fmt.Fprintf(w, "%s/get.php?username=%s&password=%s # %s%s\r\n", host, user, pass, s.Name, exp)
			} else {
				m3uUrl := ""
				if s.M3UUrl != nil {
					m3uUrl = *s.M3UUrl
				}
				fmt.Fprintf(w, "%s # %s\r\n", m3uUrl, s.Name)
			}
		}
		return
	}

	// CSV
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="xfinder_servidores_%s.csv"`, dateStr))

	// UTF-8 BOM para abrir sem erros de acentuação no Excel
	w.Write([]byte{0xEF, 0xBB, 0xBF})
	fmt.Fprintf(w, "id,nome,tipo,host,porta,usuario,senha,url_m3u,status,vencimento,link_m3u_completo\r\n")

	for _, s := range servers {
		host := ""
		if s.Host != nil {
			host = strings.TrimRight(*s.Host, "/")
		}
		port := ""
		if s.Port != nil && *s.Port != "" {
			port = *s.Port
			if !strings.Contains(host, ":"+port) {
				host = fmt.Sprintf("%s:%s", host, port)
			}
		}
		user := ""
		if s.Username != nil {
			user = *s.Username
		}
		pass := ""
		if s.Password != nil {
			pass = *s.Password
		}
		m3uUrl := ""
		if s.M3UUrl != nil {
			m3uUrl = *s.M3UUrl
		}
		exp := ""
		if s.Expiry != nil {
			exp = *s.Expiry
		}
		fullLink := ""
		if s.Type == "xtream" && host != "" && user != "" && pass != "" {
			fullLink = fmt.Sprintf("%s/get.php?username=%s&password=%s", host, url.QueryEscape(user), url.QueryEscape(pass))
		} else if s.Type == "m3u" {
			fullLink = m3uUrl
		}

		cleanName := strings.ReplaceAll(s.Name, `"`, `""`)
		cleanHost := strings.ReplaceAll(host, `"`, `""`)
		cleanUser := strings.ReplaceAll(user, `"`, `""`)
		cleanPass := strings.ReplaceAll(pass, `"`, `""`)
		cleanM3U := strings.ReplaceAll(m3uUrl, `"`, `""`)
		cleanFull := strings.ReplaceAll(fullLink, `"`, `""`)

		fmt.Fprintf(w, `%d,"%s",%s,"%s",%s,"%s","%s","%s",%s,%s,"%s"`+"\r\n",
			s.ID, cleanName, s.Type, cleanHost, port, cleanUser, cleanPass, cleanM3U, s.Status, exp, cleanFull,
		)
	}
}

// RegisterRoutes registra os endpoints no multiplexer HTTP
func (a *APIHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/servers", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			a.ListServers(w, r)
		case http.MethodPost:
			a.AddServer(w, r)
		case http.MethodOptions:
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.WriteHeader(http.StatusOK)
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/servers/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.WriteHeader(http.StatusOK)
			return
		}
		a.ExportServers(w, r)
	})

	mux.HandleFunc("/api/servers/batch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method == http.MethodPost {
			a.AddServersBatch(w, r)
			return
		}
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/servers/sync-batch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "*")
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method == http.MethodPost {
			a.SyncServersBatch(w, r)
			return
		}
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/servers/delete-batch", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			a.DeleteServersBatch(w, r)
			return
		}
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/servers/cleanup-expired", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			a.CleanupExpired(w, r)
			return
		}
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	})

	mux.HandleFunc("/api/remux", func(w http.ResponseWriter, r *http.Request) {
		a.RemuxStream(w, r)
	})

	mux.HandleFunc("/api/search", func(w http.ResponseWriter, r *http.Request) {
		a.Search(w, r)
	})

	mux.HandleFunc("/api/episodes", func(w http.ResponseWriter, r *http.Request) {
		a.GetEpisodes(w, r)
	})

	// /api/servers/{id} e /api/servers/{id}/sync
	mux.HandleFunc("/api/servers/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/servers/")
		parts := strings.Split(path, "/")
		idStr := parts[0]

		if len(parts) == 1 {
			if r.Method == http.MethodDelete {
				a.DeleteServer(w, r, idStr)
				return
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Header().Set("Access-Control-Allow-Headers", "*")
				w.Header().Set("Access-Control-Allow-Methods", "DELETE, OPTIONS")
				w.WriteHeader(http.StatusOK)
				return
			}
		} else if len(parts) == 2 && parts[1] == "sync" {
			if r.Method == http.MethodPost {
				a.SyncServer(w, r, idStr)
				return
			}
		}
		http.Error(w, "Not Found", http.StatusNotFound)
	})
}

// RemuxStream transmuxa streams MKV para MP4 fragmentado em tempo real via FFmpeg (copy codec, 0% CPU)
func (a *APIHandler) RemuxStream(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.WriteHeader(http.StatusOK)
		return
	}

	targetURL := r.URL.Query().Get("url")
	if targetURL == "" {
		http.Error(w, "Parâmetro 'url' obrigatório", http.StatusBadRequest)
		return
	}

	// Verifica se o ffmpeg está disponível no sistema
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		http.Error(w, "FFmpeg não encontrado no servidor para remux de MKV", http.StatusNotImplemented)
		return
	}

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	cmd := exec.CommandContext(ctx, ffmpegPath,
		"-hide_banner",
		"-loglevel", "error",
		"-headers", "User-Agent: IPTVSmartersPro/1.0.0\r\n",
		"-i", targetURL,
		"-c", "copy",
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "Falha ao criar pipe de saída do FFmpeg", http.StatusInternalServerError)
		return
	}

	if err := cmd.Start(); err != nil {
		http.Error(w, "Falha ao iniciar transcodificador FFmpeg", http.StatusInternalServerError)
		return
	}

	buf := make([]byte, 64*1024)
	for {
		n, err := stdout.Read(buf)
		if n > 0 {
			if _, wErr := w.Write(buf[:n]); wErr != nil {
				break
			}
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}
	_ = cmd.Wait()
}
