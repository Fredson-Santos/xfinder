package m3u

import (
	"bufio"
	"crypto/tls"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"xfinder/internal/models"
)

var (
	logoRegex  = regexp.MustCompile(`(?i)tvg-logo="([^"]*)"`)
	groupRegex = regexp.MustCompile(`(?i)group-title="([^"]*)"`)
	titleRegex = regexp.MustCompile(`,(.*)$`)
	yearRegex  = regexp.MustCompile(`\b(19\d{2}|20\d{2})\b`)
)

func ParseM3U(m3uURL string) ([]models.Media, error) {
	client := &http.Client{
		Timeout: 90 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	req, err := http.NewRequest("GET", m3uURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "IPTVSmartersPro/1.0.0 (Linux; Android 11)")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("falha ao baixar M3U: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d ao baixar M3U", resp.StatusCode)
	}

	scanner := bufio.NewScanner(resp.Body)
	// Buffer maior para linhas longas de M3U
	buf := make([]byte, 1024*1024)
	scanner.Buffer(buf, 10*1024*1024)

	var list []models.Media
	var currentTitle, currentLogo, currentGroup string

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "#EXTINF") {
			currentTitle = ""
			currentLogo = ""
			currentGroup = ""

			if m := titleRegex.FindStringSubmatch(line); len(m) > 1 {
				currentTitle = strings.TrimSpace(m[1])
			}
			if m := logoRegex.FindStringSubmatch(line); len(m) > 1 {
				currentLogo = strings.TrimSpace(m[1])
			}
			if m := groupRegex.FindStringSubmatch(line); len(m) > 1 {
				currentGroup = strings.TrimSpace(m[1])
			}
		} else if !strings.HasPrefix(line, "#") {
			// É uma URL de stream
			streamURL := line
			if currentTitle == "" {
				currentTitle = "Canal Desconhecido"
			}
			if currentGroup == "" {
				currentGroup = "Outros"
			}

			// Heurística de tipo baseada no grupo ou extensão
			lowerGrp := strings.ToLower(currentGroup)
			lowerURL := strings.ToLower(streamURL)
			mediaType := "live"
			var ext *string

			if strings.Contains(lowerGrp, "filme") || strings.Contains(lowerGrp, "movie") || strings.Contains(lowerGrp, "vod") {
				mediaType = "movie"
			} else if strings.Contains(lowerGrp, "serie") || strings.Contains(lowerGrp, "série") {
				mediaType = "series"
			}

			if strings.HasSuffix(lowerURL, ".mp4") {
				e := "mp4"
				ext = &e
				if mediaType == "live" {
					mediaType = "movie"
				}
			} else if strings.HasSuffix(lowerURL, ".mkv") {
				e := "mkv"
				ext = &e
				if mediaType == "live" {
					mediaType = "movie"
				}
			}

			var year *int
			if yMatch := yearRegex.FindString(currentTitle); yMatch != "" {
				var y int
				if _, err := fmt.Sscanf(yMatch, "%d", &y); err == nil {
					year = &y
				}
			}

			var logoPtr *string
			if currentLogo != "" {
				logoPtr = &currentLogo
			}

			list = append(list, models.Media{
				Title:              currentTitle,
				Type:               mediaType,
				Category:           &currentGroup,
				CoverURL:           logoPtr,
				Year:               year,
				RawURL:             &streamURL,
				ContainerExtension: ext,
			})

			currentTitle = ""
			currentLogo = ""
			currentGroup = ""
		}
	}

	return list, scanner.Err()
}
