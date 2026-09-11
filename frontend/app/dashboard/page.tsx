"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getNodeLocations, getRescueRequests, updateRescueRequest, type NodeLocation, type RescueRequest, type Status } from "../data/rescueApi";
import OlaRescueMap from "../components/OlaRescueMap";

function statusLabel(status: Status) {
  return status === "unresolved" ? "UNRESOLVED" : status === "solved" ? "SOLVED" : "UNMARKED";
}

function stableTime(iso: string) {
  const date = new Date(iso);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${minutes} ${suffix}`;
}

function stableDateTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}, ${stableTime(iso)}`;
}

export default function Dashboard() {
  const [requests, setRequests] = useState<RescueRequest[]>([]);
  const [nodes, setNodes] = useState<NodeLocation[]>([]);
  const [selected, setSelected] = useState<RescueRequest | null>(null);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [nextRequests, nextNodes] = await Promise.all([getRescueRequests(), getNodeLocations()]);
      setRequests(nextRequests);
      setNodes(nextNodes);
      setConnected(true);
      setError("");
      setLastSync(new Date().toISOString());
    } catch {
      setConnected(false);
      setError("Backend unavailable. Start the backend service to load live rescue data.");
    }
  }, []);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 2000);
    return () => clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    if (!selected) {
      if (requests[0]) setSelected(requests[0]);
      return;
    }
    const fresh = requests.find(request => request.id === selected.id);
    const next = fresh || requests[0] || null;
    if (next?.id !== selected.id || next?.status !== selected.status) setSelected(next);
  }, [requests, selected]);

  const visible = useMemo(() => filter === "all" ? requests : requests.filter(request => request.status === filter), [requests, filter]);
  const stats = useMemo(() => {
    const rssiValues = requests.map(request => request.rssi).filter((value): value is number => typeof value === "number");
    return {
      total: requests.length,
      unresolved: requests.filter(request => request.status === "unresolved").length,
      solved: requests.filter(request => request.status === "solved").length,
      unmarked: requests.filter(request => request.status === "unmarked").length,
      avg: rssiValues.length ? Math.round(rssiValues.reduce((sum, value) => sum + value, 0) / rssiValues.length) : 0,
    };
  }, [requests]);

  async function changeStatus(status: Status) {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await updateRescueRequest(selected.id, status);
      setRequests(current => current.map(request => request.id === selected.id ? { ...request, status } : request));
      setSelected(current => current ? { ...current, status } : current);
      setError("");
    } catch {
      setError("The request status could not be updated. Check that the backend is running.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="dash">
      <header className="dashTop">
        <div className="dashTopInner container">
          <Link href="/" className="brand"><img src="/rescue-monitor-logo.jpg" alt="RescueMesh" /><span>RESCUE<span>MESH</span></span></Link>
          <div className="connection"><span className="greenDot" /> {connected ? "BACKEND CONNECTED" : "WAITING FOR BACKEND"} <small>·</small> RESCUE NODE</div>
          <Link href="/" className="backLink">← Home</Link>
        </div>
      </header>

      <section className="dashBody container">
        <div className="dashTitle">
          <div><div className="sectionKicker">OPERATIONS / LIVE CONSOLE</div><h1>Rescue operations</h1><p>Incoming emergency requests and mesh telemetry from the project backend.</p></div>
          <div className="gateway"><span className="greenDot" /> {connected ? "Gateway connected" : "Gateway waiting"} <strong>115200 baud</strong>{lastSync && <small> · sync {stableTime(lastSync)}</small>}</div>
        </div>

        {error && <div className="apiNotice">{error}</div>}

        <div className="statGrid">
          <Stat label="Total requests" value={stats.total} meta="Backend records" />
          <Stat label="Unresolved" value={stats.unresolved} meta="Requires attention" alert />
          <Stat label="Solved" value={stats.solved} meta="Closed requests" />
          <Stat label="Unmarked" value={stats.unmarked} meta="Awaiting operator action" />
          <Stat label="Average RSSI" value={`${stats.avg} dBm`} meta="Received requests" />
        </div>

        <div className="dashGrid">
          <section className="panel requestsPanel">
            <div className="panelHead"><div><h2>Rescue requests</h2><span>{visible.length} visible requests</span></div><div className="filters">
              {(["all", "unresolved", "solved", "unmarked"] as const).map(filterValue => <button key={filterValue} className={filter === filterValue ? "active" : ""} onClick={() => setFilter(filterValue)}>{filterValue}</button>)}
            </div></div>
            <div className="requestList">
              {visible.length ? visible.map(request => (
                <button className={`requestItem ${selected?.id === request.id ? "selected" : ""}`} key={request.id} onClick={() => setSelected(request)}>
                  <div className="requestTop"><strong>Request #{request.id}</strong><span className={`status ${request.status}`}>{statusLabel(request.status)}</span></div>
                  <div className="requestLocation">{request.location}</div>
                  <div className="requestMeta"><span>{request.originNode}</span><span>{request.hopCount ?? 0} hops</span><span>{request.rssi ?? "—"} dBm</span><time>{stableTime(request.receivedAt)}</time></div>
                </button>
              )) : <div className="emptyState">No rescue requests are available from the backend yet.</div>}
            </div>
          </section>

          <section className="panel detailPanel">
            {selected ? <>
              <div className="panelHead"><div><h2>Request #{selected.id}</h2><span>Received {stableDateTime(selected.receivedAt)}</span></div><span className={`status ${selected.status}`}>{statusLabel(selected.status)}</span></div>
              <div className="detailHero"><div className="locationPin">⌖</div><div><small>LOCATION</small><strong>{selected.location}</strong></div></div>
              <div className="detailGrid">
                <Detail label="Origin node" value={selected.originNode} /><Detail label="RSSI" value={selected.rssi == null ? "—" : `${selected.rssi} dBm`} />
                <Detail label="Hop count" value={selected.hopCount == null ? "—" : String(selected.hopCount)} /><Detail label="Device timestamp" value={selected.deviceTimestamp} />
                <Detail label="Origin root" value={selected.originRoot} mono /><Detail label="Final root" value={selected.finalRoot} mono />
                <Detail label="Encryption" value={selected.encryption} /><Detail label="Authentication" value={selected.auth} />
              </div>
              <div className="notes"><small>OPERATOR NOTES</small><p>{selected.notes || "No notes recorded for this request."}</p></div>
              <div className="detailActions">
                <button className="solveBtn" disabled={saving || selected.status === "solved"} onClick={() => changeStatus("solved")}>✓ Mark solved</button>
                <button className="ghostBtn" disabled={saving || selected.status === "unresolved"} onClick={() => changeStatus("unresolved")}>Keep unresolved</button>
              </div>
            </> : <div className="emptyDetail">Select a rescue request to inspect its telemetry.</div>}
          </section>
        </div>

        <section className="panel networkPanel">
          <div className="panelHead"><div><h2>Mesh network</h2><span>Latest NodeLocation records from the backend</span></div><span className="liveTag"><span className="greenDot" /> {connected ? "LIVE API" : "OFFLINE"}</span></div>
          <NetworkMap nodes={nodes} requests={requests} />
          <div className="nodeTable">
            {nodes.length ? nodes.map(node => <div className="nodeRow" key={`${node.node_id}-${node.timestamp}`}><strong>{node.node_id}</strong><span>{node.latitude.toFixed(4)}, {node.longitude.toFixed(4)}</span><span>{stableDateTime(node.timestamp)}</span><span>NodeLocation</span><span className="healthy">Reported</span></div>) : <div className="emptyState">No node locations are available from the backend yet.</div>}
          </div>
        </section>

        <div className="techStrip"><span>Ed25519</span><span>X25519</span><span>ChaCha20-Poly1305</span><span>LoRa 433 MHz</span><span>115200 baud</span><span>Merkle-root routing</span><span>API polling · 2s</span></div>
      </section>
    </main>
  );
}

function NetworkMap({ nodes, requests }: { nodes: NodeLocation[]; requests: RescueRequest[] }) {
  return <OlaRescueMap nodes={nodes} requests={requests} />;
}

function Stat({ label, value, meta, alert = false }: { label: string; value: string | number; meta: string; alert?: boolean }) {
  return <article className="stat"><span>{label}</span><strong className={alert ? "statAlert" : ""}>{value}</strong><small>{meta}</small></article>;
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="detail"><small>{label}</small><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}
