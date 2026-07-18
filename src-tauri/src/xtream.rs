use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

// ─── HTTP client ─────────────────────────────────────────────────────────────

fn client(timeout_secs: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

fn base_url(host: &str, port: &str) -> String {
    format!("http://{}:{}", host, port)
}

fn api_url(host: &str, port: &str, user: &str, pass: &str) -> String {
    format!(
        "{}/player_api.php?username={}&password={}",
        base_url(host, port),
        user,
        pass
    )
}

// ─── Response types ──────────────────────────────────────────────────────────

#[derive(Deserialize, Debug, Default)]
pub struct UserInfo {
    pub username:        Option<String>,
    pub exp_date:        Option<String>,
    pub active_cons:     Option<String>,
    pub max_connections: Option<String>,
    pub status:          Option<String>,
}

#[derive(Deserialize, Debug, Default)]
pub struct XtreamInfo {
    pub user_info: UserInfo,
}

/// Flexible value that may be a number or numeric string (Xtream APIs are inconsistent)
fn id_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct VodStream {
    pub name:                String,
    #[serde(default)]
    pub stream_id:           serde_json::Value,
    pub stream_icon:         Option<String>,
    pub category_id:         Option<String>,
    pub container_extension: Option<String>,
    #[serde(rename = "releaseDate")]
    pub release_date:        Option<String>,
    pub added:               Option<String>,
}

impl VodStream {
    pub fn stream_id_str(&self) -> String { id_to_string(&self.stream_id) }
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct SeriesEntry {
    #[serde(default)]
    pub series_id:    serde_json::Value,
    pub name:         String,
    pub cover:        Option<String>,
    pub category_id:  Option<String>,
    #[serde(rename = "releaseDate")]
    pub release_date: Option<String>,
}

impl SeriesEntry {
    pub fn series_id_str(&self) -> String { id_to_string(&self.series_id) }
}

#[derive(Deserialize, Debug, Clone, Default)]
pub struct LiveStream {
    pub name:        String,
    #[serde(default)]
    pub stream_id:   serde_json::Value,
    pub stream_icon: Option<String>,
    pub category_id: Option<String>,
}

impl LiveStream {
    pub fn stream_id_str(&self) -> String { id_to_string(&self.stream_id) }
}

// ─── API calls ───────────────────────────────────────────────────────────────

/// Authenticate and retrieve account info (expiry, connections, etc.)
pub async fn get_info(host: &str, port: &str, user: &str, pass: &str) -> Result<XtreamInfo, String> {
    let url = api_url(host, port, user, pass);
    client(15)?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Connection error: {}", e))?
        .json::<XtreamInfo>()
        .await
        .map_err(|e| format!("Parse error: {}", e))
}

/// Fetch full VOD (movie) catalogue — may be large, 120s timeout
pub async fn get_vod(host: &str, port: &str, user: &str, pass: &str) -> Result<Vec<VodStream>, String> {
    let url = format!("{}&action=get_vod_streams", api_url(host, port, user, pass));
    client(120)?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("VOD fetch error: {}", e))?
        .json::<Vec<VodStream>>()
        .await
        .map_err(|e| format!("VOD parse error: {}", e))
}

/// Fetch full series catalogue
pub async fn get_series(host: &str, port: &str, user: &str, pass: &str) -> Result<Vec<SeriesEntry>, String> {
    let url = format!("{}&action=get_series", api_url(host, port, user, pass));
    client(120)?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Series fetch error: {}", e))?
        .json::<Vec<SeriesEntry>>()
        .await
        .map_err(|e| format!("Series parse error: {}", e))
}

/// Fetch live streams catalogue
pub async fn get_live(host: &str, port: &str, user: &str, pass: &str) -> Result<Vec<LiveStream>, String> {
    let url = format!("{}&action=get_live_streams", api_url(host, port, user, pass));
    client(120)?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Live fetch error: {}", e))?
        .json::<Vec<LiveStream>>()
        .await
        .map_err(|e| format!("Live parse error: {}", e))
}

/// Get full series info with season/episode breakdown (called on demand)
pub async fn get_series_info(
    host: &str, port: &str, user: &str, pass: &str, series_id: &str,
) -> Result<serde_json::Value, String> {
    let url = format!(
        "{}&action=get_series_info&series_id={}",
        api_url(host, port, user, pass),
        series_id
    );
    client(30)?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Series info fetch error: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Series info parse error: {}", e))
}
