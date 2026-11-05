package models

// Server representa um servidor IPTV/Xtream ou lista M3U cadastrado
type Server struct {
	ID                int64   `json:"id"`
	Name              string  `json:"name"`
	Type              string  `json:"type"` // "xtream" ou "m3u"
	Host              *string `json:"host,omitempty"`
	Port              *string `json:"port,omitempty"`
	Username          *string `json:"username,omitempty"`
	Password          *string `json:"password,omitempty"`
	M3UUrl            *string `json:"m3u_url,omitempty"`
	Expiry            *string `json:"expiry,omitempty"`
	ActiveConnections *int    `json:"active_connections,omitempty"`
	MaxConnections    *int    `json:"max_connections,omitempty"`
	Status            string  `json:"status"` // "pending", "syncing", "ok", "error"
	LastSync          *int64  `json:"last_sync,omitempty"`
	CreatedAt         int64   `json:"created_at"`
	MediaCount        *int64  `json:"media_count,omitempty"` // preenchido apenas em GetServers
}

// Media representa um canal ao vivo, filme ou série
type Media struct {
	ID                 int64   `json:"id"`
	ServerID           int64   `json:"server_id"`
	ExternalID         *string `json:"external_id,omitempty"`
	Title              string  `json:"title"`
	Type               string  `json:"type"` // "live", "movie", "series"
	Year               *int    `json:"year,omitempty"`
	CoverURL           *string `json:"cover_url,omitempty"`
	Category           *string `json:"category,omitempty"`
	StreamID           *string `json:"stream_id,omitempty"`
	ContainerExtension *string `json:"container_extension,omitempty"`
	RawURL             *string `json:"raw_url,omitempty"`
}

// SearchResultServer representa a ocorrência de um servidor para uma mídia unificada
type SearchResultServer struct {
	MediaID            int64   `json:"media_id,omitempty"`
	ServerID           int64   `json:"server_id"`
	ServerName         string  `json:"server_name"`
	ServerType         string  `json:"server_type"`
	Host               *string `json:"host,omitempty"`
	Port               *string `json:"port,omitempty"`
	Username           *string `json:"username,omitempty"`
	Password           *string `json:"password,omitempty"`
	StreamID           *string `json:"stream_id,omitempty"`
	ContainerExtension *string `json:"container_extension,omitempty"`
	RawURL             *string `json:"raw_url,omitempty"`
	Expiry             *string `json:"expiry,omitempty"`
}

// SearchResult representa o item agregado para a busca do painel
type SearchResult struct {
	ID         int64                `json:"id,omitempty"`
	Title      string               `json:"title"`
	Type       string               `json:"type"`
	Year       *int                 `json:"year,omitempty"`
	CoverURL   *string              `json:"cover_url,omitempty"`
	ExternalID *string              `json:"external_id,omitempty"`
	Servers    []SearchResultServer `json:"servers"`
}

// CategoryMapItem item retornado em get_live_categories, get_vod_categories, etc.
type CategoryMapItem struct {
	CategoryID   string `json:"category_id"`
	CategoryName string `json:"category_name"`
	ParentID     int    `json:"parent_id"`
}
