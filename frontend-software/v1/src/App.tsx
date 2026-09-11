import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

// DB record shape returned by Tauri backend commands
interface DbRescueRequest {
  id: number;
  receivedAt: string;
  originNode: string;
  location: string;
  deviceTimestamp: string;
  rssi: number | null;
  originRoot: string;
  finalRoot: string;
  hopCount: number | null;
  encryption: string;
  auth: string;
  status: string;
  notes: string;
  createdAt: string;
}

interface RescueRequest {
  id: number;               // local display id (incremented in-session)
  dbId: number | null;      // backend DB row id, set after successful POST
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

/**
 * Parse a location string from the serial stream into [lng, lat] for Ola Maps.
 * Supports formats:
 *   "12.9716,77.5946"          → [77.5946, 12.9716]
 *   "12.9716, 77.5946"         → same
 *   "lat:12.97,lng:77.59"      → same
 *   "Lat: 12.97 Lng: 77.59"   → same
 * Returns null if unparseable or out of valid range.
 */
function parseLatLng(location: string): [number, number] | null {
  if (!location || location === "—") return null;

  // Try named key pattern: lat=12.97 lng=77.59 (case-insensitive)
  const named = location.match(
    /lat[\s:=]+(-?\d+\.?\d*)\s*[,\s]+lng[\s:=]+(-?\d+\.?\d*)/i
  );
  if (named) {
    const lat = parseFloat(named[1]);
    const lng = parseFloat(named[2]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      return [lng, lat];
  }

  // Try plain "lat,lng" or "lat, lng"
  const plain = location.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (plain) {
    const lat = parseFloat(plain[1]);
    const lng = parseFloat(plain[2]);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
      return [lng, lat];
  }

  return null;
}

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
    dbId: null,               // will be set after backend POST succeeds
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
    status: "unresolved",     // saved as unresolved immediately
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
// Map component (Leaflet + OpenStreetMap)
// ─────────────────────────────────────────────

// Default view: India centroid
const MAP_DEFAULT_CENTER: L.LatLngTuple = [20.5937, 78.9629];
const MAP_DEFAULT_ZOOM = 5;

interface LeafletMapProps {
  requests: RescueRequest[];
}

function LeafletMap({ requests }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markersRef   = useRef<Map<number, L.Marker>>(new Map());
  const initializedRef = useRef(false);

  // Always reflect the latest requests in async callbacks
  const latestRequestsRef = useRef<RescueRequest[]>(requests);
  latestRequestsRef.current = requests;

  // ── doSync: add/remove markers, adjust camera ────────────────
  const doSync = useCallback((map: L.Map, reqs: RescueRequest[], fitAll: boolean) => {
    // Only show unresolved and unmarked
    const visibleReqs = reqs.filter((r) => r.status !== "solved");
    const visibleIds  = new Set(visibleReqs.map((r) => r.id));

    // Remove solved / deleted markers
    markersRef.current.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    const allLatLng: L.LatLngTuple[] = [];
    const newLatLng: L.LatLngTuple[] = [];

    visibleReqs.forEach((req) => {
      // parseLatLng returns [lng, lat] — Leaflet needs [lat, lng]
      const coords = parseLatLng(req.location);
      if (!coords) return;
      const [lng, lat] = coords;
      const latlng: L.LatLngTuple = [lat, lng];
      allLatLng.push(latlng);

      if (markersRef.current.has(req.id)) {
        // Update position + status colour class
        const m = markersRef.current.get(req.id)!;
        m.setLatLng(latlng);
        const el = m.getElement();
        if (el) el.className = `rescue-marker status-marker-${req.status}`;
        return;
      }

      // Brand-new marker
      newLatLng.push(latlng);

      const icon = L.divIcon({
        className: `rescue-marker status-marker-${req.status}`,
        html: `
          <div class="marker-wave wave-1"></div>
          <div class="marker-wave wave-2"></div>
          <div class="marker-wave wave-3"></div>
          <div class="marker-dot"></div>
        `,
        iconSize:   [76, 76],
        iconAnchor: [38, 38],
      });

      const popupHtml = `
        <div class="map-popup">
          <div class="map-popup-title">Request #${req.id} &mdash; ${req.originNode}</div>
          <div class="map-popup-row"><span>Location</span><span>${req.location}</span></div>
          <div class="map-popup-row"><span>RSSI</span><span>${req.rssi !== null ? req.rssi + " dBm" : "—"}</span></div>
          <div class="map-popup-row"><span>Hop Count</span><span>${req.hopCount ?? "—"}</span></div>
          <div class="map-popup-row map-popup-status ${req.status}"><span>Status</span><span>${req.status.charAt(0).toUpperCase() + req.status.slice(1)}</span></div>
        </div>
      `;

      const marker = L.marker(latlng, { icon })
        .bindPopup(popupHtml, { maxWidth: 260, className: "leaflet-rescue-popup" })
        .addTo(map);

      markersRef.current.set(req.id, marker);
    });

    // Camera logic
    try {
      if (fitAll && allLatLng.length > 1) {
        map.fitBounds(allLatLng as L.LatLngBoundsExpression, { padding: [60, 60], maxZoom: 12 });
      } else if (allLatLng.length === 1 && (fitAll || newLatLng.length > 0)) {
        map.flyTo(allLatLng[0], 12, { duration: 1.2 });
      } else if (newLatLng.length === 1) {
        map.flyTo(newLatLng[0], 12, { duration: 1.2 });
      } else if (newLatLng.length > 1) {
        map.fitBounds(newLatLng as L.LatLngBoundsExpression, { padding: [60, 60], maxZoom: 12 });
      }
    } catch (e) {
      console.warn("[LeafletMap] Camera move failed:", e);
    }
  }, []);

  // Initialise map once
  useEffect(() => {
    if (initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const map = L.map(containerRef.current, {
      center: MAP_DEFAULT_CENTER,
      zoom:   MAP_DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false,
    });

    // OpenStreetMap tiles — no API key required
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    // Run initial sync once tiles are ready
    map.whenReady(() => {
      doSync(map, latestRequestsRef.current, true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      initializedRef.current = false;
      markersRef.current.clear();
    };
  }, [doSync]);

  // Re-sync whenever requests change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    doSync(map, requests, false);
  }, [requests, doSync]);

  const hasCoords = requests.some((r) => r.status !== "solved" && parseLatLng(r.location) !== null);

  return (
    <div className="map-pane">
      <div ref={containerRef} className="map-container" />
      {!hasCoords && (
        <div className="map-no-data-hint">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          Awaiting GPS coordinates from rescue nodes
        </div>
      )}
    </div>
  );
}



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

  const consoleRef        = useRef<HTMLDivElement>(null);
  const unlistenRef       = useRef<UnlistenFn[]>([]);
  // Debounce timers for notes PATCH — keyed by local request id
  const notesDebounceRef  = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

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

  // ── Load rescue history from DB on startup ───────────────────────
  useEffect(() => {
    invoke<DbRescueRequest[]>("load_rescue_requests")
      .then((records) => {
        const loaded: RescueRequest[] = records.map((r) => ({
          id: ++globalRequestId,
          dbId: r.id,
          receivedAt: new Date(r.receivedAt).getTime(),
          originNode: r.originNode,
          location: r.location,
          deviceTimestamp: r.deviceTimestamp,
          rssi: r.rssi ?? null,
          originRoot: r.originRoot,
          finalRoot: r.finalRoot,
          hopCount: r.hopCount ?? null,
          encryption: r.encryption,
          auth: r.auth,
          status: r.status as RequestStatus,
          notes: r.notes,
        }));
        setRequests(loaded);
      })
      .catch((e) => console.error("[DB] Failed to load rescue requests:", e));
  }, []);

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
        // Closing divider — build card and optimistically add to UI
        const req = buildRequest(ps.pendingLines, ps.pendingTimestamp);
        setRequests((prev) => [req, ...prev]);
        ps.phase = "idle";
        ps.pendingLines = [];

        // Fire-and-forget POST to backend; update dbId when it comes back
        invoke<DbRescueRequest>("save_rescue_request", {
          payload: {
            receivedAt: new Date(req.receivedAt).toISOString(),
            originNode: req.originNode,
            location: req.location,
            deviceTimestamp: req.deviceTimestamp,
            rssi: req.rssi,
            originRoot: req.originRoot,
            finalRoot: req.finalRoot,
            hopCount: req.hopCount,
            encryption: req.encryption,
            auth: req.auth,
            status: "unresolved",
            notes: "",
          },
        })
          .then((saved) => {
            setRequests((prev) =>
              prev.map((r) => (r.id === req.id ? { ...r, dbId: saved.id } : r))
            );
          })
          .catch((e) => console.error("[DB] Failed to save rescue request:", e));
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
    setRequests((prev) => {
      const req = prev.find((r) => r.id === id);
      if (req?.dbId != null) {
        // Immediately PATCH the DB
        invoke("update_rescue_request", { id: req.dbId, status })
          .catch((e) => console.error("[DB] Failed to update status:", e));
      }
      return prev.map((r) => (r.id === id ? { ...r, status } : r));
    });
  };

  const setRequestNotes = (id: number, notes: string) => {
    setRequests((prev) => {
      const req = prev.find((r) => r.id === id);
      if (req?.dbId != null) {
        const dbId = req.dbId;
        // Debounced PATCH — 500 ms after last keystroke
        if (notesDebounceRef.current[id]) clearTimeout(notesDebounceRef.current[id]);
        notesDebounceRef.current[id] = setTimeout(() => {
          invoke("update_rescue_request", { id: dbId, notes })
            .catch((e) => console.error("[DB] Failed to update notes:", e));
          delete notesDebounceRef.current[id];
        }, 500);
      }
      return prev.map((r) => (r.id === id ? { ...r, notes } : r));
    });
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

        {/* ────── Centre Pane — Leaflet Map ────── */}
        <LeafletMap requests={requests} />


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
  // New cards arrive expanded so the operator sees data immediately
  const [isExpanded, setIsExpanded] = useState(true);

  const badgeClass =
    req.status === "solved"     ? "badge-solved" :
    req.status === "unresolved" ? "badge-unresolved" :
                                  "badge-unmarked";

  const badgeLabel =
    req.status === "solved"     ? "Solved" :
    req.status === "unresolved" ? "Unresolved" :
                                  "Unmarked";

  const rssiPillClass =
    req.rssi === null  ? "" :
    req.rssi >= -60    ? "rssi-good" :
    req.rssi >= -80    ? "rssi-ok" :
                         "rssi-weak";

  return (
    <div className={`request-card status-${req.status}${isExpanded ? " expanded" : ""}`}>

      {/* ── Clickable header (toggle) ── */}
      <div
        className="card-header"
        onClick={() => setIsExpanded((v) => !v)}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" || e.key === " " ? setIsExpanded((v) => !v) : undefined}
      >
        <div className="card-header-top">
          <div className="card-id-block">
            <span className="card-id">Request #{req.id}</span>
            <span className="card-ts">{formatTimeShort(req.receivedAt)}</span>
          </div>

          <span className={`status-badge ${badgeClass}`}>{badgeLabel}</span>

          {/* Chevron */}
          <span className="card-chevron" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </div>

        <div className="card-header-meta">
          <span className="card-node-badge">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a6 6 0 0 1 12 0"/>
              <path d="M3 5.5a11 11 0 0 1 18 0"/>
              <line x1="12" y1="9" x2="12" y2="22"/>
              <line x1="9" y1="22" x2="15" y2="22"/>
            </svg>
            {req.originNode}
          </span>

          {req.rssi !== null && (
            <span className={`card-rssi-pill ${rssiPillClass}`}>
              {req.rssi} dBm
            </span>
          )}
        </div>
      </div>

      {/* ── Collapsible body ── */}
      <div className="card-body">
        <div className="card-body-inner">

          {/* Field grid */}
          <div className="card-fields">
            {/* Location — full width */}
            <div className="card-field full-width">
              <span className="field-label">Location</span>
              <span className="field-value location-val">{req.location}</span>
            </div>

            <div className="card-field">
              <span className="field-label">RSSI</span>
              <span className={`field-value ${rssiPillClass}`}>
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
              onClick={(e) => { e.stopPropagation(); onStatusChange(req.status === "solved" ? "unmarked" : "solved"); }}
            >
              {Icons.check} Solved
            </button>
            <button
              id={`btn-unresolved-${req.id}`}
              className={`btn-action btn-unresolved ${req.status === "unresolved" ? "active-action" : ""}`}
              onClick={(e) => { e.stopPropagation(); onStatusChange(req.status === "unresolved" ? "unmarked" : "unresolved"); }}
            >
              {Icons.xCircle} Unresolved
            </button>
            {req.status !== "unmarked" && (
              <button
                id={`btn-unmarked-${req.id}`}
                className="btn-action btn-unmarked"
                onClick={(e) => { e.stopPropagation(); onStatusChange("unmarked"); }}
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
              onClick={(e) => e.stopPropagation()}
              rows={2}
            />
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
