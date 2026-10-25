use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

// ─────────────────────────────────────────────
// Backend API base URL
// ─────────────────────────────────────────────

fn backend_url() -> &'static str {
    option_env!("VITE_BACKEND_URL").unwrap_or("http://localhost:5500")
}

fn openwa_base_url() -> &'static str {
    // Expects just the host, e.g. "http://localhost:2785"
    // The /api/{session}/send-message path is appended in send_whatsapp()
    option_env!("VITE_OPENWA_URL").unwrap_or("http://localhost:3000")
}

fn openwa_session() -> &'static str {
    option_env!("VITE_OPENWA_SESSION").unwrap_or("default")
}

fn openwa_api_key() -> &'static str {
    option_env!("VITE_OPENWA_API_KEY").unwrap_or("")
}

// ─────────────────────────────────────────────
// Shared state for serial background thread
// ─────────────────────────────────────────────

#[derive(Default)]
pub struct SerialState {
    pub stop_flag: Mutex<Option<Arc<AtomicBool>>>,
}

// ─────────────────────────────────────────────
// Payload emitted to the frontend
// ─────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct SerialDataPayload {
    pub line: String,
    pub timestamp: u64,
}

fn default_status() -> String {
    "unresolved".to_string()
}

fn resolve_backend_url(custom_url: Option<String>) -> String {
    if let Some(url) = custom_url {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }
    backend_url().trim_end_matches('/').to_string()
}

// ─────────────────────────────────────────────
// Backend API types
// ─────────────────────────────────────────────

/// Payload sent to POST /api/rescue-request
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRescueRequestPayload {
    pub received_at: String,       // ISO-8601
    pub origin_node: String,
    pub location: String,
    #[serde(default)]
    pub mobile: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub device_timestamp: String,
    pub rssi: Option<i64>,
    pub origin_root: String,
    pub final_root: String,
    pub hop_count: Option<i64>,
    pub encryption: String,
    pub auth: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Record returned by the backend for a RescueRequest row
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbRescueRequest {
    pub id: i64,
    pub received_at: String,
    pub origin_node: String,
    pub location: String,
    #[serde(default)]
    pub mobile: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
    pub device_timestamp: String,
    pub rssi: Option<i64>,
    pub origin_root: String,
    pub final_root: String,
    pub hop_count: Option<i64>,
    pub encryption: String,
    pub auth: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

/// Payload sent to PATCH /api/rescue-request/:id
#[derive(Clone, Serialize, Deserialize)]
pub struct UpdateRescueRequestPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

// ─────────────────────────────────────────────
// Backend API Commands
// ─────────────────────────────────────────────

/// POSTs a new rescue request to the backend.
/// Returns the created DB record (with the backend-assigned integer id).
#[tauri::command]
async fn save_rescue_request(
    payload: SaveRescueRequestPayload,
    backend_url: Option<String>,
) -> Result<DbRescueRequest, String> {
    let client = reqwest::Client::new();
    let base = resolve_backend_url(backend_url);
    let url = format!("{}/api/rescue-request", base);

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Backend error {}: {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    serde_json::from_str::<DbRescueRequest>(&text)
        .map_err(|e| format!("Failed to parse response (body: {}): {}", text, e))
}

/// PATCHes an existing rescue request's status and/or notes.
/// Returns the updated DB record.
#[tauri::command]
async fn update_rescue_request(
    id: i64,
    status: Option<String>,
    notes: Option<String>,
    backend_url: Option<String>,
) -> Result<DbRescueRequest, String> {
    let client = reqwest::Client::new();
    let base = resolve_backend_url(backend_url);
    let url = format!("{}/api/rescue-request/{}", base, id);

    let patch = UpdateRescueRequestPayload { status, notes };

    let response = client
        .patch(&url)
        .json(&patch)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Backend error {}: {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    serde_json::from_str::<DbRescueRequest>(&text)
        .map_err(|e| format!("Failed to parse response (body: {}): {}", text, e))
}

/// GETs all rescue requests from the backend (ordered by receivedAt asc).
#[tauri::command]
async fn load_rescue_requests(
    backend_url: Option<String>,
) -> Result<Vec<DbRescueRequest>, String> {
    let client = reqwest::Client::new();
    let base = resolve_backend_url(backend_url);
    let url = format!("{}/api/rescue-request", base);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Backend error {}: {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    serde_json::from_str::<Vec<DbRescueRequest>>(&text)
        .map_err(|e| format!("Failed to parse response (body: {}): {}", text, e))
}

// ─────────────────────────────────────────────
// OpenWA / WhatsApp notification
// ─────────────────────────────────────────────

#[derive(Serialize)]
struct WhatsAppBody {
    #[serde(rename = "chatId")]
    chat_id: String,
    text: String,
}

/// Sends a WhatsApp message via the local OpenWA instance.
/// Config (base_url, session_id, api_key) is passed from the frontend
/// so it reads from Vite's import.meta.env at runtime, not compile-time.
///
/// Endpoint: POST {base_url}/api/sessions/{session_id}/messages/send-text
#[tauri::command]
async fn send_whatsapp(
    base_url: String,
    session_id: String,
    api_key: String,
    mobile: String,
    text: String,
) -> Result<(), String> {
    // Keep digits only (handles numbers with spaces, dashes, +)
    let digits: String = mobile.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.is_empty() {
        return Err("No valid mobile number".into());
    }

    let chat_id = format!("{}@c.us", digits);

    // Correct OpenWA endpoint (WAHA-style API)
    let base = base_url.trim_end_matches('/');
    let url = format!(
        "{}/api/sessions/{}/messages/send-text",
        base, session_id
    );

    let body = WhatsAppBody { chat_id, text };

    let mut req = reqwest::Client::new().post(&url).json(&body);

    if !api_key.is_empty() {
        req = req.header("X-Api-Key", &api_key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("OpenWA request failed: {}", e))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        Err(format!("OpenWA {} — {}", status, body_text))
    }
}

// ─────────────────────────────────────────────
// Tauri Commands — Serial
// ─────────────────────────────────────────────

/// Returns a list of all available serial ports on the host system.
#[tauri::command]
fn list_serial_ports() -> Vec<String> {
    match serialport::available_ports() {
        Ok(ports) => ports.into_iter().map(|p| p.port_name).collect(),
        Err(_) => vec![],
    }
}

/// Starts reading from the given serial port at the specified baud rate.
/// Each line received is emitted as a `serial-data` Tauri event to the frontend.
#[tauri::command]
fn start_serial_read(
    port_name: String,
    baud_rate: u32,
    app: AppHandle,
    state: State<'_, SerialState>,
) -> Result<(), String> {
    // Stop any existing reader first
    {
        let mut flag_lock = state.stop_flag.lock().unwrap();
        if let Some(existing_flag) = flag_lock.take() {
            existing_flag.store(true, Ordering::Relaxed);
        }
    }

    // Open the serial port
    let port = serialport::new(&port_name, baud_rate)
        .timeout(Duration::from_millis(200))
        .open()
        .map_err(|e| format!("Failed to open {}: {}", port_name, e))?;

    // Create a fresh stop flag and store it in state
    let stop_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flag_lock = state.stop_flag.lock().unwrap();
        *flag_lock = Some(stop_flag.clone());
    }

    // Spawn background reader thread
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(port);
        let mut line_buf = String::new();

        while !stop_flag.load(Ordering::Relaxed) {
            line_buf.clear();
            match reader.read_line(&mut line_buf) {
                Ok(0) => {
                    // EOF / port closed
                    break;
                }
                Ok(_) => {
                    let trimmed = line_buf.trim_end_matches(['\r', '\n']).to_string();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // Get current unix timestamp in milliseconds
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    let payload = SerialDataPayload {
                        line: trimmed,
                        timestamp,
                    };

                    // Emit event to all frontend windows
                    let _ = app.emit("serial-data", payload);
                }
                Err(e) => {
                    // Timeout is normal — just loop again
                    if e.kind() == std::io::ErrorKind::TimedOut {
                        continue;
                    }
                    // Real error — emit a disconnect event
                    let _ = app.emit(
                        "serial-error",
                        format!("Serial read error: {}", e),
                    );
                    break;
                }
            }
        }

        // Notify frontend that reading stopped
        let _ = app.emit("serial-disconnected", ());
    });

    Ok(())
}

/// Signals the background serial reader thread to stop.
#[tauri::command]
fn stop_serial_read(state: State<'_, SerialState>) {
    let mut flag_lock = state.stop_flag.lock().unwrap();
    if let Some(flag) = flag_lock.take() {
        flag.store(true, Ordering::Relaxed);
    }
}

// ─────────────────────────────────────────────
// App entry point
// ─────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SerialState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            start_serial_read,
            stop_serial_read,
            save_rescue_request,
            update_rescue_request,
            load_rescue_requests,
            send_whatsapp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
