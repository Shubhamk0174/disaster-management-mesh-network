/*
  ============================================================================
  SENDER NODE FIRMWARE (ESP32) - PROTOTYPE
  ============================================================================
  This is NODE_1 - the ONLY node that originates messages.
  It builds a new rescue message every 7 SECONDS (prototype speed - change
  SEND_INTERVAL_MS below once you move past testing) and sends it to
  whichever nearby node has the strongest WiFi signal.

  If the strongest signal happens to belong to the rescue node itself,
  the message goes straight there - no special-casing needed, the rescue
  node's SSID is just another candidate in the same scan.
  ============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"

// ---------------------------------------------------------------------------
// THIS NODE'S IDENTITY
// ---------------------------------------------------------------------------
const char* NODE_ID = "NODE_1";   // must be unique in the mesh

// Message content this sender reports
const double NODE_LAT     = 16.5062;
const double NODE_LNG     = 80.6480;
const char*  NODE_ADDRESS = "Near RTC Bus Stand, Vijayawada";
const char*  ALERT_TEXT   = "Person trapped, needs rescue";

// ---------------------------------------------------------------------------
// SHARED MESH CONFIG - must match every relay node + the rescue node
// ---------------------------------------------------------------------------
const char* MESH_PASSWORD    = "mesh12345";
const char* NODE_SSID_PREFIX = "NODE_";
const char* RESCUE_SSID      = "RESCUE_NODE";

const unsigned long SEND_INTERVAL_MS         = 7000; // 7 seconds - PROTOTYPE ONLY
const int            WIFI_CONNECT_TIMEOUT_MS = 8000;

WebServer server(80);
unsigned long lastSendTime = 0;

// ---------------------------------------------------------------------------
// SHA256 helper - used to build the hash chain (message_id)
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
// Scan for nearby nodes (relay nodes AND the rescue node are both candidates),
// pick strongest signal, forward the message there.
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
    Serial.println("[MESH] No reachable node found right now. Will try again next cycle.");
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
    Serial.println("[WIFI] Connection to next node FAILED. Will retry next cycle.");
    return;
  }

  Serial.print("[WIFI] Connected! Local IP: ");
  Serial.println(WiFi.localIP());

  HTTPClient http;
  http.begin("http://192.168.4.1/relay");
  http.addHeader("Content-Type", "application/json");
  String payload;
  serializeJson(doc, payload);

  Serial.println("[HTTP] Sending message:");
  Serial.println(payload);

  int code = http.POST(payload);
  Serial.print("[HTTP] Response code: ");
  Serial.println(code);
  http.end();

  WiFi.disconnect();
  Serial.println("[WIFI] Disconnected from next node. Back to hosting our own AP.");
}

// ---------------------------------------------------------------------------
// Build and send a brand-new message
// ---------------------------------------------------------------------------
void buildAndSendNewMessage() {
  DynamicJsonDocument doc(2048);

  JsonObject header = doc.createNestedObject("header");
  header["origin_node_id"] = NODE_ID;
  header["message_id"]     = sha256Hex(String(NODE_ID) + String(millis()));
  header["timestamp_ms"]   = millis();
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

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("Booting SENDER Node (NODE_1)...");

  startAccessPoint();

  server.begin(); // kept running in case another node ever reaches out to us
  Serial.println("[HTTP] Web server started (idle - this node only sends).");

  lastSendTime = millis() - SEND_INTERVAL_MS; // send almost immediately at boot
}

void loop() {
  server.handleClient();

  if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = millis();
    Serial.println("[SENDER] 7 seconds elapsed - sending new rescue message.");
    buildAndSendNewMessage();
  }
}
