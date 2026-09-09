import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

type RequestStatus = "unmarked" | "solved" | "unresolved";

interface RescueRequest {
  id: number;
  receivedAt: number;        // unix ms (from serial event timestamp)
  originNode: string;        // e.g. "NODE_A"
  location: string;
  deviceTimestamp: string;   // e.g. "12345 ms since origin boot"
  rssi: number | null;
  originRoot: string;
  finalRoot: string;
  hopCount: number | null;
  encryption: string;
  auth: string;
  status: RequestStatus;
  notes: string;
}

// Multi-line rescue block parser state
type ParsePhase = "idle" | "header-seen" | "accumulating";

interface ParseState {
  phase: ParsePhase;
  pendingLines: string[];
  pendingTimestamp: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

let globalEntryId = 0;
let globalRequestId = 0;

function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms3 = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms3}`;
}

function formatTimeShort(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function parsePairLine(line: string): [string, string] | null {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const val = line.slice(idx + 1).trim();
  return [key, val];
}

/** Build a RescueRequest from the accumulated lines of one rescue block */
function buildRequest(lines: string[], timestamp: number): RescueRequest {
  const req: RescueRequest = {
    id: ++globalRequestId,
    receivedAt: timestamp,
    originNode: "UNKNOWN",
    location: "—",
    deviceTimestamp: "—",
    rssi: null,
    originRoot: "—",
    finalRoot: "—",
    hopCount: null,
    encryption: "—",
    auth: "—",
    status: "unmarked",
    notes: "",
  };

  for (const line of lines) {
    const pair = parsePairLine(line);
    if (!pair) continue;
    const [key, val] = pair;

    if (key === "Origin Node")    req.originNode = val;
    else if (key === "Location")  req.location   = val;
    else if (key === "Timestamp") req.deviceTimestamp = val;
    else if (key === "RSSI") {
      const n = parseInt(val, 10);
      if (!isNaN(n)) req.rssi = n;
    }
    else if (key === "Origin Root") req.originRoot = val;
    else if (key === "Final Root")  req.finalRoot  = val;
    else if (key === "Hop Count") {
      const n = parseInt(val, 10);
      if (!isNaN(n)) req.hopCount = n;
    }
    else if (key === "Encryption") req.encryption = val;
    else if (key === "Auth")       req.auth       = val;
  }

  return req;
}

/** Classify RSSI quality */
function rssiClass(rssi: number | null): string {
  if (rssi === null) return "";
  if (rssi >= -60) return "rssi-good";
  if (rssi >= -80) return "rssi-ok";
  return "rssi-weak";
}

/** Classify a console line for highlight styling */
function lineClass(line: string): string {
  const t = line.trim();
  if (t.startsWith("========")) return "text-divider";
  if (t === "RESCUE MESSAGE RECEIVED") return "text-header";
  if (t.startsWith("Origin Node")
    || t.startsWith("Location")
    || t.startsWith("Timestamp")
    || t.startsWith("RSSI")
    || t.startsWith("Origin Root")
    || t.startsWith("Final Root")
    || t.startsWith("Hop Count")
    || t.startsWith("Encryption")
    || t.startsWith("Auth")) return "text-rescue";
  if (t.includes("ERROR") || t.includes("FAILED") || t.includes("INVALID")) return "text-error";
  if (t.includes("⚠")) return "text-warn";
  return "";
}

function isRescueRelated(line: string): boolean {
  const t = line.trim();
  return t.startsWith("========")
    || t === "RESCUE MESSAGE RECEIVED"
    || t.startsWith("Origin Node")
    || t.startsWith("Location")
    || t.startsWith("Timestamp")
    || t.startsWith("RSSI")
    || t.startsWith("Origin Root")
    || t.startsWith("Final Root")
    || t.startsWith("Hop Count")
    || t.startsWith("Encryption")
    || t.startsWith("Auth");
}

// ─────────────────────────────────────────────
// Clock component
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Inline SVG icons — no emoji
// ─────────────────────────────────────────────

const Icons = {
  // Antenna / signal — used in header logo and node badge
  antenna: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 0 1 12 0"/>
      <path d="M3 5.5a11 11 0 0 1 18 0"/>
      <line x1="12" y1="9" x2="12" y2="22"/>
      <line x1="9" y1="22" x2="15" y2="22"/>
    </svg>
  ),
  // Inbox / tray — Total requests
  inbox: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
    </svg>
  ),
  // Clock — Unmarked / pending
  clock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  // Check circle — Solved
  checkCircle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>
  ),
  // Alert triangle — Unresolved
  alertTriangle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  // Wifi / signal strength — RSSI
  wifi: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  ),
  // X circle — Unresolved action
  xCircle: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  // Check small — Solved action
  check: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  // Minus — Reset/Unmarked
  minus: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
};

// ─────────────────────────────────────────────
// Clock component
// ─────────────────────────────────────────────

function LiveClock() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="time-display">{time}</span>;
}

// ─────────────────────────────────────────────
// Window Controls component
// ─────────────────────────────────────────────

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win.isMaximized().then(setIsMaximized);
    let cleanup: (() => void) | null = null;
    win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    }).then((unlisten) => { cleanup = unlisten; });
    return () => { cleanup?.(); };
  }, []);

  return (
    <div className="win-controls">
      {/* Minimize */}
      <button
        id="win-minimize"
        className="win-btn win-btn-minimize"
        onClick={() => win.minimize()}
        title="Minimize"
        aria-label="Minimize window"
      >
        <svg width="10" height="1" viewBox="0 0 10 1">
          <line x1="0" y1="0.5" x2="10" y2="0.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        id="win-maximize"
        className="win-btn win-btn-maximize"
        onClick={() => isMaximized ? win.unmaximize() : win.maximize()}
        title={isMaximized ? "Restore" : "Maximize"}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
      >
        {isMaximized ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="3" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            <rect x="0" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="var(--navy)"/>
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
        )}
      </button>

      {/* Close */}
      <button
        id="win-close"
        className="win-btn win-btn-close"
        onClick={() => win.close()}
        title="Close"
        aria-label="Close window"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <line x1="1" y1="1" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          <line x1="10" y1="1" x2="1" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────


function App() {
  // Serial connection state
  const [ports, setPorts]               = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate]         = useState<number>(115200);
  const [connected, setConnected]       = useState(false);
  const [connecting, setConnecting]     = useState(false);
  const [statusMsg, setStatusMsg]       = useState("Disconnected");

  // Log / console state
  const [logs, setLogs]                 = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll]     = useState(true);
  const [consoleFilter, setConsoleFilter] = useState("");

  // Rescue request state
  const [requests, setRequests]         = useState<RescueRequest[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | RequestStatus>("all");

  // Parser state (kept in a ref to avoid stale closures in the event listener)
  const parseStateRef = useRef<ParseState>({
    phase: "idle",
    pendingLines: [],
    pendingTimestamp: 0,
  });

  const consoleRef   = useRef<HTMLDivElement>(null);
  const unlistenRef  = useRef<UnlistenFn[]>([]);

  // ── Load ports ──────────────────────────────────────────────────
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

  useEffect(() => { refreshPorts(); }, []);

  // ── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  // ── Rescue block parser ──────────────────────────────────────────
  /**
   * State machine:
   *   idle         → sees "RESCUE MESSAGE RECEIVED" → header-seen
   *   header-seen  → sees next "===" divider (the closing one after header) → accumulating
   *   accumulating → collects field lines until next "===" divider → emit card → idle
   *
   * The block from the rescue node is:
   *   ========================================   (opening divider)
   *           RESCUE MESSAGE RECEIVED            (header — this is what we detect)
   *   ========================================   (second divider, after header)
   *   Origin Node : NODE_A
   *   ...
   *   ========================================   (closing divider)
   */
  const processLine = useCallback((line: string, timestamp: number) => {
    const ps = parseStateRef.current;
    const trimmed = line.trim();

    if (ps.phase === "idle") {
      if (trimmed === "RESCUE MESSAGE RECEIVED") {
        ps.phase = "header-seen";
        ps.pendingTimestamp = timestamp;
        ps.pendingLines = [];
      }
      return;
    }

    if (ps.phase === "header-seen") {
      // Next line should be the second === divider; skip it and start accumulating
      if (trimmed.startsWith("===")) {
        ps.phase = "accumulating";
      }
      return;
    }

    if (ps.phase === "accumulating") {
      if (trimmed.startsWith("===")) {
        // Closing divider — emit the card
        const req = buildRequest(ps.pendingLines, ps.pendingTimestamp);
        setRequests((prev) => [req, ...prev]);
        ps.phase = "idle";
        ps.pendingLines = [];
      } else {
        ps.pendingLines.push(trimmed);
      }
    }
  }, []);

  // ── Connect ──────────────────────────────────────────────────────
  const connect = async () => {
    if (!selectedPort) return;
    setConnecting(true);
    setStatusMsg("Connecting…");

    for (const fn of unlistenRef.current) fn();
    unlistenRef.current = [];

    // Reset parser
    parseStateRef.current = { phase: "idle", pendingLines: [], pendingTimestamp: 0 };

    try {
      const unData = await listen<SerialDataPayload>("serial-data", (event) => {
        const entry: LogEntry = {
          id: ++globalEntryId,
          line: event.payload.line,
          timestamp: event.payload.timestamp,
        };
        setLogs((prev) => [...prev.slice(-4999), entry]);
        processLine(event.payload.line, event.payload.timestamp);
      });

      const unError = await listen<string>("serial-error", (event) => {
        const entry: LogEntry = {
          id: ++globalEntryId,
          line: `⚠ ERROR: ${event.payload}`,
          timestamp: Date.now(),
        };
        setLogs((prev) => [...prev, entry]);
        setConnected(false);
        setStatusMsg("Error — disconnected");
      });

      const unDisc = await listen("serial-disconnected", () => {
        setConnected(false);
        setStatusMsg("Disconnected");
      });

      unlistenRef.current = [unData, unError, unDisc];

      await invoke("start_serial_read", { portName: selectedPort, baudRate });

      setConnected(true);
      setConnecting(false);
      setStatusMsg(`${selectedPort} @ ${baudRate}`);
    } catch (e: unknown) {
      setConnecting(false);
      setConnected(false);
      const msg = e instanceof Error ? e.message : String(e);
      setStatusMsg(`Failed: ${msg}`);
    }
  };

  // ── Disconnect ────────────────────────────────────────────────────
  const disconnect = async () => {
    await invoke("stop_serial_read");
    for (const fn of unlistenRef.current) fn();
    unlistenRef.current = [];
    setConnected(false);
    setStatusMsg("Disconnected");
  };

  // ── Clear logs ────────────────────────────────────────────────────
  const clearLogs = () => {
    setLogs([]);
    globalEntryId = 0;
  };

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      invoke("stop_serial_read").catch(() => {});
      for (const fn of unlistenRef.current) fn();
    };
  }, []);

  // ── Status mutation helpers ────────────────────────────────────────
  const setRequestStatus = (id: number, status: RequestStatus) => {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status } : r))
    );
  };

  const setRequestNotes = (id: number, notes: string) => {
    setRequests((prev) =>
      prev.map((r) => (r.id === id ? { ...r, notes } : r))
    );
  };

  // ── Derived state ──────────────────────────────────────────────────
  const filteredRequests = statusFilter === "all"
    ? requests
    : requests.filter((r) => r.status === statusFilter);

  const filteredLogs = consoleFilter.trim()
    ? logs.filter((l) => l.line.toLowerCase().includes(consoleFilter.toLowerCase()))
    : logs;

  // KPI counts
  const totalCount      = requests.length;
  const unmarkedCount   = requests.filter((r) => r.status === "unmarked").length;
  const solvedCount     = requests.filter((r) => r.status === "solved").length;
  const unresolvedCount = requests.filter((r) => r.status === "unresolved").length;

  const rssiValues = requests
    .map((r) => r.rssi)
    .filter((v): v is number => v !== null);
  const avgRssi = rssiValues.length > 0
    ? Math.round(rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length)
    : null;

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* ── Header (frameless titlebar + drag region) ── */}
      <header className="header" data-tauri-drag-region>
        <div className="header-left" data-tauri-drag-region>
          <div className="app-logo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a6 6 0 0 1 12 0"/>
              <path d="M3 5.5a11 11 0 0 1 18 0"/>
              <line x1="12" y1="9" x2="12" y2="22"/>
              <line x1="9" y1="22" x2="15" y2="22"/>
            </svg>
          </div>
          <div data-tauri-drag-region>
            <div className="app-title" data-tauri-drag-region>Rescue Monitor</div>
            <div className="app-subtitle" data-tauri-drag-region>Disaster Management Mesh Network</div>
          </div>
          <div className="status-pill">
            <div className={`status-dot ${connected ? "connected" : connecting ? "connecting" : ""}`} />
            <span>{statusMsg}</span>
          </div>
        </div>
        <div className="header-right" data-tauri-drag-region>
          <LiveClock />
          <WindowControls />
        </div>
      </header>

      {/* ── Toolbar ── */}
      <div className="toolbar">
        {/* Port */}
        <div className="toolbar-group">
          <label className="toolbar-label">Port</label>
          <select
            id="port-select"
            className="toolbar-select"
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={connected}
          >
            {ports.length === 0 ? (
              <option value="">No ports</option>
            ) : (
              ports.map((p) => <option key={p} value={p}>{p}</option>)
            )}
          </select>
          <button
            id="refresh-ports-btn"
            className="btn btn-icon"
            onClick={refreshPorts}
            disabled={connected}
            title="Refresh ports"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>

        <div className="toolbar-divider" />

        {/* Baud */}
        <div className="toolbar-group">
          <label className="toolbar-label">Baud</label>
          <select
            id="baud-select"
            className="toolbar-select"
            value={baudRate}
            onChange={(e) => setBaudRate(Number(e.target.value))}
            disabled={connected}
          >
            {[9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600].map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>

        <div className="toolbar-divider" />

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
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                Connect
              </>
            )}
          </button>
        ) : (
          <button
            id="disconnect-btn"
            className="btn btn-disconnect"
            onClick={disconnect}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            </svg>
            Disconnect
          </button>
        )}
      </div>

      {/* ── KPI Bar ── */}
      <div className="kpi-bar">
        <div className="kpi-tile tile-total">
          <div className="kpi-icon-wrap">{Icons.inbox}</div>
          <div className="kpi-text">
            <div className="kpi-value">{totalCount}</div>
            <div className="kpi-label">Total Requests</div>
          </div>
        </div>
        <div className="kpi-tile tile-unmarked">
          <div className="kpi-icon-wrap">{Icons.clock}</div>
          <div className="kpi-text">
            <div className="kpi-value">{unmarkedCount}</div>
            <div className="kpi-label">Unmarked</div>
          </div>
        </div>
        <div className="kpi-tile tile-solved">
          <div className="kpi-icon-wrap">{Icons.checkCircle}</div>
          <div className="kpi-text">
            <div className="kpi-value">{solvedCount}</div>
            <div className="kpi-label">Solved</div>
          </div>
        </div>
        <div className="kpi-tile tile-unresolved">
          <div className="kpi-icon-wrap">{Icons.alertTriangle}</div>
          <div className="kpi-text">
            <div className="kpi-value">{unresolvedCount}</div>
            <div className="kpi-label">Unresolved</div>
          </div>
        </div>
        <div className="kpi-tile tile-rssi">
          <div className="kpi-icon-wrap">{Icons.wifi}</div>
          <div className="kpi-text">
            <div className="kpi-value">{avgRssi !== null ? `${avgRssi} dBm` : "—"}</div>
            <div className="kpi-label">Avg RSSI</div>
          </div>
        </div>
      </div>

      {/* ── Split Pane ── */}
      <div className="split-pane">

        {/* ────── Left Pane — Rescue Requests ────── */}
        <div className="left-pane">
          <div className="pane-header">
            <span className="pane-title">Rescue Requests</span>
            <div className="filter-tabs">
              {(["all", "unmarked", "solved", "unresolved"] as const).map((f) => (
                <button
                  key={f}
                  className={`filter-tab ${statusFilter === f ? "active" : ""}`}
                  onClick={() => setStatusFilter(f)}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="cards-list">
              <div className="cards-empty">
                <div className="cards-empty-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9a6 6 0 0 1 12 0"/>
                    <path d="M3 5.5a11 11 0 0 1 18 0"/>
                    <line x1="12" y1="9" x2="12" y2="22"/>
                    <line x1="9" y1="22" x2="15" y2="22"/>
                  </svg>
                </div>
                <div className="cards-empty-title">
                  {requests.length === 0
                    ? "No rescue requests yet"
                    : `No ${statusFilter} requests`}
                </div>
                <div className="cards-empty-sub">
                  {requests.length === 0
                    ? "Connect to the rescue node and incoming SOS messages will appear here automatically."
                    : "Change the filter to see other requests."}
                </div>
              </div>
            </div>
          ) : (
            <div className="cards-list">
              {filteredRequests.map((req) => (
                <RequestCard
                  key={req.id}
                  req={req}
                  onStatusChange={(s) => setRequestStatus(req.id, s)}
                  onNotesChange={(n) => setRequestNotes(req.id, n)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ────── Right Pane — Raw Serial Console ────── */}
        <div className="right-pane">
          <div className="console-pane-header">
            <span className="console-pane-title">Raw Serial Feed</span>
            <div className="console-toolbar">
              <span className="line-count-badge">{logs.length} lines</span>
              <input
                id="console-filter-input"
                className="console-input"
                placeholder="Filter…"
                value={consoleFilter}
                onChange={(e) => setConsoleFilter(e.target.value)}
              />
              <button
                id="autoscroll-btn"
                className={`btn-console ${autoScroll ? "active" : ""}`}
                onClick={() => setAutoScroll((v) => !v)}
                title="Toggle auto-scroll"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <polyline points="19 12 12 19 5 12"/>
                </svg>
                Auto-scroll
              </button>
              <button
                id="clear-console-btn"
                className="btn-console btn-console-clear"
                onClick={clearLogs}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                Clear
              </button>
            </div>
          </div>

          <div
            id="serial-console"
            className="console"
            ref={consoleRef}
            onScroll={handleScroll}
          >
            {filteredLogs.length === 0 ? (
              <div className="console-empty">
                {connected
                  ? "Waiting for data..."
                  : "Connect to see live serial output"}
              </div>
            ) : (
              filteredLogs.map((entry) => (
                <div
                  key={entry.id}
                  className={`console-line ${isRescueRelated(entry.line) ? "highlight-rescue" : ""}`}
                >
                  <span className="console-ts">{formatTime(entry.timestamp)}</span>
                  <span className={`console-text ${lineClass(entry.line)}`}>
                    {entry.line}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>ECS — Disaster Management Mesh Network · ESP32 + Ra-02 LoRa</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div className="footer-dot" />
          <span>Ed25519 · X25519 · ChaCha20-Poly1305</span>
          <div className="footer-dot" />
          <span>115200 baud default</span>
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────
// RequestCard Component
// ─────────────────────────────────────────────

interface RequestCardProps {
  req: RescueRequest;
  onStatusChange: (s: RequestStatus) => void;
  onNotesChange: (n: string) => void;
}

function RequestCard({ req, onStatusChange, onNotesChange }: RequestCardProps) {
  const badgeClass =
    req.status === "solved"     ? "badge-solved" :
    req.status === "unresolved" ? "badge-unresolved" :
                                  "badge-unmarked";

  const badgeLabel =
    req.status === "solved"     ? "Solved" :
    req.status === "unresolved" ? "Unresolved" :
                                  "Unmarked";

  return (
    <div className={`request-card status-${req.status}`}>

      {/* Header row */}
      <div className="card-header">
        <div className="card-id-block">
          <span className="card-id">Request #{req.id}</span>
          <span className="card-ts">{formatTimeShort(req.receivedAt)}</span>
        </div>
        <span className="card-node-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9a6 6 0 0 1 12 0"/>
            <path d="M3 5.5a11 11 0 0 1 18 0"/>
            <line x1="12" y1="9" x2="12" y2="22"/>
            <line x1="9" y1="22" x2="15" y2="22"/>
          </svg>
          {req.originNode}
        </span>
        <span className={`status-badge ${badgeClass}`}>{badgeLabel}</span>
      </div>

      {/* Field grid */}
      <div className="card-fields">
        {/* Location — full width */}
        <div className="card-field full-width">
          <span className="field-label">Location</span>
          <span className="field-value location-val">{req.location}</span>
        </div>

        <div className="card-field">
          <span className="field-label">RSSI</span>
          <span className={`field-value ${rssiClass(req.rssi)}`}>
            {req.rssi !== null ? `${req.rssi} dBm` : "—"}
          </span>
        </div>

        <div className="card-field">
          <span className="field-label">Hop Count</span>
          <span className="field-value">
            {req.hopCount !== null ? req.hopCount : "—"}
          </span>
        </div>

        <div className="card-field full-width">
          <span className="field-label">Device Timestamp</span>
          <span className="field-value">{req.deviceTimestamp}</span>
        </div>

        <div className="card-field">
          <span className="field-label">Origin Root</span>
          <span className="field-value">{req.originRoot}</span>
        </div>

        <div className="card-field">
          <span className="field-label">Final Root</span>
          <span className="field-value">{req.finalRoot}</span>
        </div>

        <div className="card-field">
          <span className="field-label">Encryption</span>
          <span className="field-value">{req.encryption}</span>
        </div>

        <div className="card-field">
          <span className="field-label">Auth</span>
          <span className="field-value">{req.auth}</span>
        </div>
      </div>

      {/* Status action buttons */}
      <div className="card-actions">
        <span className="action-label">Mark:</span>
        <button
          id={`btn-solved-${req.id}`}
          className={`btn-action btn-solved ${req.status === "solved" ? "active-action" : ""}`}
          onClick={() => onStatusChange(req.status === "solved" ? "unmarked" : "solved")}
        >
          {Icons.check} Solved
        </button>
        <button
          id={`btn-unresolved-${req.id}`}
          className={`btn-action btn-unresolved ${req.status === "unresolved" ? "active-action" : ""}`}
          onClick={() => onStatusChange(req.status === "unresolved" ? "unmarked" : "unresolved")}
        >
          {Icons.xCircle} Unresolved
        </button>
        {req.status !== "unmarked" && (
          <button
            id={`btn-unmarked-${req.id}`}
            className="btn-action btn-unmarked"
            onClick={() => onStatusChange("unmarked")}
          >
            {Icons.minus} Reset
          </button>
        )}
      </div>

      {/* Operator notes */}
      <div className="card-notes">
        <textarea
          id={`notes-${req.id}`}
          className="notes-textarea"
          placeholder="Operator notes… (e.g. dispatched unit B3 at 14:02)"
          value={req.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
        />
      </div>
    </div>
  );
}

export default App;
