export type Status = "unresolved" | "solved" | "unmarked";

export type RescueRequest = {
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
  status: Status;
  notes: string;
};

export type NodeLocation = {
  id: number;
  node_id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5500";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export function getRescueRequests(): Promise<RescueRequest[]> {
  return getJson<RescueRequest[]>("/api/rescue-request");
}

export function getNodeLocations(): Promise<NodeLocation[]> {
  return getJson<NodeLocation[]>("/api/node-location");
}

export async function updateRescueRequest(id: number, status: Status): Promise<RescueRequest> {
  const response = await fetch(`${API_BASE}/api/rescue-request/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<RescueRequest>;
}
