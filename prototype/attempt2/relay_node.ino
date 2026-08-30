/*
  ============================================================================
  RELAY-ONLY NODE FIRMWARE (ESP32) - PROTOTYPE
  ============================================================================
  Flash this on every non-rescue node EXCEPT NODE_1 (the sender).
  This node never originates a message - it only:
    1. Waits to receive a message via POST /relay
    2. Appends itself to the hash chain
    3. Scans for the nearest node (could be another relay, or directly the
       rescue node if that's the strongest signal) and forwards it there

  Change NODE_ID below to a unique value for each board: NODE_2, NODE_3, ...
  ============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

// ---------------------------------------------------------------------------
// THIS NODE'S IDENTITY - CHANGE PER DEVICE
// ---------------------------------------------------------------------------
const char* NODE_ID = "NODE_2";   // <-- unique per board: NODE_2, NODE_3, NODE_4...

// ---------------------------------------------------------------------------
// SHARED MESH CONFIG - must match the sender node + the rescue node
// ---------------------------------------------------------------------------
const char* MESH_PASSWORD    = "mesh12345";
const char* NODE_SSID_PREFIX = "NODE_";
const char* RESCUE_SSID      = "RESCUE_NODE";

const int WIFI_CONNECT_TIMEOUT_MS = 8000;

WebServer server(80);

// ---------------------------------------------------------------------------
// SHA256 helper
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
// Scan for nearby nodes (any relay OR the rescue node), pick strongest
// signal, forward the message there. If the rescue node itself has the
// strongest signal, it gets picked just like any other candidate.
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
    Serial.println("[MESH] No reachable node found. Message dropped this attempt.");
    return;
  }

  String targetSSID = WiFi.SSID(bestIndex);
  bool targetIsRescue = (targetSSID == RESCUE_SSID);

  Serial.print("[MESH] Nearest node found: ");
  Serial.print(targetSSID);
  Serial.print(targetIsRescue ? "  (this IS the rescue node)" : "  (relay node)");
  Serial.print("   RSSI: ");
  Serial.println(bestRSSI);

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
    Serial.println("[WIFI] Connection to next node FAILED. Message dropped this attempt.");
    return;
  }

  Serial.print("[WIFI] Connected! Local IP: ");
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
  Serial.println("[WIFI] Disconnected from next node. Back to hosting our own AP.");
}

// ---------------------------------------------------------------------------
// Handle a message that another node sent to us
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

  JsonArray path = doc["header"]["path"];
  path.add(NODE_ID);
  String prevHash = doc["header"]["message_id"].as<String>();
  doc["header"]["message_id"] = sha256Hex(prevHash + NODE_ID);

  forwardToNearestNode(doc);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting RELAY Node...");
  Serial.print("Node ID: "); Serial.println(NODE_ID);

  startAccessPoint();

  server.on("/relay", HTTP_POST, handleIncomingMessage);
  server.begin();
  Serial.println("[HTTP] Web server started, listening for messages on /relay");
}

void loop() {
  server.handleClient();
}
