"use client";

import { useMemo } from "react";
import type { NodeLocation, RescueRequest } from "../data/rescueApi";

type Coordinate = [number, number];

const FALLBACK_CENTER: Coordinate = [78.4867, 17.385];
const STATIC_STYLE = "default-light-standard";
const STATIC_WIDTH = 1200;
const STATIC_HEIGHT = 390;

function parseLocation(value: string): Coordinate | null {
  const [latText, lngText] = value.split(",").map(part => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

function requestPoints(requests: RescueRequest[]) {
  return requests.flatMap(request => {
    const coordinate = parseLocation(request.location);
    return coordinate ? [{ request, coordinate }] : [];
  });
}

function nodePoints(nodes: NodeLocation[]) {
  const latest = Array.from(new Map(nodes.map(node => [node.node_id, node])).values());
  return latest.map(node => ({
    node,
    coordinate: [node.longitude, node.latitude] as Coordinate,
  }));
}

function boundsFor(points: Coordinate[]) {
  if (!points.length) {
    const [lng, lat] = FALLBACK_CENTER;
    return { minLng: lng - 0.02, minLat: lat - 0.02, maxLng: lng + 0.02, maxLat: lat + 0.02 };
  }

  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngPad = Math.max((maxLng - minLng) * 0.18, 0.003);
  const latPad = Math.max((maxLat - minLat) * 0.18, 0.003);

  return {
    minLng: minLng - lngPad,
    minLat: minLat - latPad,
    maxLng: maxLng + lngPad,
    maxLat: maxLat + latPad,
  };
}

function markerPosition(coordinate: Coordinate, bounds: ReturnType<typeof boundsFor>) {
  const [lng, lat] = coordinate;
  const x = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return { left: `${x}%`, top: `${y}%` };
}

export default function OlaRescueMap({ nodes, requests }: { nodes: NodeLocation[]; requests: RescueRequest[] }) {
  const apiKey = process.env.NEXT_PUBLIC_OLA_MAPS_API_KEY;
  const requestsWithCoordinates = useMemo(() => requestPoints(requests), [requests]);
  const nodesWithCoordinates = useMemo(() => nodePoints(nodes), [nodes]);
  const points = useMemo(
    () => [
      ...requestsWithCoordinates.map(item => item.coordinate),
      ...nodesWithCoordinates.map(item => item.coordinate),
    ],
    [requestsWithCoordinates, nodesWithCoordinates],
  );
  const bounds = useMemo(() => boundsFor(points), [points]);

  if (!apiKey) {
    return (
      <div className="olaMapWrap">
        <div className="olaMapTopbar"><span><i className="olaLegendSignal" /> RESCUE SIGNAL</span><span><i className="olaLegendNode" /> MESH NODE</span><span className="olaMapStatus">MAP ERROR</span></div>
        <div className="olaMapError">Ola Maps API key is not configured. Add NEXT_PUBLIC_OLA_MAPS_API_KEY to frontend/.env.local.</div>
      </div>
    );
  }

  const bbox = `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`;
  const mapUrl = `https://api.olamaps.io/tiles/v1/styles/${STATIC_STYLE}/static/${bbox}/${STATIC_WIDTH}x${STATIC_HEIGHT}.png?api_key=${encodeURIComponent(apiKey)}`;

  return (
    <div className="olaMapWrap">
      <img className="olaStaticMap" src={mapUrl} alt="Ola Maps operational map" />
      <div className="olaMapMarkers" aria-hidden="true">
        {nodesWithCoordinates.map(({ node, coordinate }) => (
          <div key={`node-${node.node_id}`} className="olaMarker olaNodeMarker" style={markerPosition(coordinate, bounds)} title={node.node_id}>
            <span />
            <small>{node.node_id}</small>
          </div>
        ))}
        {requestsWithCoordinates.map(({ request, coordinate }) => (
          <div key={`request-${request.id}`} className="olaMarker olaRequestMarker" style={markerPosition(coordinate, bounds)} title={`SOS #${request.id}`}>
            <span />
            <small>SOS #{request.id}</small>
          </div>
        ))}
      </div>
      <div className="olaMapTopbar">
        <span><i className="olaLegendSignal" /> RESCUE SIGNAL</span>
        <span><i className="olaLegendNode" /> MESH NODE</span>
        <span className="olaMapStatus">OLA MAPS · LIVE DATA</span>
      </div>
    </div>
  );
}
