package proxy

import (
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"xfinder/internal/db"
	"xfinder/internal/xtream"
)

var streamTransport = &http.Transport{
	TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
	ResponseHeaderTimeout: 20 * time.Second,
	MaxIdleConns:          50,
	MaxIdleConnsPerHost:   10,
	IdleConnTimeout:       60 * time.Second,
}

var streamClient = &http.Client{
	Transport: streamTransport,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		// Preserva headers importantes nos redirecionamentos do provedor
		req.Header.Set("User-Agent", xtream.DefaultUserAgent)
		return nil
	},
}

// BuildSourceURL monta a URL original do provedor
func BuildSourceURL(info *db.StreamPlaybackInfo) string {
	if info.RawURL != nil && *info.RawURL != "" {
		return *info.RawURL
	}
	if info.Host == nil || info.StreamID == nil {
		return ""
	}

	host := *info.Host
	port := ""
	if info.Port != nil {
		port = *info.Port
	}
	base := xtream.BaseURL(host, port)

	user := ""
	if info.Username != nil {
		user = *info.Username
	}
	pass := ""
	if info.Password != nil {
		pass = *info.Password
	}

	ext := "mp4"
	if info.ContainerExtension != nil && *info.ContainerExtension != "" {
		ext = *info.ContainerExtension
	}

	switch info.MediaType {
	case "live":
		return fmt.Sprintf("%s/live/%s/%s/%s.ts", base, user, pass, *info.StreamID)
	case "series":
		return fmt.Sprintf("%s/series/%s/%s/%s.%s", base, user, pass, *info.StreamID, ext)
	default: // movie
		return fmt.Sprintf("%s/movie/%s/%s/%s.%s", base, user, pass, *info.StreamID, ext)
	}
}

// RelayStream repassa o fluxo de vídeo diretamente (Stream Relay) com suporte a Range requests e Failover
func RelayStream(w http.ResponseWriter, r *http.Request, database *db.DB, primaryInfo *db.StreamPlaybackInfo) {
	sources := []db.StreamPlaybackInfo{*primaryInfo}

	// Busca fontes alternativas para Failover caso a primária falhe
	if primaryInfo.MediaTitle != "" {
		if alts, err := database.FindAlternativeSources(primaryInfo.MediaTitle, primaryInfo.MediaType, primaryInfo.ServerID); err == nil {
			sources = append(sources, alts...)
		}
	}

	var lastErr error

	for idx, src := range sources {
		targetURL := BuildSourceURL(&src)
		if targetURL == "" {
			continue
		}

		if idx > 0 {
			log.Printf("[Stream Relay] Failover acionado! Tentando fonte alternativa %d/%d (%s)", idx+1, len(sources), src.MediaTitle)
		}

		req, err := http.NewRequestWithContext(r.Context(), "GET", targetURL, nil)
		if err != nil {
			lastErr = err
			continue
		}

		// Repassa User-Agent ou define o do IPTV Smarters
		clientUA := r.Header.Get("User-Agent")
		if clientUA == "" || strings.Contains(strings.ToLower(clientUA), "mozilla") {
			clientUA = xtream.DefaultUserAgent
		}
		req.Header.Set("User-Agent", clientUA)
		req.Header.Set("Accept", "*/*")

		// Repassa o header de Range (essencial para seeking e avanço rápido de filmes/séries)
		if rangeHdr := r.Header.Get("Range"); rangeHdr != "" {
			req.Header.Set("Range", rangeHdr)
		}

		resp, err := streamClient.Do(req)
		if err != nil {
			lastErr = err
			log.Printf("[Stream Relay] Falha na fonte %s: %v", targetURL, err)
			continue
		}

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
			resp.Body.Close()
			lastErr = fmt.Errorf("HTTP %d da fonte", resp.StatusCode)
			log.Printf("[Stream Relay] Fonte retornou status inválido: %d", resp.StatusCode)
			continue
		}

		// Fonte respondeu com sucesso! Repassa headers para o cliente
		defer resp.Body.Close()

		if ct := resp.Header.Get("Content-Type"); ct != "" {
			w.Header().Set("Content-Type", ct)
		} else {
			if src.MediaType == "live" {
				w.Header().Set("Content-Type", "video/mp2t")
			} else {
				w.Header().Set("Content-Type", "video/mp4")
			}
		}

		if cl := resp.Header.Get("Content-Length"); cl != "" {
			w.Header().Set("Content-Length", cl)
		}
		if cr := resp.Header.Get("Content-Range"); cr != "" {
			w.Header().Set("Content-Range", cr)
		}
		if ar := resp.Header.Get("Accept-Ranges"); ar != "" {
			w.Header().Set("Accept-Ranges", ar)
		} else {
			w.Header().Set("Accept-Ranges", "bytes")
		}

		// Permite acesso cross-origin para players web
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")

		w.WriteHeader(resp.StatusCode)

		// Faz o stream contínuo em chunks de 64KB com alta performance
		buf := make([]byte, 64*1024)
		_, copyErr := io.CopyBuffer(w, resp.Body, buf)
		if copyErr != nil && copyErr != io.EOF {
			// Cliente cancelou/fechou player ou interrupção normal
			return
		}

		return
	}

	http.Error(w, fmt.Sprintf("Stream indisponível ou offline: %v", lastErr), http.StatusBadGateway)
}
