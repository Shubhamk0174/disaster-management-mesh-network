#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ============================================================
// RESCUE NODE
// Receives from NODE 2
// Sends to backend
// ============================================================

const char* NODE_ID =
  "RESCUE_NODE";

const char* PASSWORD =
  "mesh12345";


// ============================================================
// INTERNET WIFI
// ============================================================

const char* HOME_WIFI_SSID =
  "rijupc";

const char* HOME_WIFI_PASSWORD =
  "12345678";


// ============================================================
// BACKEND
// ============================================================

const char* BACKEND_URL =
  "https://ecs2-nu.vercel.app/api/rescue-alert";


// ============================================================
// SERVER
// ============================================================

WebServer server(80);


// ============================================================
// START RESCUE AP
// ============================================================

void startAP() {

  WiFi.mode(WIFI_AP_STA);


  IPAddress ip(
    192, 168, 6, 1
  );

  IPAddress gateway(
    192, 168, 6, 1
  );

  IPAddress subnet(
    255, 255, 255, 0
  );


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
  Serial.println(
    "========================================"
  );

  Serial.println(
    "RESCUE NODE READY"
  );

  Serial.println(
    "========================================"
  );


  Serial.print(
    "AP SSID: "
  );

  Serial.println(
    NODE_ID
  );


  Serial.print(
    "AP IP: "
  );

  Serial.println(
    WiFi.softAPIP()
  );
}


// ============================================================
// CONNECT INTERNET
// ============================================================

void connectInternet() {

  Serial.println();
  Serial.println(
    "[RESCUE] Connecting to internet..."
  );


  WiFi.begin(
    HOME_WIFI_SSID,
    HOME_WIFI_PASSWORD
  );


  unsigned long start =
    millis();


  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - start < 15000
  ) {

    delay(300);

    Serial.print(".");
  }


  Serial.println();


  if (
    WiFi.status() == WL_CONNECTED
  ) {

    Serial.println(
      "[RESCUE] INTERNET CONNECTED"
    );


    Serial.print(
      "[RESCUE] Internet IP: "
    );

    Serial.println(
      WiFi.localIP()
    );

  } else {

    Serial.println(
      "[RESCUE] INTERNET FAILED"
    );
  }
}


// ============================================================
// SEND TO BACKEND
// ============================================================

void sendToBackend(
  String payload
) {

  Serial.println();
  Serial.println(
    "========================================"
  );

  Serial.println(
    "[RESCUE] SENDING TO BACKEND"
  );

  Serial.println(
    "========================================"
  );


  if (
    WiFi.status() != WL_CONNECTED
  ) {

    Serial.println(
      "[RESCUE] Internet disconnected."
    );

    connectInternet();
  }


  if (
    WiFi.status() != WL_CONNECTED
  ) {

    Serial.println(
      "[RESCUE] Cannot send to backend."
    );

    return;
  }


  Serial.println(
    "[RESCUE] Backend URL:"
  );

  Serial.println(
    BACKEND_URL
  );


  Serial.println(
    "[RESCUE] Payload:"
  );

  Serial.println(
    payload
  );


  WiFiClientSecure client;

  // For testing HTTPS
  client.setInsecure();


  HTTPClient http;


  if (
    !http.begin(
      client,
      BACKEND_URL
    )
  ) {

    Serial.println(
      "[RESCUE] http.begin FAILED"
    );

    return;
  }


  http.addHeader(
    "Content-Type",
    "application/json"
  );


  Serial.println(
    "[RESCUE] POST..."
  );


  int code =
    http.POST(payload);


  Serial.print(
    "[RESCUE] Backend response: "
  );

  Serial.println(code);


  if (code > 0) {

    Serial.print(
      "[RESCUE] Backend body: "
    );

    Serial.println(
      http.getString()
    );

  } else {

    Serial.print(
      "[RESCUE] Backend ERROR: "
    );

    Serial.println(
      http.errorToString(code)
    );
  }


  http.end();
}


// ============================================================
// RECEIVE FROM NODE 2
// ============================================================

void handleRelay() {

  Serial.println();
  Serial.println(
    "========================================"
  );

  Serial.println(
    "[RESCUE] DATA RECEIVED FROM NODE_2"
  );

  Serial.println(
    "========================================"
  );


  if (
    !server.hasArg("plain")
  ) {

    Serial.println(
      "[RESCUE] No body!"
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
    "[RESCUE] RECEIVED JSON:"
  );

  Serial.println(
    payload
  );


  // ----------------------------------------------------------
  // ACK NODE 2
  // ----------------------------------------------------------

  server.send(
    200,
    "application/json",
    "{\"status\":\"received_by_rescue\"}"
  );


  // ----------------------------------------------------------
  // SEND TO BACKEND
  // ----------------------------------------------------------

  sendToBackend(
    payload
  );
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(
    115200
  );


  delay(2000);


  startAP();


  connectInternet();


  server.on(
    "/relay",
    HTTP_POST,
    handleRelay
  );


  server.begin();


  Serial.println(
    "[HTTP] Rescue server listening on /relay"
  );
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  server.handleClient();


  static unsigned long lastStatus = 0;


  if (
    millis() - lastStatus >= 5000
  ) {

    lastStatus = millis();


    Serial.print(
      "[STATUS] AP clients: "
    );

    Serial.println(
      WiFi.softAPgetStationNum()
    );


    Serial.print(
      "[STATUS] Internet: "
    );

    Serial.println(
      WiFi.status() ==
      WL_CONNECTED
        ? "CONNECTED"
        : "DISCONNECTED"
    );
  }
}