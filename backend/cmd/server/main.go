package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"xfinder/internal/api"
	"xfinder/internal/db"
	"xfinder/internal/proxy"
)

func main() {
	portStr := os.Getenv("PORT")
	port := 2332
	if p, err := strconv.Atoi(portStr); err == nil && p > 0 {
		port = p
	}

	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		candidates := []string{"./data", "../data", "../../data"}
		for _, c := range candidates {
			if fi, err := os.Stat(c); err == nil && fi.IsDir() {
				dataDir = c
				break
			}
		}
		if dataDir == "" {
			dataDir = "./data"
		}
	}

	webDir := os.Getenv("WEB_DIR")
	if webDir == "" {
		// Prioriza o build do painel (web/dist); cai para web/ por compatibilidade
		candidates := []string{"./web/dist", "../web/dist", "../../web/dist", "./web", "../web", "../../web"}
		for _, c := range candidates {
			if fi, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !fi.IsDir() {
				webDir = c
				break
			}
		}
		if webDir == "" {
			webDir = "./web"
		}
	}

	dbPath := filepath.Join(dataDir, "xfinder.db")
	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("Falha crítica ao abrir banco de dados (%s): %v", dbPath, err)
	}
	defer database.Close()

	// Handler do Proxy Xtream e Relays
	proxyHandler := proxy.NewProxyHandler(database, port)

	// Handler da API REST para o Painel Web
	apiHandler := api.NewAPIHandler(database, proxyHandler)

	mux := http.NewServeMux()

	// 1. Registra rotas da API REST
	apiHandler.RegisterRoutes(mux)

	// 2. Registra rotas do Xtream Proxy
	mux.HandleFunc("/player_api.php", proxyHandler.HandlePlayerAPI)
	mux.HandleFunc("/playlist.m3u", proxyHandler.HandleM3UExport)
	mux.HandleFunc("/get.php", proxyHandler.HandleM3UExport)

	// Rotas de streaming com Relay real
	mux.HandleFunc("/live/", proxyHandler.HandleLiveStream)
	mux.HandleFunc("/movie/", proxyHandler.HandleMovieStream)
	mux.HandleFunc("/series/", proxyHandler.HandleSeriesStream)

	// 3. Painel Web (build do Vite em web/dist)
	indexPath := filepath.Join(webDir, "index.html")

	// Arquivos do build do Vite têm hash no nome: podem ficar em cache para sempre
	assetsDir := filepath.Join(webDir, "assets")
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.FileServer(http.Dir(assetsDir)).ServeHTTP(w, r)
	})))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || p == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			http.ServeFile(w, r, indexPath)
			return
		}

		// Compatibilidade com players que chamam /:user/:pass/:streamId.ts diretamente na raiz
		parts := strings.Split(strings.Trim(p, "/"), "/")
		if len(parts) >= 3 && strings.HasSuffix(parts[2], ".ts") {
			// Redireciona internamente para o handler de Live
			r.URL.Path = "/live/" + p
			proxyHandler.HandleLiveStream(w, r)
			return
		}

		// Se o arquivo existir dentro de webDir, serve
		filePath := filepath.Join(webDir, filepath.Clean(p))
		if fi, err := os.Stat(filePath); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}

		// Fallback para SPA
		http.ServeFile(w, r, indexPath)
	})

	// Limpeza inicial de servidores expirados no boot
	if removed, err := database.CleanExpiredServers(); err == nil && removed > 0 {
		log.Printf("  ➜ AutoExpire: %d servidor(es) expirado(s) removido(s) na inicialização.", removed)
		proxyHandler.InvalidateCache()
	}

	// Ticker para expiração periódica a cada 15 minutos
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			if rm, err := database.CleanExpiredServers(); err == nil && rm > 0 {
				log.Printf("  ➜ AutoExpire: %d servidor(es) expirado(s) removido(s).", rm)
				proxyHandler.InvalidateCache()
			}
		}
	}()

	addr := fmt.Sprintf("%s:%d", host, port)
	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	fmt.Printf("\n  ✦ XFinder (Go Engine) rodando com sucesso!\n")
	fmt.Printf("  ➜ Local:   http://localhost:%d\n", port)

	if interfaces, err := net.Interfaces(); err == nil {
		for _, iface := range interfaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, err := iface.Addrs()
			if err != nil {
				continue
			}
			for _, a := range addrs {
				if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
					if ipnet.IP.To4() != nil {
						fmt.Printf("  ➜ Rede (%s): http://%s:%d\n", iface.Name, ipnet.IP.String(), port)
					}
				}
			}
		}
	}

	fmt.Printf("  ➜ Web:     %s\n", webDir)
	fmt.Printf("  ➜ Banco:   %s\n", dbPath)
	fmt.Printf("  ➜ Xtream:  http://localhost:%d (User/Pass: xfinder)\n", port)
	fmt.Printf("  ➜ M3U URL: http://localhost:%d/playlist.m3u\n", port)
	fmt.Printf("  Pressione Ctrl+C para parar.\n\n")

	// Graceful shutdown
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Erro no servidor HTTP: %v", err)
		}
	}()

	<-stop
	log.Println("\nEncerrando XFinder...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	log.Println("Servidor finalizado com segurança.")
}
