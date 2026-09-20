import { useEffect, useRef, useState } from "react";
import { OlaMaps } from "olamaps-web-sdk";
import { cacheGet, cachePut } from "./offlineMapCache";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SosMarker {
  id:         number;
  originNode: string;
  location:   string;      // e.g. "12.93142, 77.61648" or "LAT:12.93142,LON:77.61648"
  receivedAt: number;
  status:     string;
}

interface MapViewProps {
  markers: SosMarker[];
}

// ─────────────────────────────────────────────
// Offline Fetch Interceptor
//
// Installed exactly once when this module is first evaluated.
// Transparently intercepts every fetch() to olamaps.io:
//   • Cache hit  → serve instantly from IndexedDB (works offline)
//   • Cache miss → fetch from network, store result in IndexedDB
//
// Tiles, the style JSON, sprites and glyphs are all cached
// automatically as the user browses — no manual download step.
// ─────────────────────────────────────────────

const OLAMAPS_HOST = 'olamaps.io';
let _interceptorInstalled = false;

function installFetchInterceptor(): void {
  if (_interceptorInstalled || typeof window === 'undefined') return;
  _interceptorInstalled = true;

  const _orig = window.fetch.bind(window);

  window.fetch = async function offlineCacheFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      input instanceof Request ? input.url
      : input instanceof URL   ? input.toString()
      : String(input);

    // Pass through any non-OlaMaps request unchanged
    if (!url.includes(OLAMAPS_HOST)) {
      return _orig(input, init);
    }

    // ── Cache-first ───────────────────────────────────────────────
    const hit = await cacheGet(url);
    if (hit) {
      return new Response(hit.data, {
        status: 200,
        headers: { 'Content-Type': hit.contentType, 'X-Cache': 'HIT' },
      });
    }

    // ── Network → write to cache ──────────────────────────────────
    let resp: Response;
    try {
      resp = await _orig(input, init);
    } catch (err) {
      // Fully offline, nothing cached — re-throw so MapLibre shows blank tiles
      throw err;
    }

    if (resp.ok) {
      // Clone before consuming the body so MapLibre still gets a fresh stream
      resp.clone().arrayBuffer().then(buf => {
        const ct = resp.headers.get('content-type') ?? 'application/octet-stream';
        cachePut(url, buf, ct).catch(() => { /* storage quota exceeded — ignore */ });
      });
    }

    return resp;
  };
}

// Install as soon as the module is evaluated (before any map init)
installFetchInterceptor();

// ─────────────────────────────────────────────
// Parse lat/lon from various string formats
// ─────────────────────────────────────────────

function parseLatLon(location: string): [number, number] | null {
  if (!location || location === '—') return null;

  // Format: "LAT:12.9314,LON:77.6164"
  const labeled = location.match(
    /LAT[:\s]*([+-]?\d+\.?\d*)[,\s]+LON[:\s]*([+-]?\d+\.?\d*)/i,
  );
  if (labeled) {
    const lat = parseFloat(labeled[1]);
    const lon = parseFloat(labeled[2]);
    if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
  }

  // Format: "12.9314, 77.6164" or "12.9314,77.6164"
  const plain = location.match(/([+-]?\d+\.?\d*)[,\s]+([+-]?\d+\.?\d*)/);
  if (plain) {
    const a = parseFloat(plain[1]);
    const b = parseFloat(plain[2]);
    if (!isNaN(a) && !isNaN(b)) return [a, b];
  }

  return null;
}

// ─────────────────────────────────────────────
// Status → marker colour
// ─────────────────────────────────────────────

function markerColor(status: string): string {
  if (status === 'solved')     return '#22c55e';
  if (status === 'unresolved') return '#ef4444';
  return '#f59e0b';
}

// ─────────────────────────────────────────────
// Custom SVG marker element
// ─────────────────────────────────────────────

function createMarkerEl(color: string, label: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'sos-marker';
  el.innerHTML = `
    <div class="sos-pin" style="--pin-color:${color}">
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z"
          fill="${color}" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
        <circle cx="16" cy="16" r="7" fill="rgba(0,0,0,0.25)"/>
        <text x="16" y="21" text-anchor="middle" fill="#fff"
          font-size="9" font-family="sans-serif" font-weight="bold">SOS</text>
      </svg>
      <div class="sos-label">${label}</div>
    </div>
  `;
  return el;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const OLA_API_KEY     = import.meta.env.VITE_OLA_API_KEY as string;
const STYLE_URL       = 'https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json';
const DEFAULT_CENTER: [number, number] = [77.209, 28.6139]; // New Delhi fallback

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function MapView({ markers }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef      = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef  = useRef<any[]>([]);

  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // ── Online / offline listener ──────────────────────────────────
  useEffect(() => {
    const up   = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online',  up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online',  up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // ── Init map once ──────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapInst: any = null;

    const init = async () => {
      const olaMaps = new OlaMaps({ apiKey: OLA_API_KEY });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map: any = await (olaMaps as any).init({
        style:              STYLE_URL,
        container:          containerRef.current!,
        center:             DEFAULT_CENTER,
        zoom:               5,
        attributionControl: false,
      });
      if (destroyed) { map.remove(); return; }
      mapInst        = map;
      mapRef.current = map;
    };

    init().catch(console.error);

    return () => {
      destroyed = true;
      if (mapInst) { mapInst.remove(); }
      mapRef.current = null;
    };
  }, []);

  // ── Sync markers ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const olaMaps = new OlaMaps({ apiKey: OLA_API_KEY });

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const validMarkers: Array<{ lat: number; lon: number }> = [];

    markers.forEach(sos => {
      const coords = parseLatLon(sos.location);
      if (!coords) return;
      const [lat, lon] = coords;
      validMarkers.push({ lat, lon });

      const el = createMarkerEl(markerColor(sos.status), sos.originNode);

      const popup = olaMaps
        .addPopup({ offset: [0, -36], closeButton: false })
        .setHTML(`
          <div class="sos-popup">
            <div class="sos-popup-node">${sos.originNode}</div>
            <div class="sos-popup-loc">${sos.location}</div>
            <div class="sos-popup-status sos-status-${sos.status}">${sos.status.toUpperCase()}</div>
            <div class="sos-popup-time">${new Date(sos.receivedAt).toLocaleTimeString('en-GB')}</div>
          </div>
        `);

      const marker = olaMaps
        .addMarker({ element: el, anchor: 'bottom' })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Auto-fit bounds if we have markers
    if (validMarkers.length === 1) {
      map.flyTo({ center: [validMarkers[0].lon, validMarkers[0].lat], zoom: 16 });
    } else if (validMarkers.length > 1) {
      const lngs = validMarkers.map(m => m.lon);
      const lats = validMarkers.map(m => m.lat);
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      map.fitBounds([sw, ne], { padding: 250 });
    }
  }, [markers]);

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="map-wrapper">

      {/* Map canvas */}
      <div ref={containerRef} className="map-canvas" />

      {/* Offline badge — appears automatically when network is lost */}
      {!isOnline && (
        <div className="map-offline-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          OFFLINE — cached tiles
        </div>
      )}

      {/* Legend */}
      <div className="map-legend">
        <div className="legend-title">SOS Markers</div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: '#ef4444' }} /> Unresolved
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: '#f59e0b' }} /> Unmarked
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: '#22c55e' }} /> Solved
        </div>
      </div>

      {/* Empty state */}
      {markers.filter(m => parseLatLon(m.location)).length === 0 && (
        <div className="map-empty">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <p>No GPS coordinates yet</p>
        </div>
      )}
    </div>
  );
}
