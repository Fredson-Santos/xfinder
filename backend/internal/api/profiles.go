package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
)

type profileBody struct {
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
}

type profileDataBody struct {
	Set map[string]string `json:"set"`
	Del []string          `json:"del"`
}

func cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
}

// handleProfiles atende /api/profiles (lista e cria).
func (a *APIHandler) handleProfiles(w http.ResponseWriter, r *http.Request) {
	cors(w)
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	case http.MethodGet:
		list, err := a.database.ListProfiles()
		if err != nil {
			sendError(w, http.StatusInternalServerError, err.Error())
			return
		}
		sendJSON(w, http.StatusOK, list)
	case http.MethodPost:
		var b profileBody
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b); err != nil {
			sendError(w, http.StatusBadRequest, "JSON inválido")
			return
		}
		p, err := a.database.CreateProfile(b.Name, b.Avatar)
		if err != nil {
			sendError(w, http.StatusBadRequest, err.Error())
			return
		}
		sendJSON(w, http.StatusCreated, p)
	default:
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
	}
}

// handleProfileItem atende /api/profiles/{id} e /api/profiles/{id}/data.
func (a *APIHandler) handleProfileItem(w http.ResponseWriter, r *http.Request) {
	cors(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/profiles/"), "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		sendError(w, http.StatusBadRequest, "id inválido")
		return
	}
	if !a.database.ProfileExists(id) {
		sendError(w, http.StatusNotFound, "perfil não encontrado")
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodPut:
			var b profileBody
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&b); err != nil {
				sendError(w, http.StatusBadRequest, "JSON inválido")
				return
			}
			if err := a.database.UpdateProfile(id, b.Name, b.Avatar); err != nil {
				sendError(w, http.StatusBadRequest, err.Error())
				return
			}
			sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
		case http.MethodDelete:
			if err := a.database.DeleteProfile(id); err != nil {
				sendError(w, http.StatusInternalServerError, err.Error())
				return
			}
			sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	if len(parts) == 2 && parts[1] == "data" {
		switch r.Method {
		case http.MethodGet:
			m, err := a.database.GetProfileData(id)
			if err != nil {
				sendError(w, http.StatusInternalServerError, err.Error())
				return
			}
			sendJSON(w, http.StatusOK, m)
		case http.MethodPost:
			var b profileDataBody
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<20)).Decode(&b); err != nil {
				sendError(w, http.StatusBadRequest, "JSON inválido")
				return
			}
			if err := a.database.ApplyProfileData(id, b.Set, b.Del); err != nil {
				sendError(w, http.StatusInternalServerError, err.Error())
				return
			}
			sendJSON(w, http.StatusOK, map[string]bool{"ok": true})
		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	http.Error(w, "Not Found", http.StatusNotFound)
}
