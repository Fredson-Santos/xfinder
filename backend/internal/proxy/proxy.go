package proxy

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"xfinder/internal/db"
	"xfinder/internal/models"
	"xfinder/internal/xtream"
)

type CategoryMap struct {
	IDToName map[string]string
	NameToID map[string]string
	List     []models.CategoryMapItem
}

type ProxyHandler struct {
	database   *db.DB
	port       int
	mu         sync.RWMutex
	liveCats   *CategoryMap
	movieCats  *CategoryMap
	seriesCats *CategoryMap
}

func NewProxyHandler(database *db.DB, port int) *ProxyHandler {
	return &ProxyHandler{
		database: database,
		port:     port,
	}
}

func (p *ProxyHandler) InvalidateCache() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.liveCats = nil
	p.movieCats = nil
	p.seriesCats = nil
}

func (p *ProxyHandler) getCategoryMap(mediaType string) *CategoryMap {
	p.mu.RLock()
	var current *CategoryMap
	switch mediaType {
	case "live":
		current = p.liveCats
	case "movie":
		current = p.movieCats
	case "series":
		current = p.seriesCats
	}
	p.mu.RUnlock()

	if current != nil {
		return current
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	// Double-check após adquirir o lock de escrita
	switch mediaType {
	case "live":
		if p.liveCats != nil {
			return p.liveCats
		}
	case "movie":
		if p.movieCats != nil {
			return p.movieCats
		}
	case "series":
		if p.seriesCats != nil {
			return p.seriesCats
		}
	}

	catNames, err := p.database.GetDistinctCategories(mediaType)
	if err != nil {
		catNames = []string{"Geral"}
	}
	if len(catNames) == 0 {
		catNames = []string{"Geral"}
	}

	idToName := make(map[string]string)
	nameToID := make(map[string]string)
	list := make([]models.CategoryMapItem, 0, len(catNames))

	for i, name := range catNames {
		id := strconv.Itoa(i + 1)
		idToName[id] = name
		nameToID[name] = id
		list = append(list, models.CategoryMapItem{
			CategoryID:   id,
			CategoryName: name,
			ParentID:     0,
		})
	}

	cm := &CategoryMap{
		IDToName: idToName,
		NameToID: nameToID,
		List:     list,
	}

	switch mediaType {
	case "live":
		p.liveCats = cm
	case "movie":
		p.movieCats = cm
	case "series":
		p.seriesCats = cm
	}

	return cm
}

func sendJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(data)
}

// HandlePlayerAPI manipula o endpoint /player_api.php do Xtream Codes
func (p *ProxyHandler) HandlePlayerAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	action := r.FormValue("action")
	username := r.FormValue("username")
	if username == "" {
		username = "xfinder"
	}
	password := r.FormValue("password")
	if password == "" {
		password = "xfinder"
	}

	// 1. Handshake / Auth / Server Info
	if action == "" {
		nowSeconds := time.Now().Unix()
		timeNowStr := time.Now().Format("2006-01-02 15:04:05")

		resp := map[string]interface{}{
			"user_info": map[string]interface{}{
				"username":               username,
				"password":               password,
				"message":                "XFinder Multi-Server Aggregator",
				"auth":                   1,
				"status":                 "Active",
				"exp_date":               "1999999999",
				"is_trial":               "0",
				"active_cons":            "0",
				"max_connections":       "100",
				"created_at":             "1600000000",
				"allowed_output_formats": []string{"m3u8", "ts", "rtmp", "mp4", "mkv"},
			},
			"server_info": map[string]interface{}{
				"url":             r.Host,
				"port":            strconv.Itoa(p.port),
				"https_port":      "",
				"server_protocol": "http",
				"rtmp_port":       "",
				"timezone":        "America/Sao_Paulo",
				"timestamp_now":   nowSeconds,
				"time_now":        timeNowStr,
			},
		}
		sendJSON(w, resp)
		return
	}

	// 2. Categorias
	switch action {
	case "get_live_categories":
		sendJSON(w, p.getCategoryMap("live").List)
		return
	case "get_vod_categories":
		sendJSON(w, p.getCategoryMap("movie").List)
		return
	case "get_series_categories":
		sendJSON(w, p.getCategoryMap("series").List)
		return
	}

	// 3. Streams: Live
	if action == "get_live_streams" {
		catID := r.FormValue("category_id")
		liveMap := p.getCategoryMap("live")
		var catName string
		if catID != "" && catID != "0" {
			catName = liveMap.IDToName[catID]
			if catName == "" {
				sendJSON(w, []interface{}{})
				return
			}
		}

		rows, err := p.database.GetStreamsForProxy("live", catName, false)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		type LiveStreamItem struct {
			Num          int    `json:"num"`
			Name         string `json:"name"`
			StreamType   string `json:"stream_type"`
			StreamID     int64  `json:"stream_id"`
			StreamIcon   string `json:"stream_icon"`
			EPGChannelID string `json:"epg_channel_id"`
			Added        string `json:"added"`
			CategoryID   string `json:"category_id"`
			CustomSID    string `json:"custom_sid"`
			TvArchive    int    `json:"tv_archive"`
			DirectSource string `json:"direct_source"`
		}

		streams := make([]LiveStreamItem, 0, len(rows))
		for idx, row := range rows {
			catN := ""
			if row.Category != nil {
				catN = *row.Category
			}
			mappedCatID := liveMap.NameToID[catN]
			if mappedCatID == "" {
				mappedCatID = "1"
			}

			icon := ""
			if row.CoverURL != nil {
				icon = *row.CoverURL
			}

			streams = append(streams, LiveStreamItem{
				Num:          idx + 1,
				Name:         row.Title,
				StreamType:   "live",
				StreamID:     row.ID,
				StreamIcon:   icon,
				Added:        "1600000000",
				CategoryID:   mappedCatID,
				TvArchive:    0,
				DirectSource: "",
			})
		}
		sendJSON(w, streams)
		return
	}

	// 4. Streams: VOD (Filmes)
	if action == "get_vod_streams" {
		catID := r.FormValue("category_id")
		vodMap := p.getCategoryMap("movie")
		var catName string
		deduplicate := false

		if catID != "" && catID != "0" {
			catName = vodMap.IDToName[catID]
			if catName == "" {
				sendJSON(w, []interface{}{})
				return
			}
		} else {
			// Se requisitar todos os filmes sem categoria, deduplica para não estourar a memória da TV Box
			deduplicate = true
		}

		rows, err := p.database.GetStreamsForProxy("movie", catName, deduplicate)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		type VodStreamItem struct {
			Num                int     `json:"num"`
			Name               string  `json:"name"`
			StreamType         string  `json:"stream_type"`
			StreamID           int64   `json:"stream_id"`
			StreamIcon         string  `json:"stream_icon"`
			Rating             string  `json:"rating"`
			Rating5Based       float64 `json:"rating_5based"`
			Added              string  `json:"added"`
			CategoryID         string  `json:"category_id"`
			ContainerExtension string  `json:"container_extension"`
			CustomSID          string  `json:"custom_sid"`
			DirectSource       string  `json:"direct_source"`
		}

		streams := make([]VodStreamItem, 0, len(rows))
		for idx, row := range rows {
			catN := ""
			if row.Category != nil {
				catN = *row.Category
			}
			mappedCatID := vodMap.NameToID[catN]
			if mappedCatID == "" {
				mappedCatID = "1"
			}

			icon := ""
			if row.CoverURL != nil {
				icon = *row.CoverURL
			}

			ext := "mp4"
			if row.ContainerExtension != nil && *row.ContainerExtension != "" {
				ext = *row.ContainerExtension
			}

			streams = append(streams, VodStreamItem{
				Num:                idx + 1,
				Name:               row.Title,
				StreamType:         "movie",
				StreamID:           row.ID,
				StreamIcon:         icon,
				Rating:             "8.0",
				Rating5Based:       4.0,
				Added:              "1600000000",
				CategoryID:         mappedCatID,
				ContainerExtension: ext,
			})
		}
		sendJSON(w, streams)
		return
	}

	// 5. Streams: Séries
	if action == "get_series" {
		catID := r.FormValue("category_id")
		seriesMap := p.getCategoryMap("series")
		var catName string
		deduplicate := false

		if catID != "" && catID != "0" {
			catName = seriesMap.IDToName[catID]
			if catName == "" {
				sendJSON(w, []interface{}{})
				return
			}
		} else {
			deduplicate = true
		}

		rows, err := p.database.GetStreamsForProxy("series", catName, deduplicate)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		type SeriesStreamItem struct {
			Num             int      `json:"num"`
			Name            string   `json:"name"`
			SeriesID        int64    `json:"series_id"`
			Cover           string   `json:"cover"`
			Plot            string   `json:"plot"`
			Cast            string   `json:"cast"`
			Director        string   `json:"director"`
			Genre           string   `json:"genre"`
			ReleaseDate     string   `json:"releaseDate"`
			LastModified    string   `json:"last_modified"`
			Rating          string   `json:"rating"`
			Rating5Based    float64  `json:"rating_5based"`
			BackdropPath    []string `json:"backdrop_path"`
			YoutubeTrailer  string   `json:"youtube_trailer"`
			EpisodeRunTime  string   `json:"episode_run_time"`
			CategoryID      string   `json:"category_id"`
		}

		streams := make([]SeriesStreamItem, 0, len(rows))
		for idx, row := range rows {
			catN := ""
			if row.Category != nil {
				catN = *row.Category
			}
			mappedCatID := seriesMap.NameToID[catN]
			if mappedCatID == "" {
				mappedCatID = "1"
			}

			cover := ""
			if row.CoverURL != nil {
				cover = *row.CoverURL
			}

			releaseDate := ""
			if row.Year != nil {
				releaseDate = strconv.Itoa(*row.Year)
			}

			streams = append(streams, SeriesStreamItem{
				Num:            idx + 1,
				Name:           row.Title,
				SeriesID:       row.ID,
				Cover:          cover,
				Genre:          catN,
				ReleaseDate:    releaseDate,
				LastModified:   "1600000000",
				Rating:         "8.0",
				Rating5Based:   4.0,
				BackdropPath:   []string{},
				EpisodeRunTime: "45",
				CategoryID:     mappedCatID,
			})
		}
		sendJSON(w, streams)
		return
	}

	// 6. Detalhes de Séries e Episódios (get_series_info)
	if action == "get_series_info" {
		seriesIDStr := r.FormValue("series_id")
		seriesID, _ := strconv.ParseInt(seriesIDStr, 10, 64)
		if seriesID == 0 {
			http.Error(w, "series_id is required", http.StatusBadRequest)
			return
		}

		info, err := p.database.GetStreamPlaybackInfo(seriesID)
		if err != nil || info.ServerType != "xtream" || info.StreamID == nil || info.Host == nil {
			http.Error(w, "Series details not found", http.StatusNotFound)
			return
		}

		port := ""
		if info.Port != nil {
			port = *info.Port
		}
		user := ""
		if info.Username != nil {
			user = *info.Username
		}
		pass := ""
		if info.Password != nil {
			pass = *info.Password
		}

		rawInfo, err := xtream.GetSeriesInfo(*info.Host, port, user, pass, *info.StreamID)
		if err != nil {
			http.Error(w, "Falha ao buscar episódios: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Reescreve os IDs dos episódios para embutir o server_id (ex: "58_12345")
		if episodesMap, ok := rawInfo["episodes"].(map[string]interface{}); ok {
			for seasonNum, epListRaw := range episodesMap {
				if epList, ok := epListRaw.([]interface{}); ok {
					for _, epRaw := range epList {
						if epObj, ok := epRaw.(map[string]interface{}); ok {
							if origID, exists := epObj["id"]; exists {
								epObj["id"] = fmt.Sprintf("%d_%v", info.ServerID, origID)
							}
						}
					}
					episodesMap[seasonNum] = epList
				}
			}
			rawInfo["episodes"] = episodesMap
		}

		sendJSON(w, rawInfo)
		return
	}

	// 7. EPG Stubs
	if action == "get_short_epg" || action == "get_simple_data_table" {
		sendJSON(w, map[string]interface{}{"epg_listings": []interface{}{}})
		return
	}

	http.Error(w, fmt.Sprintf("Unknown action: %s", action), http.StatusBadRequest)
}

// HandleLiveStream rota para reprodução de Live
func (p *ProxyHandler) HandleLiveStream(w http.ResponseWriter, r *http.Request) {
	// Caminho esperado: /live/:user/:pass/:streamId(.ts)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid live stream URL", http.StatusBadRequest)
		return
	}

	rawID := strings.Split(parts[3], ".")[0]
	mediaID, _ := strconv.ParseInt(rawID, 10, 64)
	if mediaID == 0 {
		http.Error(w, "Invalid stream ID", http.StatusBadRequest)
		return
	}

	info, err := p.database.GetStreamPlaybackInfo(mediaID)
	if err != nil {
		http.Error(w, "Live stream not found", http.StatusNotFound)
		return
	}

	RelayStream(w, r, p.database, info)
}

// HandleMovieStream rota para reprodução de VOD (Filmes)
func (p *ProxyHandler) HandleMovieStream(w http.ResponseWriter, r *http.Request) {
	// Caminho esperado: /movie/:user/:pass/:streamId(.ext)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid movie stream URL", http.StatusBadRequest)
		return
	}

	rawID := strings.Split(parts[3], ".")[0]
	mediaID, _ := strconv.ParseInt(rawID, 10, 64)
	if mediaID == 0 {
		http.Error(w, "Invalid movie ID", http.StatusBadRequest)
		return
	}

	info, err := p.database.GetStreamPlaybackInfo(mediaID)
	if err != nil {
		http.Error(w, "Movie not found", http.StatusNotFound)
		return
	}

	RelayStream(w, r, p.database, info)
}

// HandleSeriesStream rota para reprodução de Séries
func (p *ProxyHandler) HandleSeriesStream(w http.ResponseWriter, r *http.Request) {
	// Caminho esperado: /series/:user/:pass/:token(.ext)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		http.Error(w, "Invalid series stream URL", http.StatusBadRequest)
		return
	}

	tokenPart := strings.Split(parts[3], ".")[0]

	// Se o token estiver no formato serverId_episodeId
	if strings.Contains(tokenPart, "_") {
		sub := strings.SplitN(tokenPart, "_", 2)
		serverID, _ := strconv.ParseInt(sub[0], 10, 64)
		origEpID := sub[1]

		server, err := p.database.GetServerByID(serverID)
		if err == nil && server != nil && server.Host != nil {
			info := &db.StreamPlaybackInfo{
				ServerID:   server.ID,
				ServerType: server.Type,
				Host:       server.Host,
				Port:       server.Port,
				Username:   server.Username,
				Password:   server.Password,
				StreamID:   &origEpID,
				MediaType:  "series",
			}
			RelayStream(w, r, p.database, info)
			return
		}
	}

	// Se for media.id direto
	mediaID, _ := strconv.ParseInt(tokenPart, 10, 64)
	if mediaID > 0 {
		info, err := p.database.GetStreamPlaybackInfo(mediaID)
		if err == nil {
			RelayStream(w, r, p.database, info)
			return
		}
	}

	http.Error(w, "Episode stream not found", http.StatusNotFound)
}

// HandleM3UExport exporta a lista M3U virtual agregada
func (p *ProxyHandler) HandleM3UExport(w http.ResponseWriter, r *http.Request) {
	rows, err := p.database.GetStreamsForProxy("live", "", false)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "audio/x-mpegurl; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="xfinder_playlist.m3u"`)

	host := r.Host
	fmt.Fprintln(w, "#EXTM3U")
	for _, row := range rows {
		group := "Outros"
		if row.Category != nil && *row.Category != "" {
			group = *row.Category
		}
		logo := ""
		if row.CoverURL != nil {
			logo = *row.CoverURL
		}
		title := fmt.Sprintf("%s [%s]", row.Title, row.ServerName)
		fmt.Fprintf(w, "#EXTINF:-1 tvg-logo=\"%s\" group-title=\"%s\",%s\n", logo, group, title)
		fmt.Fprintf(w, "http://%s/live/xfinder/xfinder/%d.ts\n", host, row.ID)
	}
}
