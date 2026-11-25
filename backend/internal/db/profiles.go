package db

import (
	"errors"
	"strings"
	"time"
)

// Profile é um perfil de usuário (estilo Netflix). Os dados dele (favoritos,
// progresso, continuar assistindo, ajustes…) ficam em profile_data.
type Profile struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Avatar    string `json:"avatar"`
	CreatedAt int64  `json:"created_at"`
}

const profileSchema = `
	CREATE TABLE IF NOT EXISTS profiles (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT    NOT NULL,
		avatar     TEXT    NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS profile_data (
		profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
		k          TEXT    NOT NULL,
		v          TEXT    NOT NULL,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (profile_id, k)
	) WITHOUT ROWID;
`

func (d *DB) ListProfiles() ([]Profile, error) {
	rows, err := d.conn.Query(`SELECT id, name, avatar, created_at FROM profiles ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Profile{}
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.Name, &p.Avatar, &p.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, p)
	}
	return list, rows.Err()
}

func (d *DB) CreateProfile(name, avatar string) (*Profile, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("nome obrigatório")
	}
	d.wmu.Lock()
	defer d.wmu.Unlock()
	now := time.Now().UnixMilli()
	res, err := d.conn.Exec(`INSERT INTO profiles (name, avatar, created_at) VALUES (?, ?, ?)`, name, avatar, now)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return &Profile{ID: id, Name: name, Avatar: avatar, CreatedAt: now}, nil
}

func (d *DB) UpdateProfile(id int64, name, avatar string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("nome obrigatório")
	}
	d.wmu.Lock()
	defer d.wmu.Unlock()
	_, err := d.conn.Exec(`UPDATE profiles SET name = ?, avatar = ? WHERE id = ?`, name, avatar, id)
	return err
}

func (d *DB) DeleteProfile(id int64) error {
	d.wmu.Lock()
	defer d.wmu.Unlock()
	_, err := d.conn.Exec(`DELETE FROM profiles WHERE id = ?`, id)
	return err
}

func (d *DB) ProfileExists(id int64) bool {
	var n int
	_ = d.conn.QueryRow(`SELECT COUNT(*) FROM profiles WHERE id = ?`, id).Scan(&n)
	return n > 0
}

// GetProfileData devolve todos os pares chave/valor do perfil.
func (d *DB) GetProfileData(id int64) (map[string]string, error) {
	rows, err := d.conn.Query(`SELECT k, v FROM profile_data WHERE profile_id = ?`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		m[k] = v
	}
	return m, rows.Err()
}

// ApplyProfileData grava e remove chaves do perfil numa única transação.
func (d *DB) ApplyProfileData(id int64, set map[string]string, del []string) error {
	d.wmu.Lock()
	defer d.wmu.Unlock()
	tx, err := d.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	now := time.Now().UnixMilli()
	for k, v := range set {
		if _, err := tx.Exec(`INSERT INTO profile_data (profile_id, k, v, updated_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(profile_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`, id, k, v, now); err != nil {
			return err
		}
	}
	for _, k := range del {
		if _, err := tx.Exec(`DELETE FROM profile_data WHERE profile_id = ? AND k = ?`, id, k); err != nil {
			return err
		}
	}
	return tx.Commit()
}
