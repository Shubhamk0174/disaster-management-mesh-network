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

async function getJson(path: string) {
  const response = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

export async function getRescueRequests() {
  return (await getJson("/api/rescue-request")) as RescueRequest[];
}

export async function getNodeLocations() {
  return (await getJson("/api/node-location")) as NodeLocation[];
}

export async function updateRescueRequest(id: number, status: Status) {
  const response = await fetch(`${API_BASE}/api/rescue-request/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<RescueRequest>;
}
