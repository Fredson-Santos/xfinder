/// Minimal IPTV M3U / M3U8 parser.
///
/// Expected format:
///   #EXTM3U
///   #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Title
///   http://...stream_url...

#[derive(Debug, Clone)]
pub struct M3uEntry {
    pub title:  String,
    pub url:    String,
    pub group:  Option<String>,
    pub logo:   Option<String>,
    pub tvg_id: Option<String>,
}

/// Parse an M3U/M3U8 string into a list of entries.
pub fn parse(content: &str) -> Vec<M3uEntry> {
    let mut entries = Vec::new();
    let mut lines = content.lines().peekable();

    while let Some(line) = lines.next() {
        let line = line.trim();

        if !line.starts_with("#EXTINF") {
            continue;
        }

        let title  = extract_title(line);
        let group  = extract_attr(line, "group-title");
        let logo   = extract_attr(line, "tvg-logo");
        let tvg_id = extract_attr(line, "tvg-id");

        // The very next non-empty, non-comment line is the stream URL
        while let Some(next) = lines.peek() {
            let next = next.trim();
            if next.is_empty() {
                lines.next();
                continue;
            }
            if next.starts_with('#') {
                break; // next EXTINF block
            }
            let url = next.to_string();
            lines.next();
            entries.push(M3uEntry { title, url, group, logo, tvg_id });
            break;
        }
    }

    entries
}

/// Extract the human-readable title (after the last comma on the #EXTINF line).
fn extract_title(line: &str) -> String {
    line.rfind(',')
        .map(|pos| line[pos + 1..].trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string())
}

/// Extract a quoted attribute value: `attr="value"`.
fn extract_attr(line: &str, attr: &str) -> Option<String> {
    let key   = format!("{}=\"", attr);
    let start = line.find(&key)? + key.len();
    let end   = line[start..].find('"')? + start;
    let val   = line[start..end].trim().to_string();
    if val.is_empty() { None } else { Some(val) }
}

/// Infer content type from URL and group title.
pub fn infer_type(entry: &M3uEntry) -> &'static str {
    let url_lc   = entry.url.to_lowercase();
    let group_lc = entry.group.as_deref().unwrap_or("").to_lowercase();

    if url_lc.contains("/series/")
        || group_lc.contains("serie")
        || group_lc.contains("sér")
    {
        return "series";
    }

    if url_lc.contains("/movie/")
        || url_lc.contains("/vod/")
        || url_lc.ends_with(".mp4")
        || url_lc.ends_with(".mkv")
        || url_lc.ends_with(".avi")
        || url_lc.ends_with(".mov")
        || group_lc.contains("movie")
        || group_lc.contains("film")
        || group_lc.contains("vod")
    {
        return "movie";
    }

    "live"
}
