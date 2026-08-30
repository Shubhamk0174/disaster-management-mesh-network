/*
  ================================================================
  RESCUE NODE  —  ESP32
  ================================================================
  There is only ONE of these on the network. It:
   1. Joins the shared WiFi router (same network as every other node)
   2. Broadcasts its own SoftAP beacon (so it can be discovered by
      RSSI just like any other node, and used as the fallback target)
   3. Receives relayed messages on /relay from non-rescue nodes
   4. Stamps its own hop onto the header, then forwards the full
      message (header + body + path) to your BACKEND_API_ENDPOINT
      as a JSON HTTP POST.

  Uses the exact same header/body JSON shape as the non-rescue
  nodes — see the top of non_rescue_node.ino for the full format
  and an explanation of the message_id hash chain.

  REQUIRED LIBRARY: ArduinoJson (Library Manager -> "ArduinoJson", v6.x)
  ================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"
#include <time.h>

// ================= RESCUE-SPECIFIC CONFIG =================
#define SELF_NODE_ID  "RESCUE"
const char* BACKEND_API_ENDPOINT = "https://your-backend.example.com/api/rescue-events";
const char* API_KEY = "YOUR_API_KEY_IF_NEEDED"; // leave "" if no auth needed
// ============================================================

// ================= SHARED CONFIG (must be IDENTICAL to every non_rescue_node.ino) =====
const char* WIFI_SSID     = "YOUR_ROUTER_SSID";
const char* WIFI_PASSWORD = "YOUR_ROUTER_PASSWORD";

IPAddress GATEWAY(192, 168, 1, 1);
IPAddress SUBNET(255, 255, 255, 0);

struct NodeInfo {
  const char* nodeId;
  const char* apSsid;
  IPAddress   ip;
};

// Keep this identical to the table in non_rescue_node.ino
NodeInfo nodeRegistry[] = {
  {"NODE_A", "MESH_NODE_A", IPAddress(192,168,1,101)},
  {"NODE_B", "MESH_NODE_B", IPAddress(192,168,1,102)},
  {"NODE_C", "MESH_NODE_C", IPAddress(192,168,1,103)},
  {"RESCUE", "MESH_RESCUE", IPAddress(192,168,1,110)},
};
const int NODE_COUNT = sizeof(nodeRegistry) / sizeof(nodeRegistry[0]);
// =======================================================================================

#define SEEN_CACHE_LEN 30
#define JSON_CAPACITY  2048

WebServer server(80);

// dedupe cache keyed by "origin_node_id-origin_timestamp" (stable regardless of hash chain)
String seenKeys[SEEN_CACHE_LEN];
int seenIndex = 0;
bool alreadySeen(const String& key) {
  for (int i = 0; i < SEEN_CACHE_LEN; i++) if (seenKeys[i] == key) return true;
  return false;
}
void markSeen(const String& key) {
  seenKeys[seenIndex] = key;
  seenIndex = (seenIndex + 1) % SEEN_CACHE_LEN;
}

String sha256Hex(const String &input) {
  byte hash[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_md_finish(&ctx, hash);
  mbedtls_md_free(&ctx);
  String out;
  char buf[3];
  for (int i = 0; i < 32; i++) { sprintf(buf, "%02x", hash[i]); out += buf; }
  return out;
}

NodeInfo* findNodeById(const char* id) {
  for (int i = 0; i < NODE_COUNT; i++)
    if (strcmp(nodeRegistry[i].nodeId, id) == 0) return &nodeRegistry[i];
  return nullptr;
}

// ---- forward the finished message (with full path + hash chain) to the backend ----
void sendToBackend(JsonDocument& doc) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("No WiFi, cannot reach backend.");
    return;
  }

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  http.begin(BACKEND_API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) {
    http.addHeader("Authorization", String("Bearer ") + API_KEY);
  }
  int code = http.POST(payload);
  Serial.printf("POST to backend -> HTTP %d\n", code);
  if (code > 0) Serial.println(http.getString());
  http.end();
}

// ---- HTTP endpoint: a mesh node delivering a message to the rescue node ----
void handleRelay() {
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "no body"); return; }

  DynamicJsonDocument doc(JSON_CAPACITY);
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) { server.send(400, "text/plain", "bad json"); return; }

  server.send(200, "text/plain", "ok"); // ack immediately, then process

  const char* originId = doc["body"]["origin_node_id"];
  long originTs = doc["body"]["origin_timestamp"];
  String dedupeKey = String(originId) + "-" + String(originTs);

  if (alreadySeen(dedupeKey)) {
    Serial.println("Duplicate final message, ignoring.");
    return;
  }
  markSeen(dedupeKey);

  // stamp our own arrival hop before handing off to the backend
  time_t now; time(&now);
  String prevHash = doc["header"]["message_id"].as<String>();
  String finalHash = sha256Hex(prevHash + "|" + SELF_NODE_ID + "|" + String((long)now));

  doc["header"]["node_id"]    = SELF_NODE_ID;
  doc["header"]["message_id"] = finalHash;
  doc["header"]["timestamp"]  = (long)now;
  doc["body"]["path"].add(SELF_NODE_ID);

  Serial.printf("Final message received, full path length=%d, forwarding to backend.\n",
                doc["body"]["path"].size());

  sendToBackend(doc);
}

void setup() {
  Serial.begin(115200);

  NodeInfo* self = findNodeById(SELF_NODE_ID);
  if (!self) {
    Serial.println("SELF_NODE_ID not found in nodeRegistry! Fix the config and reflash.");
    while (true) delay(1000);
  }

  WiFi.mode(WIFI_AP_STA);
  WiFi.config(self->ip, GATEWAY, SUBNET);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.printf("\nConnected. IP: %s\n", WiFi.localIP().toString().c_str());

  // Broadcast our beacon too, so nearby nodes can discover us via RSSI like any other node
  WiFi.softAP(self->apSsid, "meshpass123");

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  server.on("/relay", HTTP_POST, handleRelay);
  server.begin();

  Serial.println("Rescue node ready — listening for mesh relays, forwarding to backend.");
}

void loop() {
  server.handleClient();
}
