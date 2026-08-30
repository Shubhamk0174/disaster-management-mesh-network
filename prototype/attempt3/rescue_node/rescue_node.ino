/*
  ============================================================================
  RESCUE NODE FIRMWARE (ESP32)
  ============================================================================
  Flash this on the ONE rescue ESP32.

  This node:
   1. Hosts its own WiFi Access Point (SSID = "RESCUE_NODE") so nearby mesh
      nodes can discover it and deliver the rescue message - exactly like a
      non-rescue node's AP, but it never forwards further.
   2. ALSO connects, as a WiFi station, to your real INTERNET-connected WiFi
      (home/office router / hotspot) at the same time (AP+STA mode), so it
      can call your backend REST API.

  FILL IN BEFORE FLASHING:
   - HOME_WIFI_SSID / HOME_WIFI_PASSWORD  (your internet WiFi)
   - BACKEND_URL                          (your REST API endpoint)
   - BACKEND_API_KEY                      (optional, leave "" if not needed)
  ============================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"
#include <time.h>

// ---------------------------------------------------------------------------
// MESH CONFIG - must match the non-rescue nodes
// ---------------------------------------------------------------------------
const char* NODE_ID       = "RESCUE_NODE";  // this exact SSID is what non-rescue nodes look for
const char* MESH_PASSWORD = "mesh12345";    // must match MESH_PASSWORD on all other nodes

// ---------------------------------------------------------------------------
// >>> FILL THESE IN <<<
// ---------------------------------------------------------------------------
const char* HOME_WIFI_SSID     = "rijupc";
const char* HOME_WIFI_PASSWORD = "12345678";

const char* BACKEND_URL     = "https://vineyard-overlying-concrete.ngrok-free.dev/api/rescue-alert"; // <-- your endpoint
const char* BACKEND_API_KEY = "";   // e.g. "Bearer xxxxxxxx"  - leave "" if none

const int WIFI_CONNECT_TIMEOUT_MS = 15000;

WebServer server(80);



// ---------------------------------------------------------------------------
// SHA256 helper (same as non-rescue node, needed to close out the hash chain)
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

void startMeshAP() {
  WiFi.mode(WIFI_AP_STA); // AP for the mesh + STA for the internet, at the same time
  bool ok = WiFi.softAP(NODE_ID, MESH_PASSWORD);

  Serial.println("--------------------------------------------------");
  Serial.print("[WIFI] Rescue mesh AP: ");
  Serial.println(ok ? "STARTED" : "FAILED TO START");
  Serial.print("[WIFI] AP SSID: "); Serial.println(NODE_ID);
  Serial.print("[WIFI] AP IP address: "); Serial.println(WiFi.softAPIP());
  Serial.println("--------------------------------------------------");
}

void connectHomeWifi() {
  Serial.print("[WIFI] Connecting to internet WiFi: ");
  Serial.println(HOME_WIFI_SSID);
  WiFi.begin(HOME_WIFI_SSID, HOME_WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WIFI] Connected to internet! IP: ");
    Serial.println(WiFi.localIP());
    // Adjust the 19800 offset (seconds) to your timezone. 19800 = IST (UTC+5:30)
    configTime(19800, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("[TIME] Syncing real time via NTP...");
  } else {
    Serial.println("[WIFI] WARNING: Could not connect to internet WiFi. Will keep retrying in background.");
  }
}

String getTimestamp() {
  time_t now;
  time(&now);
  if (now < 100000) {
    // NTP not synced yet - fall back to uptime so we still record *something*
    return String("uptime_ms:") + String(millis());
  }
  struct tm timeinfo;
  localtime_r(&now, &timeinfo);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &timeinfo);
  return String(buf);
}

void forwardToBackend(JsonDocument &doc) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Not connected to internet - retrying before giving up...");
    connectHomeWifi();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[HTTP] Backend forward SKIPPED - no internet connection.");
      return;
    }
  }

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");
  if (strlen(BACKEND_API_KEY) > 0) {
    http.addHeader("Authorization", BACKEND_API_KEY);
  }

  String payload;
  serializeJson(doc, payload);
  Serial.println("[HTTP] Sending final message to backend:");
  Serial.println(payload);

  int code = http.POST(payload);
  Serial.print("[HTTP] Backend response code: ");
  Serial.println(code);
  if (code > 0) {
    Serial.print("[HTTP] Backend response body: ");
    Serial.println(http.getString());
  }
  http.end();
}

void handleIncomingMessage() {
  if (!server.hasArg("plain")) {
    server.send(400, "text/plain", "No body");
    return;
  }
  String body = server.arg("plain");

  DynamicJsonDocument doc(4096);
  if (deserializeJson(doc, body)) {
    server.send(400, "text/plain", "Bad JSON");
    return;
  }

  Serial.println("[MESH] Rescue message received - this is the final hop!");

  JsonArray path = doc["header"]["path"];
  path.add(NODE_ID);
  String prevHash = doc["header"]["message_id"].as<String>();
  doc["header"]["message_id"] = sha256Hex(prevHash + NODE_ID);
  doc["header"]["received_at_rescue_node"] = getTimestamp();

  server.send(200, "application/json", "{\"status\":\"received_by_rescue_node\"}");

  forwardToBackend(doc);
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("========================================");
  Serial.println("Booting RESCUE Node...");
  Serial.println("========================================");

  // Start rescue mesh AP
  Serial.println("[1] Starting mesh AP...");
  startMeshAP();

  // Connect to internet WiFi
  Serial.println("[2] Connecting to home WiFi...");
  connectHomeWifi();

  // Check WiFi
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[CHECK] WiFi: CONNECTED");
    Serial.print("[CHECK] IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[CHECK] WiFi: NOT CONNECTED");
  }

  // Start mesh HTTP server
  Serial.println("[3] Starting /relay server...");

  server.on("/relay", HTTP_POST, handleIncomingMessage);
  server.begin();

  Serial.println("[HTTP] Web server started");
  Serial.println("[HTTP] Listening on /relay");
}

void loop() {
  server.handleClient();

  // periodically make sure we still have internet, reconnect if it dropped
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > 30000) {
    lastCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WIFI] Internet connection lost. Reconnecting...");
      connectHomeWifi();
    }
  }
}
