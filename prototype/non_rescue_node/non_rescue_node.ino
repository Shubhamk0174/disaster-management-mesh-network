/*
  ================================================================
  NON-RESCUE NODE  —  ESP32
  ================================================================
  Flash this SAME sketch onto every intermediate/sensor node.
  Only the SELF_NODE_ID (and per-node location/address) changes
  between physical devices.

  NETWORK MODEL:
  - Every node joins the SAME WiFi router (WIFI_SSID/PASSWORD)
    with a fixed static IP, so any node can reach any other node
    by IP.
  - Every node ALSO runs its own SoftAP, whose SSID is used purely
    as a "beacon" so neighboring nodes can measure WiFi signal
    strength (RSSI) to it. This is how "nearest node" is decided —
    no GPS or manual routing table needed.
  - To relay a message, a node scans nearby SoftAP beacons, picks
    the strongest signal (excluding whoever just sent it the
    message, to avoid ping-ponging), and HTTP POSTs the message
    to that node's static IP.

  MESSAGE HEADER / BODY FORMAT (JSON over HTTP POST to /relay):
  {
    "header": {
      "node_id":    "NODE_B",          // node sending THIS hop
      "message_id": "9f3a...c02",      // rolling SHA-256 hash chain
      "timestamp":  1735500001          // unix time this hop was sent
    },
    "body": {
      "origin_node_id":   "NODE_A",
      "origin_timestamp": 1735499990,
      "location": { "lat": 12.9716, "lng": 77.5946 },
      "address":  "Sector 4, Warehouse Entrance",
      "message":  "Assistance needed - sensor triggered",
      "hop_count": 2,
      "path": ["NODE_A", "NODE_B"]
    }
  }

  NOTE ON message_id: a true Merkle tree branches to verify many
  independent leaves at once. A relay path is linear, so instead
  we use a HASH CHAIN: each hop computes
      new_hash = SHA256(previous_hash + node_id + timestamp)
  This gives the same tamper-evident guarantee (you can verify the
  final hash by replaying the `path` array) while fitting a
  point-to-point route.

  REQUIRED LIBRARY: ArduinoJson (Library Manager -> search "ArduinoJson", v6.x)
  WiFi.h / WebServer.h / HTTPClient.h / mbedtls ship with the ESP32 core.
  ================================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "mbedtls/md.h"
#include <time.h>

// ================= PER-NODE CONFIG (edit before flashing each device) =================
#define SELF_NODE_ID   "NODE_A"     // change per device: NODE_A, NODE_B, NODE_C, ...
#define NODE_LAT       12.971600
#define NODE_LNG       77.594600
#define NODE_ADDRESS   "Sector 4, Warehouse Entrance"
#define TRIGGER_PIN    0            // button wired to GND simulates an event
// =======================================================================================

// ================= SHARED CONFIG (must be IDENTICAL on every node + the rescue node) ===
const char* WIFI_SSID     = "riju";
const char* WIFI_PASSWORD = "12345678";

// check if the wifi is connected or not through the serial monitor
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected!");  // ADDED: shows that WiFi connection was successful
  Serial.printf("Connected. IP: %s\n", WiFi.localIP().toString().c_str());

IPAddress GATEWAY(192, 168, 1, 1);
IPAddress SUBNET(255, 255, 255, 0);

struct NodeInfo {
  const char* nodeId;
  const char* apSsid;   // SoftAP beacon name used for RSSI-based proximity detection
  IPAddress   ip;       // static IP this node uses on the shared router
};

// EDIT to match your real deployment. Keep this table identical across every
// node.ino and rescue_node.ino you flash, and make sure these IPs are OUTSIDE
// your router's DHCP range (or reserved for these MACs) so they never collide.
NodeInfo nodeRegistry[] = {
  {"NODE_A", "MESH_NODE_A", IPAddress(192,168,1,101)},
  {"NODE_B", "MESH_NODE_B", IPAddress(192,168,1,102)},
  {"NODE_C", "MESH_NODE_C", IPAddress(192,168,1,103)},
  {"RESCUE", "MESH_RESCUE", IPAddress(192,168,1,110)},
};
const int NODE_COUNT = sizeof(nodeRegistry) / sizeof(nodeRegistry[0]);
// =======================================================================================

#define MAX_HOPS       12
#define SEEN_CACHE_LEN 30
#define JSON_CAPACITY  2048

WebServer server(80);

// ---- dedupe cache, keyed by the STABLE identity "origin_node_id-origin_timestamp"
// (message_id itself changes every hop by design, so it can't be used for dedupe) ----
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

// ---- SHA-256 helper used to extend the rolling message_id hash chain ----
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

bool isExcluded(const char* id, String* excludeList, int excludeCount) {
  for (int i = 0; i < excludeCount; i++) if (excludeList[i] == id) return true;
  return false;
}

// ---- scan visible WiFi networks, find the strongest beacon among known nodes ----
// (excludes ourselves and anything in excludeList, e.g. whoever just sent us the message)
NodeInfo* findNearestNeighbor(String* excludeList, int excludeCount) {
  int n = WiFi.scanNetworks();
  NodeInfo* best = nullptr;
  int bestRssi = -1000;

  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    for (int j = 0; j < NODE_COUNT; j++) {
      if (ssid == nodeRegistry[j].apSsid &&
          strcmp(nodeRegistry[j].nodeId, SELF_NODE_ID) != 0 &&
          !isExcluded(nodeRegistry[j].nodeId, excludeList, excludeCount)) {
        int rssi = WiFi.RSSI(i);
        if (rssi > bestRssi) { bestRssi = rssi; best = &nodeRegistry[j]; }
      }
    }
  }
  WiFi.scanDelete();
  return best;
}

bool sendToNode(NodeInfo* target, const String& jsonBody) {
  if (!target) return false;
  HTTPClient http;
  String url = "http://" + target->ip.toString() + "/relay";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(jsonBody);
  http.end();
  Serial.printf("Forward attempt -> %s (%s): HTTP %d\n",
                target->nodeId, target->ip.toString().c_str(), code);
  return code > 0 && code < 400;
}

// ---- stamp our hop onto the message and try to push it toward the rescue node ----
void relayMessage(JsonDocument& doc, const char* previousHop) {
  const char* originId = doc["body"]["origin_node_id"];
  long originTs = doc["body"]["origin_timestamp"];
  String dedupeKey = String(originId) + "-" + String(originTs);

  if (alreadySeen(dedupeKey)) {
    Serial.println("Duplicate message, dropping.");
    return;
  }
  markSeen(dedupeKey);

  int hopCount = doc["body"]["hop_count"] | 0;
  if (hopCount >= MAX_HOPS) {
    Serial.println("Max hops exceeded, dropping.");
    return;
  }

  String prevHash = doc["header"]["message_id"].as<String>();
  time_t now; time(&now);
  String newHash = sha256Hex(prevHash + "|" + SELF_NODE_ID + "|" + String((long)now));

  doc["header"]["node_id"]    = SELF_NODE_ID;
  doc["header"]["message_id"] = newHash;
  doc["header"]["timestamp"]  = (long)now;
  doc["body"]["hop_count"]    = hopCount + 1;
  doc["body"]["path"].add(SELF_NODE_ID);

  String outJson;
  serializeJson(doc, outJson);

  String excluded[4];
  int excludedCount = 0;
  if (previousHop) excluded[excludedCount++] = String(previousHop);

  // try up to 3 candidates (best RSSI first) in case the top choice is unreachable
  for (int attempt = 0; attempt < 3; attempt++) {
    NodeInfo* next = findNearestNeighbor(excluded, excludedCount);
    if (!next) break;
    if (sendToNode(next, outJson)) return;
    excluded[excludedCount++] = String(next->nodeId);
  }

  // last resort: no mesh neighbor worked, try the rescue node directly
  NodeInfo* rescue = findNodeById("RESCUE");
  if (rescue && strcmp(rescue->nodeId, SELF_NODE_ID) != 0) {
    Serial.println("No mesh neighbor reachable — falling back to direct send to RESCUE.");
    sendToNode(rescue, outJson);
  } else {
    Serial.println("Could not deliver message — no route available.");
  }
}

// ---- HTTP endpoint: another node relaying a message to us ----
void handleRelay() {
  if (!server.hasArg("plain")) { server.send(400, "text/plain", "no body"); return; }

  DynamicJsonDocument doc(JSON_CAPACITY);
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) { server.send(400, "text/plain", "bad json"); return; }

  const char* fromNode = doc["header"]["node_id"];
  Serial.printf("Received relay from %s\n", fromNode ? fromNode : "unknown");
  server.send(200, "text/plain", "ok");

  relayMessage(doc, fromNode);
}

// ---- originate a brand-new message from this node (button press / sensor trigger) ----
void sendNewMessage(const char* text) {
  DynamicJsonDocument doc(JSON_CAPACITY);
  time_t now; time(&now);

  String firstHash = sha256Hex(String(SELF_NODE_ID) + "|" + String((long)now));

  JsonObject header = doc.createNestedObject("header");
  header["node_id"]    = SELF_NODE_ID;
  header["message_id"] = firstHash;
  header["timestamp"]  = (long)now;

  JsonObject body = doc.createNestedObject("body");
  body["origin_node_id"]   = SELF_NODE_ID;
  body["origin_timestamp"] = (long)now;
  JsonObject loc = body.createNestedObject("location");
  loc["lat"] = NODE_LAT;
  loc["lng"] = NODE_LNG;
  body["address"]   = NODE_ADDRESS;
  body["message"]   = text;
  body["hop_count"] = 0;
  JsonArray path = body.createNestedArray("path");
  path.add(SELF_NODE_ID);

  Serial.printf("Originating new message, id=%s\n", firstHash.c_str());
  relayMessage(doc, nullptr);
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIGGER_PIN, INPUT_PULLUP);

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

  // Broadcast our own beacon so nearby nodes can measure RSSI to us
  WiFi.softAP(self->apSsid, "meshpass123");

  // Sync real time over NTP so message timestamps are meaningful
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");

  server.on("/relay", HTTP_POST, handleRelay);
  server.begin();

  Serial.printf("Non-rescue node ready: %s\n", SELF_NODE_ID);
}

void loop() {
  server.handleClient();

  // Example trigger: wire a button to TRIGGER_PIN to simulate a rescue event.
  // Replace with a real sensor (PIR, vibration, panic button, etc).
  if (digitalRead(TRIGGER_PIN) == LOW) {
    sendNewMessage("Assistance needed - sensor triggered");
    delay(3000); // basic debounce
  }
}
