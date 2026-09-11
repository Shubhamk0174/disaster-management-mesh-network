import Link from "next/link";

const capabilities = [
  ["01", "Infrastructure independent", "Keeps emergency communication alive when cellular, Wi-Fi, and internet infrastructure cannot be trusted."],
  ["02", "Multi-hop by design", "ESP32-LoRa nodes relay rescue requests across the field until a Rescue Node receives them."],
  ["03", "Secure at the payload", "Ed25519 authentication, X25519 key agreement, and ChaCha20-Poly1305 protect the message path."],
];

const flow = [
  ["FIELD NODE", "SOS request originates", "A rescue request is created with location and device telemetry."],
  ["MESH RELAYS", "Message finds a path", "Nearby nodes forward the request while the Merkle-root path prevents duplicate routing."],
  ["RESCUE NODE", "Gateway receives", "The final node verifies, decrypts, and prepares the request for operations."],
];

const homepageNodes = [
  { id: "01", type: "FIELD", x: 19, y: 38 },
  { id: "02", type: "RELAY", x: 43, y: 58 },
  { id: "03", type: "RELAY", x: 67, y: 35 },
  { id: "R", type: "RESCUE", x: 80, y: 74 },
];

export default function Home() {
  return (
    <main className="landing">
      <nav className="nav container">
        <Link href="/" className="brand">
          <img src="/rescue-monitor-logo.jpg" alt="RescueMesh logo" />
          <span>RESCUE<span>MESH</span></span>
        </Link>
        <div className="navLinks">
          <a href="#network">Network</a>
          <a href="#security">Security</a>
          <Link href="/dashboard" className="navCta">Open dashboard <span>↗</span></Link>
        </div>
      </nav>

      <section className="hero container">
        <div className="heroCopy">
          <div className="eyebrow"><span className="pulseDot" /> DISASTER COMMUNICATION SYSTEM</div>
          <div className="projectTitle">
            <span className="projectMark">RM</span>
            <div>
              <h1>Rescue<span>Mesh</span></h1>
              <p>Infrastructure-independent emergency communication.</p>
            </div>
          </div>
          <p className="heroText">
            A resilient LoRa mesh that lets emergency requests travel through disconnected
            environments using distributed ESP32 relay nodes and a dedicated Rescue Node gateway.
          </p>
          <div className="heroActions">
            <Link href="/dashboard" className="primaryBtn">Launch rescue console <span>→</span></Link>
            <a href="#network" className="secondaryBtn">See how it works</a>
          </div>
          <div className="heroSpecs">
            <span><b>433</b> MHz LoRa</span><span><b>ESP32</b> Nodes</span><span><b>Multi-hop</b> Routing</span><span><b>Encrypted</b> Payloads</span>
          </div>
        </div>

        <div className="networkScene" id="network">
          <div className="sceneTop"><span><i /> NETWORK TOPOLOGY</span><b>FIELD NETWORK / 04 NODES</b></div>
          <FakeMap className="heroMap" nodes={homepageNodes} />
          <div className="mapCoordinate">17.3850° N / 78.4867° E</div>
          <div className="mapOverlay mapOverlayBottom">
            <span><b>ACTIVE ROUTE</b> NODE-01 → NODE-02 → NODE-03 → RESCUE</span>
            <span><b>RADIO RANGE</b> RELAY COVERAGE</span>
            <span><b>GATEWAY</b> RESCUE NODE</span>
          </div>
        </div>
      </section>

      <section className="proofBar container">
        <div><span className="proofValue">01</span><span>Rescue Node<br/><small>gateway bridge</small></span></div>
        <div><span className="proofValue">∞</span><span>Multi-hop<br/><small>relay architecture</small></span></div>
        <div><span className="proofValue">0</span><span>Internet dependency<br/><small>for field relays</small></span></div>
        <div><span className="proofValue">3</span><span>Security primitives<br/><small>auth + agreement + AEAD</small></span></div>
      </section>

      <section className="capabilities container" id="security">
        <div className="sectionIntro"><div><div className="sectionKicker">WHY RESCUEMESH</div><h2>Built for the moment ordinary networks disappear.</h2></div><p>Every part of the system is shaped around one constraint: emergency communication has to keep working without dependable infrastructure.</p></div>
        <div className="capGrid">{capabilities.map(([num,title,text]) => <article className="capCard" key={num}><span className="cardNum">{num}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
      </section>

      <section className="architecture container">
        <div className="sectionKicker">FROM SIGNAL TO RESPONSE</div>
        <div className="sectionHead"><h2>A request moves. The network adapts.</h2><p>Distributed field nodes create a path to the Rescue Node, where verified requests become actionable rescue intelligence.</p></div>
        <div className="flowGrid">{flow.map(([tag,title,text],i) => <article className="flowCard" key={tag}><span className="flowNum">0{i+1}</span><div className="flowTag">{tag}</div><h3>{title}</h3><p>{text}</p>{i<flow.length-1&&<span className="flowArrow">→</span>}</article>)}</div>
      </section>

      <section className="securityBand container">
        <div className="securityOrb"><span>SECURE</span><b>RM</b></div>
        <div><div className="sectionKicker">TRUSTED TELEMETRY</div><h2>Authenticated. Encrypted. Traceable.</h2><p>Requests carry the operational metadata surfaced in the Rescue Monitor: origin node, location, RSSI, hop count, device timestamp, Merkle roots, encryption, authentication, and status.</p><div className="protocols"><span>Ed25519</span><span>X25519</span><span>ChaCha20-Poly1305</span><span>Merkle roots</span></div></div>
      </section>

      <section className="ctaBand container">
        <div><div className="sectionKicker">OPERATIONS CONSOLE</div><h2>Turn the mesh into a rescue picture.</h2><p>Inspect incoming requests, signal strength, routes, node health, and security metadata from one focused operator view.</p></div>
        <Link href="/dashboard" className="primaryBtn">Enter dashboard →</Link>
      </section>

      <footer className="footer container"><div className="brand"><img src="/rescue-monitor-logo.jpg" alt="" /><span>RESCUE<span>MESH</span></span></div><span>Emergency communication, designed for disconnected environments.</span></footer>
    </main>
  );
}

function FakeMap({ className, nodes }: { className?: string; nodes: { id: string; type: string; x: number; y: number }[] }) {
  const points = nodes.map(node => `${node.x},${node.y}`).join(" ");
  return (
    <div className={`fakeMap ${className ?? ""}`}>
      <svg className="mapTexture" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <rect width="100" height="100" className="mapLand" />
        <path className="mapWater" d="M0 14 C12 9 20 21 30 17 C42 12 51 9 63 14 C77 20 86 11 100 8 L100 0 L0 0Z" />
        <path className="mapWater" d="M100 73 C89 66 83 75 73 72 C63 69 56 76 46 73 C34 69 27 80 17 77 C10 75 6 81 0 82 L0 100 L100 100Z" />
        <path className="mapPark" d="M5 26 C12 20 21 22 25 29 C21 37 11 38 5 33Z" />
        <path className="mapPark" d="M75 15 C83 10 94 15 97 23 C90 29 79 27 75 15Z" />
        <path className="mapPark" d="M53 79 C61 72 72 77 73 87 C65 94 55 91 53 79Z" />
        <g className="mapBlocks">
          <path d="M3 44 H29 M4 49 H31 M2 54 H26 M8 59 H35 M13 64 H40 M25 42 V67 M34 39 V71" />
          <path d="M59 34 H96 M57 40 H99 M60 46 H95 M64 52 H98 M58 58 H92 M71 31 V61 M83 28 V65 M92 30 V58" />
          <path d="M8 85 H45 M15 90 H50 M27 95 H58 M18 81 V99 M31 78 V100 M43 82 V99" />
        </g>
        <g className="mapRoads">
          <path className="mapRoad major" d="M-4 61 C19 55 32 60 46 56 C63 51 75 53 104 43" />
          <path className="mapRoad major" d="M38 -4 C43 16 45 30 48 47 C51 66 58 83 66 104" />
          <path className="mapRoad" d="M-4 31 C18 34 28 28 47 31 C67 35 82 33 104 28" />
          <path className="mapRoad" d="M6 101 C13 78 20 68 30 52 C41 36 49 28 63 18 C75 10 88 6 103 4" />
          <path className="mapRoad" d="M-2 75 C17 72 27 77 41 81 C55 85 73 82 101 88" />
        </g>
        <polyline points={points} className="mapRoute" />
        {nodes.map(node => <circle key={node.id} cx={node.x} cy={node.y} r="10" className="mapCoverage" />)}
      </svg>
      {nodes.map(node => (
        <div key={node.id} className={`fakeNode ${node.id === "R" ? "rescueNode" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }}>
          <span>{node.id}</span>
          <small>{node.type}</small>
        </div>
      ))}
      <div className="mapScale">N ↑</div>
      <div className="mapGridLabel labelA">FIELD ZONE</div>
      <div className="mapGridLabel labelB">RELAY CORRIDOR</div>
      <div className="mapGridLabel labelC">RESCUE GATEWAY</div>
    </div>
  );
}
