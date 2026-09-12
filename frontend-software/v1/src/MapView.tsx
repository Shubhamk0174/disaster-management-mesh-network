import { useEffect, useRef } from "react";
import { OlaMaps } from "olamaps-web-sdk";


// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface SosMarker {
  id: number;
  originNode: string;
  location: string;      // raw string, e.g. "12.93142, 77.61648" or "LAT:12.93142,LON:77.61648"
  receivedAt: number;
  status: string;
}

interface MapViewProps {
  markers: SosMarker[];
}

// ─────────────────────────────────────────────
// Parse lat/lon from various string formats
// ─────────────────────────────────────────────

function parseLatLon(location: string): [number, number] | null {
  if (!location || location === "—") return null;

  // Format: "LAT:12.9314,LON:77.6164"
  const labeled = location.match(/LAT[:\s]*([+-]?\d+\.?\d*)[,\s]+LON[:\s]*([+-]?\d+\.?\d*)/i);
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
  if (status === "solved")     return "#22c55e";   // green
  if (status === "unresolved") return "#ef4444";   // red
  return "#f59e0b";                                 // amber – unmarked
}

// ─────────────────────────────────────────────
// Custom SVG marker element
// ─────────────────────────────────────────────

function createMarkerEl(color: string, label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "sos-marker";
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
// Component
// ─────────────────────────────────────────────

const OLA_API_KEY = import.meta.env.VITE_OLA_API_KEY as string;
const DEFAULT_CENTER: [number, number] = [77.209, 28.6139]; // New Delhi fallback

export default function MapView({ markers }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef      = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef  = useRef<any[]>([]);

  // ── Init map once ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mapInstance: any = null;

    const init = async () => {
      const olaMaps = new OlaMaps({ apiKey: OLA_API_KEY });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map: any = await (olaMaps as any).init({
        style:
          "https://api.olamaps.io/tiles/vector/v1/styles/default-light-standard/style.json",
        container: containerRef.current!,
        center: DEFAULT_CENTER,   // [lng, lat]
        zoom: 5,
        attributionControl: false,
      });
      if (destroyed) { map.remove(); return; }
      mapInstance = map;
      mapRef.current = map;
    };

    init().catch(console.error);

    return () => {
      destroyed = true;
      if (mapInstance) { mapInstance.remove(); }
      mapRef.current = null;
    };
  }, []);

  // ── Sync markers ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const olaMaps = new OlaMaps({ apiKey: OLA_API_KEY });

    // Remove old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const validMarkers: Array<{ lat: number; lon: number }> = [];

    markers.forEach((sos) => {
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
            <div class="sos-popup-time">${new Date(sos.receivedAt).toLocaleTimeString("en-GB")}</div>
          </div>
        `);

      const marker = olaMaps
        .addMarker({ element: el, anchor: "bottom" })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Auto-fit bounds if we have markers
    if (validMarkers.length === 1) {
      map.flyTo({ center: [validMarkers[0].lon, validMarkers[0].lat], zoom: 13 });
    } else if (validMarkers.length > 1) {
      const lngs = validMarkers.map((m) => m.lon);
      const lats = validMarkers.map((m) => m.lat);
      const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)];
      const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)];
      map.fitBounds([sw, ne], { padding: 80 });
    }
  }, [markers]);

  return (
    <div className="map-wrapper">
      {/* Map canvas */}
      <div ref={containerRef} className="map-canvas" />

      {/* Legend */}
      <div className="map-legend">
        <div className="legend-title">SOS Markers</div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: "#ef4444" }} /> Unresolved
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: "#f59e0b" }} /> Unmarked
        </div>
        <div className="legend-row">
          <span className="legend-dot" style={{ background: "#22c55e" }} /> Solved
        </div>
      </div>

      {/* Empty state */}
      {markers.filter(m => parseLatLon(m.location)).length === 0 && (
        <div className="map-empty">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <p>No GPS coordinates yet</p>
        </div>
      )}
    </div>
  );
}
