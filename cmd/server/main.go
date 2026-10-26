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
	port := 3000
	if p, err := strconv.Atoi(portStr); err == nil && p > 0 {
		port = p
	}

	host := os.Getenv("HOST")
	if host == "" {
		host = "0.0.0.0"
	}

	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
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

	// 3. Servidor de arquivos estáticos do Painel Web (index.html, css/, js/)
	mux.Handle("/css/", http.StripPrefix("/css/", http.FileServer(http.Dir("./css"))))
	mux.Handle("/js/", http.StripPrefix("/js/", http.FileServer(http.Dir("./js"))))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "/" || p == "/index.html" {
			http.ServeFile(w, r, "./index.html")
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

		// Se o arquivo existir na raiz, serve
		if _, err := os.Stat("." + p); err == nil {
			http.ServeFile(w, r, "."+p)
			return
		}

		// Fallback para SPA
		http.ServeFile(w, r, "./index.html")
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
