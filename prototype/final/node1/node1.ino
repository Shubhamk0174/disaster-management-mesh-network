#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <ArduinoJson.h>

// ============================================================
// NODE 1
// Sends data to NODE 2
// ============================================================

const char* NODE_ID = "NODE_1";
const char* PASSWORD = "mesh12345";

const char* NODE2_SSID = "NODE_2";
const char* NODE2_IP = "192.168.5.1";

const unsigned long SEND_INTERVAL = 5000; // 5 seconds

WebServer server(80);

unsigned long lastSend = 0;


// ============================================================
// START NODE 1 AP
// ============================================================

void startAP() {

  WiFi.mode(WIFI_AP);

  IPAddress ip(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.softAPConfig(ip, gateway, subnet);

  WiFi.softAP(
    NODE_ID,
    PASSWORD,
    1,
    false,
    4
  );

  Serial.println();
  Serial.println("================================");
  Serial.println("NODE 1 READY");
  Serial.println("================================");

  Serial.print("SSID: ");
  Serial.println(NODE_ID);

  Serial.print("IP: ");
  Serial.println(WiFi.softAPIP());
}


// ============================================================
// SEND MESSAGE TO NODE 2
// ============================================================

void sendToNode2() {

  Serial.println();
  Serial.println("[NODE_1] Creating rescue message...");


  DynamicJsonDocument doc(2048);

  doc["node"] = "NODE_1";
  doc["message"] = "Person trapped, needs rescue";

  JsonObject location =
    doc.createNestedObject("location");

  location["lat"] = 16.5062;
  location["lng"] = 80.6480;

  doc["address"] =
    "Near RTC Bus Stand, Vijayawada";


  String payload;

  serializeJson(doc, payload);


  // ----------------------------------------------------------
  // Connect to NODE 2
  // ----------------------------------------------------------

  Serial.println("[NODE_1] Connecting to NODE_2...");

  WiFi.mode(WIFI_AP_STA);

  WiFi.begin(
    NODE2_SSID,
    PASSWORD
  );


  unsigned long start = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 10000
  ) {

    delay(300);
    Serial.print(".");
  }

  Serial.println();


  if (WiFi.status() != WL_CONNECTED) {

    Serial.println(
      "[NODE_1] FAILED to connect to NODE_2"
    );

    WiFi.disconnect();

    return;
  }


  Serial.println(
    "[NODE_1] Connected to NODE_2"
  );


  Serial.print(
    "[NODE_1] Client IP: "
  );

  Serial.println(
    WiFi.localIP()
  );


  // ----------------------------------------------------------
  // POST
  // ----------------------------------------------------------

  WiFiClient client;

  HTTPClient http;


  String url =
    "http://" +
    String(NODE2_IP) +
    "/relay";


  Serial.print(
    "[NODE_1] POST -> "
  );

  Serial.println(url);


  if (!http.begin(client, url)) {

    Serial.println(
      "[NODE_1] http.begin FAILED"
    );

    WiFi.disconnect();

    return;
  }


  http.addHeader(
    "Content-Type",
    "application/json"
  );


  Serial.println(
    "[NODE_1] Payload:"
  );

  Serial.println(payload);


  int code =
    http.POST(payload);


  Serial.print(
    "[NODE_1] Response: "
  );

  Serial.println(code);


  if (code > 0) {

    Serial.print(
      "[NODE_1] Body: "
    );

    Serial.println(
      http.getString()
    );

  } else {

    Serial.print(
      "[NODE_1] ERROR: "
    );

    Serial.println(
      http.errorToString(code)
    );
  }


  http.end();

  WiFi.disconnect();


  Serial.println(
    "[NODE_1] Done."
  );
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(2000);

  startAP();

  lastSend =
    millis() - SEND_INTERVAL;
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  server.handleClient();


  if (
    millis() - lastSend >=
    SEND_INTERVAL
  ) {

    lastSend = millis();

    sendToNode2();
  }
}