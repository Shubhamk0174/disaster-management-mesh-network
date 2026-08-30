/*
  ============================================================================
  NON-RESCUE NODE FIRMWARE (ESP32)
  ============================================================================
  Flash this SAME sketch onto every non-rescue ESP32.
  Only two lines need to change per device:

     NODE_ID    -> unique for every node  ("NODE_1", "NODE_2", "NODE_3"...)
     IS_SENDER  -> true on EXACTLY ONE node (the one that originates the
                   rescue message every 10 minutes). false on all others.

  If IS_SENDER = true, also fill in NODE_LAT / NODE_LNG / NODE_ADDRESS /
  ALERT_TEXT below with that node's location + the message to send.

  HOW IT WORKS
  ------------
  - Every node runs its own WiFi Access Point (SSID = NODE_ID) AND a WiFi
    Station radio at the same time (AP+STA mode).
  - The AP hosts a tiny web server with a single endpoint: POST /relay
  - To find the "nearest" node, a node scans for WiFi networks named
    NODE_... or RESCUE_NODE and picks the one with the strongest signal
    (RSSI) - i.e. physically closest.
  - It connects to that node as a station, POSTs the JSON message to
    http://192.168.4.1/relay (192.168.4.1 is the default ESP32 SoftAP
    gateway IP), then disconnects and goes back to just being an AP.
  - Every hop appends its NODE_ID to header.path[] and rolls the hash:
        message_id = SHA256(previous_message_id + this_node_id)
    This is a hash CHAIN (not a branching Merkle tree, since the route
    is linear) - it lets you prove after the fact exactly which nodes
    a message traveled through and in what order.
  ============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

// ---------------------------------------------------------------------------
// PER-DEVICE CONFIG - CHANGE THESE FOR EVERY NODE
// ---------------------------------------------------------------------------
const char* NODE_ID   = "NODE_1";     // <-- unique per device: NODE_1, NODE_2, ...
const bool  IS_SENDER = true;        // <-- true on ONLY ONE node in the whole mesh

// Only used if IS_SENDER == true (ignored otherwise)
const double NODE_LAT     = 16.5062;
const double NODE_LNG     = 80.6480;
const char*  NODE_ADDRESS = "Near RTC Bus Stand, Vijayawada";
const char*  ALERT_TEXT   = "Person trapped, needs rescue";

// ---------------------------------------------------------------------------
// SHARED MESH CONFIG - MUST BE IDENTICAL ON EVERY NODE + THE RESCUE NODE
// ---------------------------------------------------------------------------
const char* MESH_PASSWORD    = "mesh12345";   // WiFi password for every node's AP
const char* NODE_SSID_PREFIX = "NODE_";       // used to recognize other mesh nodes
const char* RESCUE_SSID      = "RESCUE_NODE"; // exact SSID broadcast by the rescue node

const unsigned long SEND_INTERVAL_MS      = 10UL * 60UL * 1000UL; // 10 minutes
const int            WIFI_CONNECT_TIMEOUT_MS = 8000;

WebServer server(80);
unsigned long lastSendTime = 0;

// ---------------------------------------------------------------------------
// SHA256 helper (built into ESP32 core via mbedtls, no extra library needed)
// ---------------------------------------------------------------------------
String sha256Hex(const String &input) {
  byte hash[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_type_t md_type = MBEDTLS_MD_SHA256;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(md_type), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_md_finish(&ctx, hash);
  mbedtls_md_free(&ctx);

  String hex = "";
  char buf[3];
  for (int i = 0; i < 32; i++) {
    sprintf(buf, "%02x", hash[i]);
    hex += buf;
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Start this node's own Access Point (so other nodes can find & reach it)
// ---------------------------------------------------------------------------
void startAccessPoint() {
  WiFi.mode(WIFI_AP_STA);
  bool apOk = WiFi.softAP(NODE_ID, MESH_PASSWORD);

  Serial.println("--------------------------------------------------");
  if (apOk) {
    Serial.print("[WIFI] Access Point STARTED. SSID: ");
    Serial.println(NODE_ID);
    Serial.print("[WIFI] AP IP address: ");
    Serial.println(WiFi.softAPIP());
  } else {
    Serial.println("[WIFI] ERROR: Failed to start Access Point!");
  }
  Serial.println("--------------------------------------------------");
}

// ---------------------------------------------------------------------------
// Scan for nearby mesh nodes, pick the strongest signal, forward the message
// ---------------------------------------------------------------------------
void forwardToNearestNode(JsonDocument &doc) {
  Serial.println("[MESH] Scanning for nearby nodes...");
  int n = WiFi.scanNetworks();

  int bestIndex = -1;
  int bestRSSI  = -1000;
  JsonArray path = doc["header"]["path"];

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid == NODE_ID) continue; // never pick ourselves

    bool isRescue = (ssid == RESCUE_SSID);
    bool isNode   = ssid.startsWith(NODE_SSID_PREFIX);
    if (!isRescue && !isNode) continue; // not part of our mesh, ignore

    // avoid sending it back to a node that's already in the path (loop guard)
    // the rescue node is never skipped, since that's always our target
    bool alreadyVisited = false;
    for (JsonVariant v : path) {
      if (String((const char*)v) == ssid) { alreadyVisited = true; break; }
    }
    if (alreadyVisited && !isRescue) continue;

    int rssi = WiFi.RSSI(i);
    if (rssi > bestRSSI) {
      bestRSSI  = rssi;
      bestIndex = i;
    }
  }
  WiFi.scanDelete();

  if (bestIndex == -1) {
    Serial.println("[MESH] No reachable node found right now. Will try again next cycle.");
    return;
  }

  String targetSSID = WiFi.SSID(bestIndex);
  Serial.print("[MESH] Nearest node found: ");
  Serial.print(targetSSID);
  Serial.print("   (signal strength RSSI: ");
  Serial.print(bestRSSI);
  Serial.println(")");

  Serial.print("[WIFI] Connecting to ");
  Serial.print(targetSSID);
  Serial.println(" ...");
  WiFi.begin(targetSSID.c_str(), MESH_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Connection to next node FAILED (out of range or busy). Will retry next cycle.");
    return;
  }

  Serial.print("[WIFI] Connected to next node! Local IP: ");
  Serial.println(WiFi.localIP());

  HTTPClient http;
  http.begin("http://192.168.4.1/relay");
  http.addHeader("Content-Type", "application/json");
  String payload;
  serializeJson(doc, payload);

  Serial.println("[HTTP] Forwarding message:");
  Serial.println(payload);

  int code = http.POST(payload);
  Serial.print("[HTTP] Forward response code: ");
  Serial.println(code);
  http.end();

  WiFi.disconnect();
  Serial.println("[WIFI] Disconnected from next node. Back to just hosting our own AP.");
}

// ---------------------------------------------------------------------------
// Build a brand-new message (only the sender node does this, every 10 min)
// ---------------------------------------------------------------------------
void buildAndSendNewMessage() {
  DynamicJsonDocument doc(2048);

  JsonObject header = doc.createNestedObject("header");
  header["origin_node_id"] = NODE_ID;
  header["message_id"]     = sha256Hex(String(NODE_ID) + String(millis())); // seed hash
  header["timestamp_ms"]   = millis(); // see notes: non-rescue nodes have no internet clock
  JsonArray path = header.createNestedArray("path");
  path.add(NODE_ID);

  JsonObject body = doc.createNestedObject("body");
  JsonObject loc  = body.createNestedObject("location");
  loc["lat"] = NODE_LAT;
  loc["lng"] = NODE_LNG;
  body["address"] = NODE_ADDRESS;
  body["message"] = ALERT_TEXT;

  forwardToNearestNode(doc);
}

// ---------------------------------------------------------------------------
// Handle a message that another node forwarded to us
// ---------------------------------------------------------------------------
void handleIncomingMessage() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "No body");
    return;
  }
  String body = server.arg("plain");

  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    server.send(400, "text/plain", "Bad JSON");
    return;
  }

  Serial.println("[MESH] Message received from previous node.");
  server.send(200, "application/json", "{\"status\":\"received\"}");

  // append ourselves to the path and roll the hash chain forward
  JsonArray path = doc["header"]["path"];
  path.add(NODE_ID);
  String prevHash = doc["header"]["message_id"].as<String>();
  doc["header"]["message_id"] = sha256Hex(prevHash + NODE_ID);

  forwardToNearestNode(doc);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting Non-Rescue Node...");
  Serial.print("Node ID: "); Serial.println(NODE_ID);
  Serial.print("Role: ");    Serial.println(IS_SENDER ? "SENDER" : "RELAY");

  startAccessPoint();

  server.on("/relay", HTTP_POST, handleIncomingMessage);
  server.begin();
  Serial.println("[HTTP] Web server started, listening on /relay");

  // trigger a send shortly after boot if this is the sender node
  lastSendTime = millis() - SEND_INTERVAL_MS + 10000; // first send ~10s after boot
}

void loop() {
  server.handleClient();

  if (IS_SENDER) {
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
      lastSendTime = millis();
      Serial.println("[SENDER] 10 minutes elapsed - sending new rescue message.");
      buildAndSendNewMessage();
    }
  }
}
