#include <Arduino.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

#include "node_a_config.h"
#include "mesh_common.h"

#define MY_NODE_ID NODE_A_ID

const char NODE_LOCATION[] = "16.494485,80.499179";

#define ACK_TIMEOUT_MS       1200
#define ORIGIN_RETRIES       3
#define BUTTON_DEBOUNCE_MS   250

#define WIFI_AP_SSID         "RESCUE-MESH"

#define DNS_PORT             53

#define SOS_COOLDOWN_MS      10000

WebServer server(80);
DNSServer dnsServer;

bool waitingForAck = false;
uint32_t lastButtonPress = 0;
uint32_t lastSOSRequest = 0;

bool getTrustedEd25519PublicKey(
    uint8_t nodeId,
    uint8_t out[32]
) {
    switch (nodeId) {

        case NODE_A_ID:
            return hexToBytes(
                TRUSTED_NODE_A_ED25519,
                out,
                32
            );

        case NODE_B_ID:
            return hexToBytes(
                TRUSTED_NODE_B_ED25519,
                out,
                32
            );

        case RESCUE_ID:
            return hexToBytes(
                TRUSTED_RESCUE_ED25519,
                out,
                32
            );

        default:
            return false;
    }
}

static void sendAck(
    uint8_t originId,
    uint32_t originRoot,
    uint32_t currentRoot
) {
    AckPacket ack;

    uint8_t privateKey[32];
    uint8_t publicKey[32];

    if (!hexToBytes(
        OWN_ED25519_PRIVATE,
        privateKey,
        32
    )) {
        Serial.println("ERROR: invalid Ed25519 private key");
        return;
    }

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        publicKey,
        32
    )) {
        Serial.println("ERROR: invalid Ed25519 public key");
        memset(privateKey, 0, sizeof(privateKey));
        return;
    }

    createAck(
        ack,
        MY_NODE_ID,
        originId,
        originRoot,
        currentRoot,
        privateKey,
        publicKey
    );

    memset(privateKey, 0, sizeof(privateKey));
    memset(publicKey, 0, sizeof(publicKey));

    Serial.print("Sending ACK from NODE_A to origin NODE_");
    Serial.println(originId);

    transmitAck(ack);
}

static bool waitForAck(
    uint32_t originRoot
) {
    uint32_t start = millis();

    LoRa.receive();

    while (millis() - start < ACK_TIMEOUT_MS) {

        int packetSize = LoRa.parsePacket();

        if (packetSize <= 0) {
            delay(2);
            continue;
        }

        if (packetSize != sizeof(AckPacket)) {

            while (LoRa.available()) {
                LoRa.read();
            }

            LoRa.receive();
            continue;
        }

        AckPacket ack;

        int received = LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&ack),
            sizeof(ack)
        );

        LoRa.receive();

        if (received != sizeof(ack)) {
            continue;
        }

        if (ack.magic != PROTOCOL_MAGIC ||
            ack.version != PROTOCOL_VERSION ||
            ack.type != PACKET_ACK) {
            continue;
        }

        if (ack.origin_id != MY_NODE_ID) {
            continue;
        }

        if (ack.origin_root != originRoot) {
            continue;
        }

        uint8_t responderPublicKey[32];

        if (!getTrustedEd25519PublicKey(
            ack.responder_id,
            responderPublicKey
        )) {
            Serial.println("Unknown ACK responder");
            continue;
        }

        if (!verifyAck(
            ack,
            responderPublicKey
        )) {
            Serial.println("Invalid ACK signature");
            continue;
        }

        Serial.print("Valid ACK received from node ID: ");
        Serial.println(ack.responder_id);

        return true;
    }

    LoRa.receive();

    return false;
}

static bool createSOS(
    MeshPacket &packet,
    const char *location
) {
    memset(&packet, 0, sizeof(packet));

    packet.magic = PROTOCOL_MAGIC;
    packet.version = PROTOCOL_VERSION;
    packet.type = PACKET_DATA;

    packet.origin_id = MY_NODE_ID;
    packet.hop_count = 0;

    packet.timestamp_ms = millis();

    generateNonce(packet.nonce);

    packet.origin_root = createInitialRoot(
        location,
        packet.timestamp_ms,
        MY_NODE_ID
    );

    packet.current_root = packet.origin_root;

    packet.visited_mask = nodeMask(MY_NODE_ID);

    uint8_t ownX25519Private[32];
    uint8_t rescueX25519Public[32];

    if (!hexToBytes(
        OWN_X25519_PRIVATE,
        ownX25519Private,
        32
    )) {
        Serial.println("ERROR: invalid own X25519 private key");
        return false;
    }

    if (!hexToBytes(
        TRUSTED_RESCUE_X25519,
        rescueX25519Public,
        32
    )) {
        Serial.println("ERROR: invalid Rescue X25519 public key");

        memset(
            ownX25519Private,
            0,
            sizeof(ownX25519Private)
        );

        return false;
    }

    uint8_t sharedSecret[32];

    if (!deriveSharedSecret(
        ownX25519Private,
        rescueX25519Public,
        sharedSecret
    )) {

        Serial.println(
            "ERROR: X25519 shared-secret derivation failed"
        );

        memset(
            ownX25519Private,
            0,
            sizeof(ownX25519Private)
        );

        memset(
            rescueX25519Public,
            0,
            sizeof(rescueX25519Public)
        );

        return false;
    }

    memset(
        ownX25519Private,
        0,
        sizeof(ownX25519Private)
    );

    memset(
        rescueX25519Public,
        0,
        sizeof(rescueX25519Public)
    );

    if (!encryptBody(
        location,
        packet.timestamp_ms,
        sharedSecret,
        packet.origin_root,
        packet.origin_id,
        packet.nonce,
        packet.ciphertext,
        packet.tag
    )) {

        Serial.println(
            "ERROR: ChaCha20-Poly1305 encryption failed"
        );

        memset(
            sharedSecret,
            0,
            sizeof(sharedSecret)
        );

        return false;
    }

    memset(
        sharedSecret,
        0,
        sizeof(sharedSecret)
    );

    uint8_t ownEdPrivate[32];
    uint8_t ownEdPublic[32];

    if (!hexToBytes(
        OWN_ED25519_PRIVATE,
        ownEdPrivate,
        32
    )) {

        Serial.println("ERROR: invalid Ed25519 private key");

        return false;
    }

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        ownEdPublic,
        32
    )) {

        Serial.println("ERROR: invalid Ed25519 public key");

        memset(
            ownEdPrivate,
            0,
            sizeof(ownEdPrivate)
        );

        return false;
    }

    signDataPacket(
        packet,
        ownEdPrivate,
        ownEdPublic
    );

    memset(
        ownEdPrivate,
        0,
        sizeof(ownEdPrivate)
    );

    memset(
        ownEdPublic,
        0,
        sizeof(ownEdPublic)
    );

    return true;
}

static void sendSOS(
    const char *location,
    const char *locationSource
) {

    if (waitingForAck) {
        Serial.println("SOS already in progress");
        return;
    }

    uint32_t now = millis();

    if (now - lastSOSRequest < SOS_COOLDOWN_MS) {
        Serial.println("SOS cooldown active");
        return;
    }

    if (location == nullptr ||
        strlen(location) == 0) {

        location = NODE_LOCATION;
        locationSource = "NODE";
    }

    lastSOSRequest = now;

    waitingForAck = true;

    Serial.println();
    Serial.println("==============================");
    Serial.println("SOS REQUEST RECEIVED");
    Serial.println("==============================");

    Serial.print("Location: ");
    Serial.println(location);

    Serial.print("Location source: ");
    Serial.println(locationSource);

    MeshPacket packet;

    if (!createSOS(
        packet,
        location
    )) {

        Serial.println("Failed to create SOS");

        waitingForAck = false;

        return;
    }

    Serial.print("Origin NODE: ");
    Serial.println(packet.origin_id);

    Serial.print("Origin root: ");
    Serial.println(packet.origin_root);

    Serial.print("Packet size: ");
    Serial.println(sizeof(packet));

    for (
        int attempt = 1;
        attempt <= ORIGIN_RETRIES;
        attempt++
    ) {

        Serial.print("Sending SOS attempt ");
        Serial.print(attempt);
        Serial.print("/");
        Serial.println(ORIGIN_RETRIES);

        transmitData(packet);

        if (waitForAck(packet.origin_root)) {

            Serial.println(
                "================================"
            );

            Serial.println(
                "SOS DELIVERED / ACK RECEIVED"
            );

            Serial.println(
                "================================"
            );

            waitingForAck = false;

            return;
        }

        Serial.println("No valid ACK received");
    }

    Serial.println(
        "SOS delivery failed after retries"
    );

    waitingForAck = false;

    LoRa.receive();
}

static bool parsePhoneLocation(
    String body,
    String &location
) {
    int latitudeIndex = body.indexOf("\"latitude\"");
    int longitudeIndex = body.indexOf("\"longitude\"");

    if (latitudeIndex < 0 ||
        longitudeIndex < 0) {
        return false;
    }

    int latitudeColon = body.indexOf(
        ':',
        latitudeIndex
    );

    int longitudeColon = body.indexOf(
        ':',
        longitudeIndex
    );

    if (latitudeColon < 0 ||
        longitudeColon < 0) {
        return false;
    }

    int latitudeEnd = body.indexOf(
        ',',
        latitudeColon
    );

    if (latitudeEnd < 0) {
        latitudeEnd = body.indexOf(
            '}',
            latitudeColon
        );
    }

    int longitudeEnd = body.indexOf(
        ',',
        longitudeColon
    );

    if (longitudeEnd < 0) {
        longitudeEnd = body.indexOf(
            '}',
            longitudeColon
        );
    }

    if (latitudeEnd < 0 ||
        longitudeEnd < 0) {
        return false;
    }

    String latitude = body.substring(
        latitudeColon + 1,
        latitudeEnd
    );

    String longitude = body.substring(
        longitudeColon + 1,
        longitudeEnd
    );

    latitude.trim();
    longitude.trim();

    latitude.replace("\"", "");
    longitude.replace("\"", "");

    double lat = latitude.toDouble();
    double lon = longitude.toDouble();

    if (lat < -90.0 ||
        lat > 90.0 ||
        lon < -180.0 ||
        lon > 180.0) {
        return false;
    }

    if (lat == 0.0 &&
        lon == 0.0) {
        return false;
    }

    location =
        latitude +
        "," +
        longitude;

    return true;
}

static bool verifyIncomingDataPacket(
    MeshPacket &packet
) {
    if (packet.magic != PROTOCOL_MAGIC) {
        return false;
    }

    if (packet.version != PROTOCOL_VERSION) {
        return false;
    }

    if (packet.type != PACKET_DATA) {
        return false;
    }

    if (packet.origin_id != NODE_A_ID &&
        packet.origin_id != NODE_B_ID) {

        return false;
    }

    if (packet.origin_id == MY_NODE_ID) {
        return false;
    }

    uint8_t publicKey[32];

    if (!getTrustedEd25519PublicKey(
        packet.origin_id,
        publicKey
    )) {
        Serial.println("Unknown packet origin");
        return false;
    }

    if (!verifyDataPacket(
        packet,
        publicKey
    )) {

        Serial.println(
            "DATA signature verification failed"
        );

        return false;
    }

    Serial.println(
        "DATA signature verified"
    );

    return true;
}

static bool competingPacketHeard(
    uint32_t originRoot
) {
    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return false;
    }

    if (packetSize == sizeof(AckPacket)) {

        AckPacket ack;

        int received = LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&ack),
            sizeof(ack)
        );

        if (received != sizeof(ack)) {
            return false;
        }

        if (ack.magic == PROTOCOL_MAGIC &&
            ack.version == PROTOCOL_VERSION &&
            ack.type == PACKET_ACK &&
            ack.origin_root == originRoot) {

            Serial.println(
                "Another node / Rescue already ACKed SOS"
            );

            return true;
        }

        return false;
    }

    if (packetSize == sizeof(MeshPacket)) {

        MeshPacket packet;

        int received = LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&packet),
            sizeof(packet)
        );

        if (received != sizeof(packet)) {
            return false;
        }

        if (packet.magic == PROTOCOL_MAGIC &&
            packet.version == PROTOCOL_VERSION &&
            packet.type == PACKET_DATA &&
            packet.origin_root == originRoot) {

            if (packet.visited_mask & nodeMask(MY_NODE_ID)) {
                return false;
            }

            Serial.println(
                "Another relay packet heard; cancelling relay"
            );

            return true;
        }

        return false;
    }

    while (LoRa.available()) {
        LoRa.read();
    }

    return false;
}

static void relayPacket(
    MeshPacket packet,
    int receivedRSSI
) {
    Serial.println();
    Serial.println("------------------------------");
    Serial.println("SOS PACKET RECEIVED");
    Serial.println("------------------------------");

    Serial.print("Origin node: ");
    Serial.println(packet.origin_id);

    Serial.print("RSSI: ");
    Serial.print(receivedRSSI);
    Serial.println(" dBm");

    Serial.print("Current root: ");
    Serial.println(packet.current_root);

    Serial.print("Hop count: ");
    Serial.println(packet.hop_count);

    Serial.print("Visited mask: 0x");
    Serial.println(packet.visited_mask, HEX);

    uint32_t relayDelay =
        relayDelayFromRSSI(receivedRSSI);

    Serial.print("Relay delay: ");
    Serial.print(relayDelay);
    Serial.println(" ms");

    LoRa.receive();

    uint32_t start = millis();

    while (millis() - start < relayDelay) {

        if (competingPacketHeard(
            packet.origin_root
        )) {

            LoRa.receive();

            Serial.println("Relay suppressed");

            return;
        }

        delay(2);
    }

    packet.hop_count++;

    packet.visited_mask |= nodeMask(MY_NODE_ID);

    packet.current_root =
        createNextRoot(
            packet.current_root,
            MY_NODE_ID
        );

    if (packet.hop_count > 8) {

        Serial.println(
            "Maximum hop count reached; not relaying"
        );

        LoRa.receive();

        return;
    }

    Serial.println("Relaying SOS...");

    Serial.print("New hop count: ");
    Serial.println(packet.hop_count);

    Serial.print("New root: ");
    Serial.println(packet.current_root);

    Serial.print("Visited mask: 0x");
    Serial.println(packet.visited_mask, HEX);

    transmitData(packet);

    Serial.println("SOS relayed");

    sendAck(
        packet.origin_id,
        packet.origin_root,
        packet.current_root
    );

    LoRa.receive();
}

static void receivePackets() {

    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return;
    }

    if (packetSize == sizeof(AckPacket)) {

        while (LoRa.available()) {
            LoRa.read();
        }

        return;
    }

    if (packetSize != sizeof(MeshPacket)) {

        Serial.print(
            "Ignoring packet with unexpected size: "
        );

        Serial.println(packetSize);

        while (LoRa.available()) {
            LoRa.read();
        }

        LoRa.receive();

        return;
    }

    MeshPacket packet;

    int received = LoRa.readBytes(
        reinterpret_cast<uint8_t*>(&packet),
        sizeof(packet)
    );

    int rssi = LoRa.packetRssi();

    LoRa.receive();

    if (received != sizeof(packet)) {

        Serial.println(
            "Failed to read complete MeshPacket"
        );

        return;
    }

    if (!verifyIncomingDataPacket(packet)) {

        Serial.println(
            "Rejected invalid DATA packet"
        );

        return;
    }

    if (packet.visited_mask & nodeMask(MY_NODE_ID)) {

        Serial.println(
            "Packet already visited this node"
        );

        return;
    }

    relayPacket(
        packet,
        rssi
    );
}

const char MAIN_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html>
<head>

<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111111">

<title>Rescue Mesh</title>

<style>

* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #111;
    color: white;
    font-family: Arial, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
}

.container {
    width: 100%;
    max-width: 430px;
    padding: 25px;
    text-align: center;
}

.logo {
    font-size: 30px;
    font-weight: bold;
    margin-bottom: 8px;
}

.subtitle {
    color: #aaa;
    margin-bottom: 35px;
}

.sos {
    width: 230px;
    height: 230px;
    border-radius: 50%;
    border: 8px solid #fff;
    background: #d60000;
    color: white;
    font-size: 32px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 0 30px rgba(255,0,0,0.5);
}

.sos:active {
    transform: scale(0.95);
}

.status {
    margin-top: 30px;
    padding: 18px;
    border-radius: 12px;
    background: #222;
}

.connected {
    color: #00ff88;
}

.warning {
    color: #ffcc00;
}

.success {
    color: #00ff88;
}

.error {
    color: #ff4444;
}

.location {
    margin-top: 15px;
    font-size: 14px;
    color: #aaa;
}

.info {
    margin-top: 20px;
    color: #888;
    font-size: 14px;
}

button:disabled {
    opacity: 0.5;
}

</style>

</head>

<body>

<div class="container">

    <div class="logo">
        RESCUE MESH
    </div>

    <div class="subtitle">
        Emergency Communication Node
    </div>

    <button
        id="sosButton"
        class="sos"
        onclick="sendSOS()">
        SOS
    </button>

    <div class="status">

        <div>
            Node: <b>NODE A</b>
        </div>

        <div id="connection" class="connected">
            ESP32 CONNECTED
        </div>

        <div id="message">
            Ready
        </div>

        <div id="location" class="location">
            Location: checking...
        </div>

    </div>

    <div class="info">
        Phone GPS will be used when permission is granted.
        Otherwise the node's fixed location will be used.
    </div>

</div>

<script>

function getPhoneLocation() {

    return new Promise((resolve) => {

        if (!navigator.geolocation) {
            resolve(null);
            return;
        }

        navigator.geolocation.getCurrentPosition(

            (position) => {

                const latitude =
                    position.coords.latitude;

                const longitude =
                    position.coords.longitude;

                if (
                    typeof latitude !== "number" ||
                    typeof longitude !== "number" ||
                    latitude < -90 ||
                    latitude > 90 ||
                    longitude < -180 ||
                    longitude > 180
                ) {
                    resolve(null);
                    return;
                }

                resolve({
                    latitude: latitude,
                    longitude: longitude
                });
            },

            () => {
                resolve(null);
            },

            {
                enableHighAccuracy: true,
                timeout: 7000,
                maximumAge: 30000
            }
        );
    });
}

async function sendSOS() {

    const button =
        document.getElementById("sosButton");

    const message =
        document.getElementById("message");

    const locationElement =
        document.getElementById("location");

    button.disabled = true;

    message.innerHTML =
        '<span class="warning">Getting location...</span>';

    locationElement.innerHTML =
        "Location: requesting phone GPS...";

    let location = null;

    try {
        location = await getPhoneLocation();
    } catch (error) {
        location = null;
    }

    let requestBody = {};

    if (location !== null) {

        requestBody = {
            latitude: location.latitude,
            longitude: location.longitude
        };

        locationElement.innerHTML =
            "Location: phone GPS";

    } else {

        requestBody = {};

        locationElement.innerHTML =
            "Location: node fallback";
    }

    message.innerHTML =
        '<span class="warning">Sending SOS...</span>';

    try {

        const response =
            await fetch("/api/sos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestBody)
            });

        const data =
            await response.json();

        if (data.success) {

            message.innerHTML =
                '<span class="success">' +
                data.message +
                '</span>';

        } else {

            message.innerHTML =
                '<span class="error">' +
                data.message +
                '</span>';
        }

    } catch (error) {

        message.innerHTML =
            '<span class="error">' +
            'Could not communicate with ESP32' +
            '</span>';
    }

    setTimeout(() => {
        button.disabled = false;
    }, 10000);
}

</script>

</body>
</html>
)rawliteral";

void handleRoot() {

    server.send_P(
        200,
        "text/html",
        MAIN_PAGE
    );
}

void handleSOS() {

    uint32_t now = millis();

    if (waitingForAck) {

        server.send(
            409,
            "application/json",
            "{\"success\":false,\"message\":\"SOS already in progress\"}"
        );

        return;
    }

    if (now - lastSOSRequest < SOS_COOLDOWN_MS) {

        server.send(
            429,
            "application/json",
            "{\"success\":false,\"message\":\"Please wait before sending another SOS\"}"
        );

        return;
    }

    String body = server.arg("plain");

    String phoneLocation;

    bool validPhoneLocation =
        parsePhoneLocation(
            body,
            phoneLocation
        );

    String selectedLocation;

    const char *locationSource;

    if (validPhoneLocation) {

        selectedLocation = phoneLocation;

        locationSource = "PHONE";

        Serial.println(
            "Using phone GPS location"
        );

    } else {

        selectedLocation = NODE_LOCATION;

        locationSource = "NODE";

        Serial.println(
            "Phone GPS unavailable; using node location"
        );
    }

    server.send(
        200,
        "application/json",
        validPhoneLocation
            ? "{\"success\":true,\"message\":\"SOS accepted using phone GPS\"}"
            : "{\"success\":true,\"message\":\"SOS accepted using node location\"}"
    );

    delay(20);

    sendSOS(
        selectedLocation.c_str(),
        locationSource
    );
}

void handleStatus() {

    String response = "{";

    response += "\"node\":\"NODE_A\",";
    response += "\"waitingForAck\":";
    response += waitingForAck ? "true" : "false";
    response += ",";

    response += "\"wifiClients\":";
    response += WiFi.softAPgetStationNum();
    response += ",";

    response += "\"fallbackLocation\":\"";
    response += NODE_LOCATION;
    response += "\"";

    response += "}";

    server.send(
        200,
        "application/json",
        response
    );
}

void handleNotFound() {

    server.sendHeader(
        "Location",
        String("http://") +
        WiFi.softAPIP().toString(),
        true
    );

    server.send(
        302,
        "text/plain",
        ""
    );
}

void startCaptivePortal() {

    Serial.println();
    Serial.println("==============================");
    Serial.println("STARTING RESCUE MESH WI-FI");
    Serial.println("==============================");

    WiFi.mode(WIFI_AP);

    WiFi.softAP(
        WIFI_AP_SSID
    );

    IPAddress apIP =
        WiFi.softAPIP();

    Serial.print("Wi-Fi SSID: ");
    Serial.println(WIFI_AP_SSID);

    Serial.print("Wi-Fi password: NONE");
    Serial.println();

    Serial.print("ESP32 IP: ");
    Serial.println(apIP);

    dnsServer.start(
        DNS_PORT,
        "*",
        apIP
    );

    server.on(
        "/",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/api/sos",
        HTTP_POST,
        handleSOS
    );

    server.on(
        "/api/status",
        HTTP_GET,
        handleStatus
    );

    server.on(
        "/generate_204",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/hotspot-detect.html",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/connecttest.txt",
        HTTP_GET,
        handleRoot
    );

    server.on(
        "/ncsi.txt",
        HTTP_GET,
        handleRoot
    );

    server.onNotFound(
        handleNotFound
    );

    server.begin();

    Serial.println(
        "Captive portal started"
    );
}

void setup() {

    Serial.begin(115200);

    delay(1000);

    Serial.println();
    Serial.println("====================================");
    Serial.println("RESCUE MESH - NODE A");
    Serial.println("====================================");

    pinMode(
        SOS_BUTTON_PIN,
        INPUT_PULLUP
    );

    initLoRa();

    startCaptivePortal();

    Serial.println();
    Serial.println("Role: NORMAL");

    Serial.println("Capabilities:");
    Serial.println("  - Physical SOS");
    Serial.println("  - Wi-Fi SOS");
    Serial.println("  - Phone GPS SOS");
    Serial.println("  - Fixed location fallback");
    Serial.println("  - Captive portal");
    Serial.println("  - SOS relay");
    Serial.println("  - Ed25519 authentication");
    Serial.println("  - X25519 shared secret");
    Serial.println("  - HKDF-SHA256");
    Serial.println("  - ChaCha20-Poly1305");
    Serial.println("  - RSSI-based relay delay");

    Serial.print("Node ID: ");
    Serial.println(MY_NODE_ID);

    Serial.print("Fallback location: ");
    Serial.println(NODE_LOCATION);

    Serial.print("Packet size: ");
    Serial.println(sizeof(MeshPacket));

    Serial.print("ACK size: ");
    Serial.println(sizeof(AckPacket));

    Serial.println();
    Serial.println("NODE A READY");

    LoRa.receive();
}

void loop() {

    dnsServer.processNextRequest();

    server.handleClient();

    if (digitalRead(SOS_BUTTON_PIN) == LOW) {

        uint32_t now = millis();

        if (now - lastButtonPress >= BUTTON_DEBOUNCE_MS) {

            lastButtonPress = now;

            sendSOS(
                NODE_LOCATION,
                "NODE"
            );

            while (
                digitalRead(SOS_BUTTON_PIN) == LOW
            ) {
                delay(10);
            }

            LoRa.receive();
        }
    }

    if (!waitingForAck) {
        receivePackets();
    }

    delay(2);
}