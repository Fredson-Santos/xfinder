package xtream

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Teste de reprodução: um catálogo que responde não garante que os vídeos
// abram (ex.: painel que lista tudo mas devolve HTML vazio, ou redireciona os
// streams para um domínio que não existe mais).

const (
	probeTimeout  = 12 * time.Second
	probeMinBytes = 1024
)

var probeClient = &http.Client{
	Timeout:   probeTimeout,
	Transport: defaultClient.Transport,
}

// ProbeStream abre a URL e lê o começo do conteúdo. Retorna nil se vier vídeo.
func ProbeStream(rawURL string) error {
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", DefaultUserAgent)
	req.Header.Set("Range", "bytes=0-65535") // filmes: não baixa o arquivo todo

	resp, err := probeClient.Do(req)
	if err != nil {
		return simplifyNetErr(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "text/html") || strings.Contains(ct, "json") {
		return fmt.Errorf("resposta %s em vez de vídeo", ct)
	}

	n, err := io.CopyN(io.Discard, resp.Body, probeMinBytes)
	if n < probeMinBytes {
		if err != nil && err != io.EOF {
			return fmt.Errorf("stream sem dados (%s)", simplifyNetErr(err))
		}
		return fmt.Errorf("stream vazio (%d bytes)", n)
	}
	return nil
}

// ProbeAny testa as URLs em ordem e para na primeira que tocar. Retorna o
// erro de cada tentativa quando nenhuma funciona.
func ProbeAny(urls []string) error {
	if len(urls) == 0 {
		return nil
	}
	var errs []string
	for _, u := range urls {
		err := ProbeStream(u)
		if err == nil {
			return nil
		}
		errs = append(errs, err.Error())
	}
	return fmt.Errorf("nenhum stream de teste reproduziu (%d tentativas: %s)", len(urls), strings.Join(dedupe(errs), "; "))
}

func simplifyNetErr(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"), strings.Contains(msg, "Name or service not known"):
		return fmt.Errorf("domínio do stream não existe")
	case strings.Contains(msg, "Client.Timeout"), strings.Contains(msg, "timeout"):
		return fmt.Errorf("tempo esgotado")
	case strings.Contains(msg, "connection refused"), strings.Contains(msg, "recusou"):
		return fmt.Errorf("conexão recusada")
	}
	return err
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
