use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

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

// ─────────────────────────────────────────────
// Tauri Commands
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
