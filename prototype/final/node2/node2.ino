#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>

// ============================================================
// NODE 2
// Receives from NODE 1
// Sends to RESCUE NODE
// ============================================================

const char* NODE_ID = "NODE_2";
const char* PASSWORD = "mesh12345";

const char* RESCUE_SSID = "RESCUE_NODE";
const char* RESCUE_IP = "192.168.6.1";

WebServer server(80);


// ============================================================
// START NODE 2 AP
// ============================================================

void startAP() {

  WiFi.mode(WIFI_AP);

  IPAddress ip(192, 168, 5, 1);
  IPAddress gateway(192, 168, 5, 1);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.softAPConfig(
    ip,
    gateway,
    subnet
  );

  WiFi.softAP(
    NODE_ID,
    PASSWORD,
    1,
    false,
    4
  );


  Serial.println();
  Serial.println("================================");
  Serial.println("NODE 2 READY");
  Serial.println("================================");

  Serial.print("SSID: ");
  Serial.println(NODE_ID);

  Serial.print("IP: ");
  Serial.println(WiFi.softAPIP());
}


// ============================================================
// SEND TO RESCUE NODE
// ============================================================

void sendToRescue(
  String payload
) {

  Serial.println();
  Serial.println(
    "[NODE_2] Connecting to RESCUE_NODE..."
  );


  WiFi.mode(WIFI_AP_STA);

  WiFi.begin(
    RESCUE_SSID,
    PASSWORD
  );


  unsigned long start =
    millis();


  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 10000
  ) {

    delay(300);

    Serial.print(".");
  }


  Serial.println();


  if (
    WiFi.status() != WL_CONNECTED
  ) {

    Serial.println(
      "[NODE_2] FAILED to connect to RESCUE_NODE"
    );

    WiFi.disconnect();

    return;
  }


  Serial.println(
    "[NODE_2] Connected to RESCUE_NODE"
  );


  Serial.print(
    "[NODE_2] Client IP: "
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
    String(RESCUE_IP) +
    "/relay";


  Serial.print(
    "[NODE_2] POST -> "
  );

  Serial.println(url);


  if (!http.begin(client, url)) {

    Serial.println(
      "[NODE_2] http.begin FAILED"
    );

    WiFi.disconnect();

    return;
  }


  http.addHeader(
    "Content-Type",
    "application/json"
  );


  Serial.println(
    "[NODE_2] Forwarding payload:"
  );

  Serial.println(payload);


  int code =
    http.POST(payload);


  Serial.print(
    "[NODE_2] Response: "
  );

  Serial.println(code);


  if (code > 0) {

    Serial.print(
      "[NODE_2] Body: "
    );

    Serial.println(
      http.getString()
    );

  } else {

    Serial.print(
      "[NODE_2] ERROR: "
    );

    Serial.println(
      http.errorToString(code)
    );
  }


  http.end();

  WiFi.disconnect();


  Serial.println(
    "[NODE_2] Done."
  );
}


// ============================================================
// RECEIVE FROM NODE 1
// ============================================================

void handleRelay() {

  Serial.println();
  Serial.println(
    "================================"
  );

  Serial.println(
    "[NODE_2] DATA RECEIVED FROM NODE_1"
  );

  Serial.println(
    "================================"
  );


  if (!server.hasArg("plain")) {

    Serial.println(
      "[NODE_2] No body!"
    );

    server.send(
      400,
      "text/plain",
      "No body"
    );

    return;
  }


  String payload =
    server.arg("plain");


  Serial.println(
    "[NODE_2] Received JSON:"
  );

  Serial.println(payload);


  // ----------------------------------------------------------
  // ACK NODE 1
  // ----------------------------------------------------------

  server.send(
    200,
    "application/json",
    "{\"status\":\"received_by_node_2\"}"
  );


  // ----------------------------------------------------------
  // Forward to rescue
  // ----------------------------------------------------------

  sendToRescue(payload);
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(2000);


  startAP();


  server.on(
    "/relay",
    HTTP_POST,
    handleRelay
  );


  server.begin();


  Serial.println(
    "[HTTP] NODE_2 listening on /relay"
  );
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  server.handleClient();
}