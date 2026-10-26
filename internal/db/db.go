package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
	"xfinder/internal/models"
)

type DB struct {
	conn *sql.DB
	mu   sync.RWMutex
}

func Open(dbPath string) (*DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("falha ao criar pasta de dados: %w", err)
	}

	conn, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, fmt.Errorf("falha ao abrir sqlite: %w", err)
	}

	conn.SetMaxOpenConns(1) // Recomendado para SQLite para garantir integridade e evitar database locked

	d := &DB{conn: conn}
	if err := d.initSchema(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("falha ao inicializar schema: %w", err)
	}

	return d, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

func (d *DB) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS servers (
		id                  INTEGER PRIMARY KEY AUTOINCREMENT,
		name                TEXT    NOT NULL,
		type                TEXT    NOT NULL,
		host                TEXT,
		port                TEXT,
		username            TEXT,
		password            TEXT,
		m3u_url             TEXT,
		expiry              TEXT,
		active_connections  INTEGER,
		max_connections     INTEGER,
		status              TEXT    DEFAULT 'pending',
		last_sync           INTEGER,
		created_at          INTEGER DEFAULT (strftime('%s','now'))
	);

	CREATE TABLE IF NOT EXISTS media (
		id                  INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id           INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
		external_id         TEXT,
		title               TEXT    NOT NULL,
		type                TEXT    NOT NULL,
		year                INTEGER,
		cover_url           TEXT,
		category            TEXT,
		stream_id           TEXT,
		container_extension TEXT,
		raw_url             TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_media_server ON media(server_id);
	CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
	CREATE INDEX IF NOT EXISTS idx_media_type_cat ON media(type, category);
	CREATE INDEX IF NOT EXISTS idx_media_title ON media(title);
	`
	_, err := d.conn.Exec(schema)
	return err
}

func (d *DB) GetServers() ([]models.Server, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.conn.Query(`
		SELECT id, name, type, host, port, username, password, m3u_url, expiry,
		       active_connections, max_connections, status, last_sync, created_at
		FROM servers ORDER BY id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.Server
	for rows.Next() {
		var s models.Server
		var lastSync sql.NullInt64
		err := rows.Scan(
			&s.ID, &s.Name, &s.Type, &s.Host, &s.Port, &s.Username, &s.Password, &s.M3UUrl,
			&s.Expiry, &s.ActiveConnections, &s.MaxConnections, &s.Status, &lastSync, &s.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		if lastSync.Valid {
			s.LastSync = &lastSync.Int64
		}
		list = append(list, s)
	}
	return list, nil
}

func (d *DB) GetServerByID(id int64) (*models.Server, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var s models.Server
	var lastSync sql.NullInt64
	err := d.conn.QueryRow(`
		SELECT id, name, type, host, port, username, password, m3u_url, expiry,
		       active_connections, max_connections, status, last_sync, created_at
		FROM servers WHERE id = ?
	`, id).Scan(
		&s.ID, &s.Name, &s.Type, &s.Host, &s.Port, &s.Username, &s.Password, &s.M3UUrl,
		&s.Expiry, &s.ActiveConnections, &s.MaxConnections, &s.Status, &lastSync, &s.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	if lastSync.Valid {
		s.LastSync = &lastSync.Int64
	}
	return &s, nil
}

func (d *DB) InsertServer(s *models.Server) (int64, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	res, err := d.conn.Exec(`
		INSERT INTO servers (name, type, host, port, username, password, m3u_url, expiry, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
	`, s.Name, s.Type, s.Host, s.Port, s.Username, s.Password, s.M3UUrl, s.Expiry)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) DeleteServer(id int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM media WHERE server_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM servers WHERE id = ?", id); err != nil {
		return err
	}

	return tx.Commit()
}

func (d *DB) UpdateServerStatus(id int64, status string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.conn.Exec("UPDATE servers SET status = ?, last_sync = strftime('%s','now') WHERE id = ?", status, id)
	return err
}

func (d *DB) UpdateServerStats(id int64, expiry *string, activeCons, maxCons *int) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.conn.Exec(
		"UPDATE servers SET expiry = ?, active_connections = ?, max_connections = ? WHERE id = ?",
		expiry, activeCons, maxCons, id,
	)
	return err
}

func (d *DB) CleanExpiredServers() (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	rows, err := d.conn.Query("SELECT id, expiry FROM servers WHERE expiry IS NOT NULL")
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var toRemove []int64
	today := time.Now().Format("2006-01-02")

	for rows.Next() {
		var id int64
		var exp string
		if err := rows.Scan(&id, &exp); err != nil {
			continue
		}
		exp = strings.TrimSpace(exp)
		if len(exp) >= 10 {
			expDate := exp[:10]
			if expDate < today {
				toRemove = append(toRemove, id)
			}
		}
	}

	if len(toRemove) == 0 {
		return 0, nil
	}

	tx, err := d.conn.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	for _, id := range toRemove {
		if _, err := tx.Exec("DELETE FROM media WHERE server_id = ?", id); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("DELETE FROM servers WHERE id = ?", id); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	return len(toRemove), nil
}

func (d *DB) ReplaceMedia(serverID int64, mediaList []models.Media) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM media WHERE server_id = ?", serverID); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`
		INSERT INTO media (server_id, external_id, title, type, year, cover_url, category, stream_id, container_extension, raw_url)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, m := range mediaList {
		_, err := stmt.Exec(
			serverID, m.ExternalID, m.Title, m.Type, m.Year, m.CoverURL,
			m.Category, m.StreamID, m.ContainerExtension, m.RawURL,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (d *DB) SearchMedia(query string, limit int) ([]models.SearchResult, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 {
		limit = 300
	}

	likeQuery := "%" + strings.TrimSpace(query) + "%"
	rows, err := d.conn.Query(`
		SELECT m.title, m.type, m.year, m.cover_url, m.external_id,
		       s.id, s.name, s.type, s.host, s.port, s.username, s.password,
		       m.stream_id, m.container_extension, m.raw_url, s.expiry
		FROM media m
		JOIN servers s ON m.server_id = s.id
		WHERE m.title LIKE ? AND s.status = 'ok'
		LIMIT ?
	`, likeQuery, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	resultsMap := make(map[string]*models.SearchResult)
	var orderedKeys []string

	for rows.Next() {
		var title, mType string
		var year sql.NullInt64
		var coverURL, externalID sql.NullString
		var serverID int64
		var serverName, serverType string
		var host, port, username, password, streamID, containerExt, rawURL, expiry sql.NullString

		err := rows.Scan(
			&title, &mType, &year, &coverURL, &externalID,
			&serverID, &serverName, &serverType, &host, &port, &username, &password,
			&streamID, &containerExt, &rawURL, &expiry,
		)
		if err != nil {
			return nil, err
		}

		key := strings.ToLower(title) + "|" + mType
		sr, exists := resultsMap[key]
		if !exists {
			sr = &models.SearchResult{
				Title: title,
				Type:  mType,
			}
			if year.Valid {
				y := int(year.Int64)
				sr.Year = &y
			}
			if coverURL.Valid {
				sr.CoverURL = &coverURL.String
			}
			if externalID.Valid {
				sr.ExternalID = &externalID.String
			}
			resultsMap[key] = sr
			orderedKeys = append(orderedKeys, key)
		}

		srv := models.SearchResultServer{
			ServerID:   serverID,
			ServerName: serverName,
			ServerType: serverType,
		}
		if host.Valid {
			srv.Host = &host.String
		}
		if port.Valid {
			srv.Port = &port.String
		}
		if username.Valid {
			srv.Username = &username.String
		}
		if password.Valid {
			srv.Password = &password.String
		}
		if streamID.Valid {
			srv.StreamID = &streamID.String
		}
		if containerExt.Valid {
			srv.ContainerExtension = &containerExt.String
		}
		if rawURL.Valid {
			srv.RawURL = &rawURL.String
		}
		if expiry.Valid {
			srv.Expiry = &expiry.String
		}

		sr.Servers = append(sr.Servers, srv)
	}

	list := make([]models.SearchResult, 0, len(orderedKeys))
	for _, k := range orderedKeys {
		list = append(list, *resultsMap[k])
	}
	return list, nil
}

// GetDistinctCategories obtém a lista de categorias ordenadas para um determinado tipo
func (d *DB) GetDistinctCategories(mediaType string) ([]string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.conn.Query(`
		SELECT DISTINCT category FROM media 
		WHERE type = ? AND category IS NOT NULL AND trim(category) != ''
		ORDER BY category
	`, mediaType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var categories []string
	for rows.Next() {
		var cat string
		if err := rows.Scan(&cat); err == nil && cat != "" {
			categories = append(categories, cat)
		}
	}
	return categories, nil
}

type StreamItemRow struct {
	ID                 int64
	Title              string
	CoverURL           *string
	Category           *string
	Year               *int
	ContainerExtension *string
	ServerName         string
}

// GetStreamsForProxy busca as streams para o proxy Xtream
func (d *DB) GetStreamsForProxy(mediaType string, categoryName string, deduplicate bool) ([]StreamItemRow, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var query string
	var args []interface{}

	if categoryName != "" {
		query = `
			SELECT m.id, m.title, m.cover_url, m.category, m.year, m.container_extension, s.name AS server_name
			FROM media m
			JOIN servers s ON m.server_id = s.id
			WHERE m.type = ? AND s.status = 'ok' AND m.category = ?
			ORDER BY m.title
		`
		args = []interface{}{mediaType, categoryName}
	} else if deduplicate {
		query = `
			SELECT min(m.id) AS id, m.title, m.cover_url, m.category, m.year, m.container_extension, s.name AS server_name
			FROM media m
			JOIN servers s ON m.server_id = s.id
			WHERE m.type = ? AND s.status = 'ok'
			GROUP BY lower(m.title)
			ORDER BY m.title
		`
		args = []interface{}{mediaType}
	} else {
		query = `
			SELECT m.id, m.title, m.cover_url, m.category, m.year, m.container_extension, s.name AS server_name
			FROM media m
			JOIN servers s ON m.server_id = s.id
			WHERE m.type = ? AND s.status = 'ok'
			ORDER BY m.title
		`
		args = []interface{}{mediaType}
	}

	rows, err := d.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []StreamItemRow
	for rows.Next() {
		var r StreamItemRow
		var year sql.NullInt64
		var cover, cat, ext sql.NullString

		err := rows.Scan(&r.ID, &r.Title, &cover, &cat, &year, &ext, &r.ServerName)
		if err != nil {
			return nil, err
		}
		if cover.Valid {
			r.CoverURL = &cover.String
		}
		if cat.Valid {
			r.Category = &cat.String
		}
		if ext.Valid {
			r.ContainerExtension = &ext.String
		}
		if year.Valid {
			y := int(year.Int64)
			r.Year = &y
		}
		list = append(list, r)
	}
	return list, nil
}

type StreamPlaybackInfo struct {
	MediaID            int64
	MediaTitle         string
	MediaType          string
	StreamID           *string
	ContainerExtension *string
	RawURL             *string
	ServerID           int64
	ServerType         string
	Host               *string
	Port               *string
	Username           *string
	Password           *string
}

// GetStreamPlaybackInfo retorna os dados completos necessários para tocar uma stream
func (d *DB) GetStreamPlaybackInfo(mediaID int64) (*StreamPlaybackInfo, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var info StreamPlaybackInfo
	var streamID, ext, rawURL, host, port, user, pass sql.NullString

	err := d.conn.QueryRow(`
		SELECT m.id, m.title, m.type, m.stream_id, m.container_extension, m.raw_url,
		       s.id, s.type, s.host, s.port, s.username, s.password
		FROM media m
		JOIN servers s ON m.server_id = s.id
		WHERE m.id = ?
	`, mediaID).Scan(
		&info.MediaID, &info.MediaTitle, &info.MediaType, &streamID, &ext, &rawURL,
		&info.ServerID, &info.ServerType, &host, &port, &user, &pass,
	)
	if err != nil {
		return nil, err
	}

	if streamID.Valid {
		info.StreamID = &streamID.String
	}
	if ext.Valid {
		info.ContainerExtension = &ext.String
	}
	if rawURL.Valid {
		info.RawURL = &rawURL.String
	}
	if host.Valid {
		info.Host = &host.String
	}
	if port.Valid {
		info.Port = &port.String
	}
	if user.Valid {
		info.Username = &user.String
	}
	if pass.Valid {
		info.Password = &pass.String
	}

	return &info, nil
}

// FindAlternativeSources busca outros servidores online que possuem a mesma mídia (para Failover instantâneo)
func (d *DB) FindAlternativeSources(title string, mediaType string, excludeServerID int64) ([]StreamPlaybackInfo, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.conn.Query(`
		SELECT m.id, m.title, m.type, m.stream_id, m.container_extension, m.raw_url,
		       s.id, s.type, s.host, s.port, s.username, s.password
		FROM media m
		JOIN servers s ON m.server_id = s.id
		WHERE lower(m.title) = lower(?) AND m.type = ? AND s.id != ? AND s.status = 'ok'
		LIMIT 5
	`, title, mediaType, excludeServerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []StreamPlaybackInfo
	for rows.Next() {
		var info StreamPlaybackInfo
		var streamID, ext, rawURL, host, port, user, pass sql.NullString
		err := rows.Scan(
			&info.MediaID, &info.MediaTitle, &info.MediaType, &streamID, &ext, &rawURL,
			&info.ServerID, &info.ServerType, &host, &port, &user, &pass,
		)
		if err != nil {
			continue
		}
		if streamID.Valid {
			info.StreamID = &streamID.String
		}
		if ext.Valid {
			info.ContainerExtension = &ext.String
		}
		if rawURL.Valid {
			info.RawURL = &rawURL.String
		}
		if host.Valid {
			info.Host = &host.String
		}
		if port.Valid {
			info.Port = &port.String
		}
		if user.Valid {
			info.Username = &user.String
		}
		if pass.Valid {
			info.Password = &pass.String
		}
		list = append(list, info)
	}
	return list, nil
}
