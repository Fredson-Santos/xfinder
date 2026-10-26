package xtream

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"xfinder/internal/models"
)

var defaultClient = &http.Client{
	Timeout: 45 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 20,
		IdleConnTimeout:     90 * time.Second,
	},
}

const DefaultUserAgent = "IPTVSmartersPro/1.0.0 (Linux; Android 11)"

type UserInfo struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	Status         string `json:"status"`
	ExpDate        string `json:"exp_date"`
	ActiveCons     string `json:"active_cons"`
	MaxConnections string `json:"max_connections"`
}

type XtreamAuthResponse struct {
	UserInfo   UserInfo               `json:"user_info"`
	ServerInfo map[string]interface{} `json:"server_info"`
}

type RawCategory struct {
	CategoryID   interface{} `json:"category_id"`
	CategoryName string      `json:"category_name"`
	ParentID     int         `json:"parent_id"`
}

type RawVodItem struct {
	Num                int         `json:"num"`
	Name               string      `json:"name"`
	StreamType         string      `json:"stream_type"`
	StreamID           interface{} `json:"stream_id"`
	StreamIcon         string      `json:"stream_icon"`
	Rating             interface{} `json:"rating"`
	CategoryID         interface{} `json:"category_id"`
	ContainerExtension string      `json:"container_extension"`
	ReleaseDate        string      `json:"releaseDate"`
}

type RawSeriesItem struct {
	Num         int         `json:"num"`
	Name        string      `json:"name"`
	SeriesID    interface{} `json:"series_id"`
	Cover       string      `json:"cover"`
	Plot        string      `json:"plot"`
	Cast        string      `json:"cast"`
	Director    string      `json:"director"`
	Genre       string      `json:"genre"`
	ReleaseDate string      `json:"releaseDate"`
	Rating      interface{} `json:"rating"`
	CategoryID  interface{} `json:"category_id"`
}

type RawLiveItem struct {
	Num          int         `json:"num"`
	Name         string      `json:"name"`
	StreamType   string      `json:"stream_type"`
	StreamID     interface{} `json:"stream_id"`
	StreamIcon   string      `json:"stream_icon"`
	EPGChannelID string      `json:"epg_channel_id"`
	CategoryID   interface{} `json:"category_id"`
}

func BaseURL(host, port string) string {
	h := strings.TrimSpace(host)
	if !strings.HasPrefix(h, "http://") && !strings.HasPrefix(h, "https://") {
		h = "http://" + h
	}
	h = strings.TrimRight(h, "/")
	p := strings.TrimSpace(port)
	if p != "" && !strings.Contains(h, ":"+p) {
		h = fmt.Sprintf("%s:%s", h, p)
	}
	return h
}

func ApiURL(host, port, user, pass string) string {
	base := BaseURL(host, port)
	return fmt.Sprintf("%s/player_api.php?username=%s&password=%s", base, url.QueryEscape(user), url.QueryEscape(pass))
}

func fetchJSON(urlStr string, dest interface{}, timeout time.Duration) error {
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", DefaultUserAgent)
	req.Header.Set("Accept", "*/*")

	client := defaultClient
	if timeout > 0 && timeout != defaultClient.Timeout {
		client = &http.Client{
			Timeout:   timeout,
			Transport: defaultClient.Transport,
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return json.Unmarshal(body, dest)
}

func IDToString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case float64:
		return strconv.FormatInt(int64(val), 10)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	default:
		return fmt.Sprintf("%v", val)
	}
}

var yearRegex = regexp.MustCompile(`\b(19\d{2}|20\d{2})\b`)

func ExtractYear(str string) *int {
	match := yearRegex.FindString(str)
	if match != "" {
		if y, err := strconv.Atoi(match); err == nil {
			return &y
		}
	}
	return nil
}

// GetInfo autentica e busca dados da conta
func GetInfo(host, port, user, pass string) (*XtreamAuthResponse, error) {
	u := ApiURL(host, port, user, pass)
	var auth XtreamAuthResponse
	if err := fetchJSON(u, &auth, 15*time.Second); err != nil {
		return nil, err
	}
	return &auth, nil
}

// GetCategories busca categorias mapeadas (ID -> Nome)
func GetCategories(host, port, user, pass, action string) (map[string]string, error) {
	u := fmt.Sprintf("%s&action=%s", ApiURL(host, port, user, pass), action)
	var raw []RawCategory
	err := fetchJSON(u, &raw, 25*time.Second)
	if err != nil {
		return nil, err
	}

	catMap := make(map[string]string)
	for _, c := range raw {
		id := IDToString(c.CategoryID)
		name := strings.TrimSpace(c.CategoryName)
		if id != "" && name != "" {
			catMap[id] = name
		}
	}
	return catMap, nil
}

// SyncCatalogue busca categorias e catálogo completo (VOD, Séries, Live) de forma concorrente
func SyncCatalogue(host, port, user, pass string) ([]models.Media, error) {
	var (
		vodCats, seriesCats, liveCats map[string]string
		vodItems                      []RawVodItem
		seriesItems                   []RawSeriesItem
		liveItems                     []RawLiveItem
		wg                            sync.WaitGroup
		mu                            sync.Mutex
		errs                          []string
	)

	// 1. Buscar categorias
	wg.Add(3)
	go func() {
		defer wg.Done()
		cats, err := GetCategories(host, port, user, pass, "get_vod_categories")
		if err == nil {
			mu.Lock()
			vodCats = cats
			mu.Unlock()
		}
	}()
	go func() {
		defer wg.Done()
		cats, err := GetCategories(host, port, user, pass, "get_series_categories")
		if err == nil {
			mu.Lock()
			seriesCats = cats
			mu.Unlock()
		}
	}()
	go func() {
		defer wg.Done()
		cats, err := GetCategories(host, port, user, pass, "get_live_categories")
		if err == nil {
			mu.Lock()
			liveCats = cats
			mu.Unlock()
		}
	}()

	// 2. Buscar conteúdos
	wg.Add(3)
	go func() {
		defer wg.Done()
		var items []RawVodItem
		u := fmt.Sprintf("%s&action=get_vod_streams", ApiURL(host, port, user, pass))
		if err := fetchJSON(u, &items, 120*time.Second); err != nil {
			mu.Lock()
			errs = append(errs, "vod: "+err.Error())
			mu.Unlock()
		} else {
			mu.Lock()
			vodItems = items
			mu.Unlock()
		}
	}()

	go func() {
		defer wg.Done()
		var items []RawSeriesItem
		u := fmt.Sprintf("%s&action=get_series", ApiURL(host, port, user, pass))
		if err := fetchJSON(u, &items, 120*time.Second); err != nil {
			mu.Lock()
			errs = append(errs, "series: "+err.Error())
			mu.Unlock()
		} else {
			mu.Lock()
			seriesItems = items
			mu.Unlock()
		}
	}()

	go func() {
		defer wg.Done()
		var items []RawLiveItem
		u := fmt.Sprintf("%s&action=get_live_streams", ApiURL(host, port, user, pass))
		if err := fetchJSON(u, &items, 120*time.Second); err != nil {
			mu.Lock()
			errs = append(errs, "live: "+err.Error())
			mu.Unlock()
		} else {
			mu.Lock()
			liveItems = items
			mu.Unlock()
		}
	}()

	wg.Wait()

	totalItems := len(vodItems) + len(seriesItems) + len(liveItems)
	if totalItems == 0 && len(errs) > 0 {
		return nil, fmt.Errorf("falha ao sincronizar: %s", strings.Join(errs, "; "))
	}

	result := make([]models.Media, 0, totalItems)

	// Processar VOD (Filmes)
	for _, v := range vodItems {
		title := strings.TrimSpace(v.Name)
		if title == "" {
			continue
		}
		sid := IDToString(v.StreamID)
		rawCatID := IDToString(v.CategoryID)
		catName := rawCatID
		if name, ok := vodCats[rawCatID]; ok && name != "" {
			catName = name
		}
		if catName == "" {
			catName = "Filmes"
		}

		year := ExtractYear(v.ReleaseDate)
		if year == nil {
			year = ExtractYear(title)
		}

		ext := v.ContainerExtension
		if ext == "" {
			ext = "mp4"
		}

		cover := strings.TrimSpace(v.StreamIcon)
		var coverPtr *string
		if cover != "" {
			coverPtr = &cover
		}

		result = append(result, models.Media{
			Title:              title,
			Type:               "movie",
			ExternalID:         &sid,
			StreamID:           &sid,
			Category:           &catName,
			Year:               year,
			CoverURL:           coverPtr,
			ContainerExtension: &ext,
		})
	}

	// Processar Séries
	for _, s := range seriesItems {
		title := strings.TrimSpace(s.Name)
		if title == "" {
			continue
		}
		sid := IDToString(s.SeriesID)
		rawCatID := IDToString(s.CategoryID)
		catName := rawCatID
		if name, ok := seriesCats[rawCatID]; ok && name != "" {
			catName = name
		}
		if catName == "" {
			catName = "Séries"
		}

		year := ExtractYear(s.ReleaseDate)
		if year == nil {
			year = ExtractYear(title)
		}

		cover := strings.TrimSpace(s.Cover)
		var coverPtr *string
		if cover != "" {
			coverPtr = &cover
		}

		result = append(result, models.Media{
			Title:      title,
			Type:       "series",
			ExternalID: &sid,
			StreamID:   &sid,
			Category:   &catName,
			Year:       year,
			CoverURL:   coverPtr,
		})
	}

	// Processar Canais Ao Vivo
	for _, l := range liveItems {
		title := strings.TrimSpace(l.Name)
		if title == "" {
			continue
		}
		sid := IDToString(l.StreamID)
		rawCatID := IDToString(l.CategoryID)
		catName := rawCatID
		if name, ok := liveCats[rawCatID]; ok && name != "" {
			catName = name
		}
		if catName == "" {
			catName = "Canais"
		}

		cover := strings.TrimSpace(l.StreamIcon)
		var coverPtr *string
		if cover != "" {
			coverPtr = &cover
		}

		result = append(result, models.Media{
			Title:      title,
			Type:       "live",
			ExternalID: &sid,
			StreamID:   &sid,
			Category:   &catName,
			CoverURL:   coverPtr,
		})
	}

	return result, nil
}

// GetSeriesInfo faz proxy para a requisição de temporadas e episódios da série
func GetSeriesInfo(host, port, user, pass, seriesID string) (map[string]interface{}, error) {
	u := fmt.Sprintf("%s&action=get_series_info&series_id=%s", ApiURL(host, port, user, pass), url.QueryEscape(seriesID))
	var data map[string]interface{}
	if err := fetchJSON(u, &data, 30*time.Second); err != nil {
		return nil, err
	}
	return data, nil
}
