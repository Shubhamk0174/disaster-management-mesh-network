import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface SerialDataPayload {
  line: string;
  timestamp: number;
}

interface LogEntry {
  id: number;
  line: string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────

let entryId = 0;

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms3 = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms3}`;
}

function App() {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [statusMsg, setStatusMsg] = useState("Disconnected");

  const consoleRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);

  // ── Load available ports ──────────────────────────────────────
  const refreshPorts = useCallback(async () => {
    try {
      const available = await invoke<string[]>("list_serial_ports");
      setPorts(available);
      if (available.length > 0 && !selectedPort) {
        setSelectedPort(available[0]);
      }
    } catch (e) {
      console.error("Failed to list ports:", e);
    }
  }, [selectedPort]);

  useEffect(() => {
    refreshPorts();
  }, []);

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // ── Detect manual scroll up (disable auto-scroll) ────────────
  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  // ── Connect ───────────────────────────────────────────────────
  const connect = async () => {
    if (!selectedPort) return;
    setConnecting(true);
    setStatusMsg("Connecting…");

    // Cleanup old listeners
    for (const fn of unlistenRef.current) fn();
    unlistenRef.current = [];

    try {
      // Listen for incoming data
      const unData = await listen<SerialDataPayload>("serial-data", (event) => {
        const entry: LogEntry = {
          id: ++entryId,
          line: event.payload.line,
          timestamp: event.payload.timestamp,
        };
        setLogs((prev) => [...prev.slice(-4999), entry]); // cap at 5000 lines
      });

      // Listen for errors
      const unError = await listen<string>("serial-error", (event) => {
        const entry: LogEntry = {
          id: ++entryId,
          line: `⚠ ERROR: ${event.payload}`,
          timestamp: Date.now(),
        };
        setLogs((prev) => [...prev, entry]);
        setConnected(false);
        setStatusMsg("Error — disconnected");
      });

      // Listen for disconnect
      const unDisc = await listen("serial-disconnected", () => {
        setConnected(false);
        setStatusMsg("Disconnected");
      });

      unlistenRef.current = [unData, unError, unDisc];

      // Start serial read in Rust
      await invoke("start_serial_read", {
        portName: selectedPort,
        baudRate: baudRate,
      });

      setConnected(true);
      setConnecting(false);
      setStatusMsg(`Connected — ${selectedPort} @ ${baudRate} baud`);
    } catch (e: unknown) {
      setConnecting(false);
      setConnected(false);
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMsg(`Failed: ${msg}`);
    }
  };

  // ── Disconnect ────────────────────────────────────────────────
  const disconnect = async () => {
    await invoke("stop_serial_read");
    for (const fn of unlistenRef.current) fn();
    unlistenRef.current = [];
    setConnected(false);
    setStatusMsg("Disconnected");
  };

  // ── Clear console ─────────────────────────────────────────────
  const clearLogs = () => {
    setLogs([]);
    entryId = 0;
  };

  // ── Filtered view ─────────────────────────────────────────────
  const filteredLogs = filterText.trim()
    ? logs.filter((l) =>
        l.line.toLowerCase().includes(filterText.toLowerCase())
      )
    : logs;

  // ── Cleanup on unmount ────────────────────────────────────────
  useEffect(() => {
    return () => {
      invoke("stop_serial_read").catch(() => {});
      for (const fn of unlistenRef.current) fn();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <div className={`status-dot ${connected ? "connected" : connecting ? "connecting" : ""}`} />
          <span className="app-title">ESP32 Serial Monitor</span>
          <span className="status-text">{statusMsg}</span>
        </div>
        <div className="header-right">
          <span className="line-count">{logs.length} lines</span>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="toolbar">
        {/* Port selector */}
        <div className="toolbar-group">
          <label className="toolbar-label">PORT</label>
          <select
            id="port-select"
            className="toolbar-select"
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={connected}
          >
            {ports.length === 0 ? (
              <option value="">No ports found</option>
            ) : (
              ports.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))
            )}
          </select>
          <button
            id="refresh-ports-btn"
            className="btn btn-icon"
            onClick={refreshPorts}
            disabled={connected}
            title="Refresh ports"
          >
            ⟳
          </button>
        </div>

        {/* Baud rate */}
        <div className="toolbar-group">
          <label className="toolbar-label">BAUD</label>
          <select
            id="baud-select"
            className="toolbar-select"
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            disabled={connected}
          >
            {[9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        {/* Connect / Disconnect */}
        {!connected ? (
          <button
            id="connect-btn"
            className="btn btn-connect"
            onClick={connect}
            disabled={connecting || ports.length === 0}
          >
            {connecting ? (
              <><span className="spinner" /> Connecting…</>
            ) : (
              "▶ Connect"
            )}
          </button>
        ) : (
          <button
            id="disconnect-btn"
            className="btn btn-disconnect"
            onClick={disconnect}
          >
            ■ Disconnect
          </button>
        )}

        <div className="toolbar-spacer" />

        {/* Filter */}
        <div className="toolbar-group">
          <label className="toolbar-label">FILTER</label>
          <input
            id="filter-input"
            className="toolbar-input"
            placeholder="Search…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>

        {/* Auto-scroll toggle */}
        <button
          id="autoscroll-btn"
          className={`btn btn-toggle ${autoScroll ? "active" : ""}`}
          onClick={() => setAutoScroll((v) => !v)}
          title="Toggle auto-scroll"
        >
          ⬇ Auto
        </button>

        {/* Clear */}
        <button
          id="clear-btn"
          className="btn btn-clear"
          onClick={clearLogs}
        >
          ✕ Clear
        </button>
      </div>

      {/* ── Console ── */}
      <div
        id="serial-console"
        className="console"
        ref={consoleRef}
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="console-empty">
            {connected
              ? "⏳ Waiting for data…"
              : "Select a port and click Connect to start monitoring."}
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div key={entry.id} className="console-line">
              <span className="console-ts">{formatTime(entry.timestamp)}</span>
              <span className="console-text">{entry.line}</span>
            </div>
          ))
        )}
      </div>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>ECS — Disaster Management Mesh Network</span>
        <span>115200 baud default · ESP32 + Ra-02 LoRa</span>
      </footer>
    </div>
  );
}

export default App;
