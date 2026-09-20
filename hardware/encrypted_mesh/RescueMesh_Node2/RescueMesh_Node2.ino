// ============================================================================
// RescueMesh_Node2.ino
//
// NODE B - NORMAL NODE
//
// Capabilities:
//   1. Physical SOS button
//   2. Wi-Fi SOS from phone
//   3. Captive portal
//   4. Phone GPS location support
//   5. Hardcoded location fallback
//   6. SOS relay
//   7. Ed25519 authentication
//   8. X25519 shared-secret derivation
//   9. HKDF-SHA256 encryption key derivation
//  10. ChaCha20-Poly1305 encryption
//  11. RSSI-based relay delay
//
// Hardware:
//   LoRa SCK  -> GPIO18
//   LoRa MISO -> GPIO19
//   LoRa MOSI -> GPIO23
//   LoRa NSS  -> GPIO27
//   LoRa RST  -> GPIO14
//   LoRa DIO0 -> GPIO26
//   SOS       -> GPIO33 -> button -> GND
//
// Required files:
//   RescueMesh_Node2.ino
//   mesh_common.h
//   node_b_config.h
// ============================================================================

#include <Arduino.h>
#include <LoRa.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

#include "node_b_config.h"
#include "mesh_common.h"

// ============================================================================
// NODE ID
// ============================================================================

#define MY_NODE_ID NODE_B_ID

// ============================================================================
// HARD-CODED FALLBACK LOCATION
//
// This location is used when:
//   - phone GPS permission is denied
//   - browser does not support geolocation
//   - GPS location cannot be obtained
//   - invalid GPS data is received
//
// CHANGE THIS TO THE ACTUAL LOCATION OF NODE B.
//
// Example:
// const char FALLBACK_LOCATION[] = "13.0827,80.2707";
// ============================================================================

const char FALLBACK_LOCATION[] ="16.494751,80.498992";

// ============================================================================
// TIMING
// ============================================================================

#define ACK_TIMEOUT_MS       1200
#define ORIGIN_RETRIES       3
#define BUTTON_DEBOUNCE_MS   250
#define SOS_COOLDOWN_MS      10000

// ============================================================================
// WI-FI ACCESS POINT
// ============================================================================

#define WIFI_AP_SSID         "RESCUE-MESH"

#define DNS_PORT             53

// ============================================================================
// WEB SERVER
// ============================================================================

WebServer server(80);
DNSServer dnsServer;

// ============================================================================
// NODE STATE
// ============================================================================

bool waitingForAck = false;

uint32_t lastButtonPress = 0;
uint32_t lastSOSRequest = 0;

// ============================================================================
// TRUSTED ED25519 PUBLIC KEY LOOKUP
// ============================================================================

static bool getTrustedEd25519PublicKey(
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

// ============================================================================
// SEND ACK
// ============================================================================

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

        Serial.println(
            "ERROR: invalid Ed25519 private key"
        );

        return;
    }

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        publicKey,
        32
    )) {

        Serial.println(
            "ERROR: invalid Ed25519 public key"
        );

        memset(
            privateKey,
            0,
            sizeof(privateKey)
        );

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

    memset(
        privateKey,
        0,
        sizeof(privateKey)
    );

    memset(
        publicKey,
        0,
        sizeof(publicKey)
    );

    Serial.print(
        "Sending ACK from NODE_B to origin NODE_"
    );

    Serial.println(
        originId
    );

    transmitAck(ack);
}

// ============================================================================
// WAIT FOR ACK
// ============================================================================

static bool waitForAck(
    uint32_t originRoot
) {
    uint32_t start = millis();

    LoRa.receive();

    while (
        millis() - start < ACK_TIMEOUT_MS
    ) {

        int packetSize =
            LoRa.parsePacket();

        if (packetSize <= 0) {

            delay(2);

            continue;
        }

        if (
            packetSize != sizeof(AckPacket)
        ) {

            while (LoRa.available()) {
                LoRa.read();
            }

            LoRa.receive();

            continue;
        }

        AckPacket ack;

        int received =
            LoRa.readBytes(
                reinterpret_cast<uint8_t*>(&ack),
                sizeof(ack)
            );

        LoRa.receive();

        if (
            received != sizeof(ack)
        ) {

            continue;
        }

        if (
            ack.magic != PROTOCOL_MAGIC ||
            ack.version != PROTOCOL_VERSION ||
            ack.type != PACKET_ACK
        ) {

            continue;
        }

        if (
            ack.origin_id != MY_NODE_ID
        ) {

            continue;
        }

        if (
            ack.origin_root != originRoot
        ) {

            continue;
        }

        uint8_t responderPublicKey[32];

        if (
            !getTrustedEd25519PublicKey(
                ack.responder_id,
                responderPublicKey
            )
        ) {

            Serial.println(
                "Unknown ACK responder"
            );

            continue;
        }

        if (
            !verifyAck(
                ack,
                responderPublicKey
            )
        ) {

            Serial.println(
                "Invalid ACK signature"
            );

            continue;
        }

        Serial.print(
            "Valid ACK received from node ID: "
        );

        Serial.println(
            ack.responder_id
        );

        return true;
    }

    LoRa.receive();

    return false;
}

// ============================================================================
// CREATE + ENCRYPT SOS
//
// location:
//   Phone GPS location when available
//   OR FALLBACK_LOCATION when GPS unavailable
// ============================================================================

static bool createSOS(
    MeshPacket &packet,
    const char *location
) {
    memset(
        &packet,
        0,
        sizeof(packet)
    );

    // ------------------------------------------------------------------------
    // Packet header
    // ------------------------------------------------------------------------

    packet.magic =
        PROTOCOL_MAGIC;

    packet.version =
        PROTOCOL_VERSION;

    packet.type =
        PACKET_DATA;

    packet.origin_id =
        MY_NODE_ID;

    packet.hop_count =
        0;

    // ------------------------------------------------------------------------
    // Timestamp
    // ------------------------------------------------------------------------

    packet.timestamp_ms =
        millis();

    // ------------------------------------------------------------------------
    // Generate nonce
    // ------------------------------------------------------------------------

    generateNonce(
        packet.nonce
    );

    // ------------------------------------------------------------------------
    // Create initial root using actual SOS location
    // ------------------------------------------------------------------------

    packet.origin_root =
        createInitialRoot(
            location,
            packet.timestamp_ms,
            MY_NODE_ID
        );

    packet.current_root =
        packet.origin_root;

    // ------------------------------------------------------------------------
    // Mark NODE B as visited
    // ------------------------------------------------------------------------

    packet.visited_mask =
        nodeMask(MY_NODE_ID);

    // ------------------------------------------------------------------------
    // Load NODE B X25519 private key
    // ------------------------------------------------------------------------

    uint8_t ownX25519Private[32];
    uint8_t rescueX25519Public[32];

    if (
        !hexToBytes(
            OWN_X25519_PRIVATE,
            ownX25519Private,
            32
        )
    ) {

        Serial.println(
            "ERROR: invalid own X25519 private key"
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Load Rescue X25519 public key
    // ------------------------------------------------------------------------

    if (
        !hexToBytes(
            TRUSTED_RESCUE_X25519,
            rescueX25519Public,
            32
        )
    ) {

        Serial.println(
            "ERROR: invalid Rescue X25519 public key"
        );

        memset(
            ownX25519Private,
            0,
            sizeof(ownX25519Private)
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Derive shared secret
    // ------------------------------------------------------------------------

    uint8_t sharedSecret[32];

    if (
        !deriveSharedSecret(
            ownX25519Private,
            rescueX25519Public,
            sharedSecret
        )
    ) {

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

    // ------------------------------------------------------------------------
    // Clear X25519 key material
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Encrypt location + timestamp
    // ------------------------------------------------------------------------

    if (
        !encryptBody(
            location,
            packet.timestamp_ms,
            sharedSecret,
            packet.origin_root,
            packet.origin_id,
            packet.nonce,
            packet.ciphertext,
            packet.tag
        )
    ) {

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

    // ------------------------------------------------------------------------
    // Clear shared secret
    // ------------------------------------------------------------------------

    memset(
        sharedSecret,
        0,
        sizeof(sharedSecret)
    );

    // ------------------------------------------------------------------------
    // Load NODE B Ed25519 keys
    // ------------------------------------------------------------------------

    uint8_t ownEdPrivate[32];
    uint8_t ownEdPublic[32];

    if (
        !hexToBytes(
            OWN_ED25519_PRIVATE,
            ownEdPrivate,
            32
        )
    ) {

        Serial.println(
            "ERROR: invalid Ed25519 private key"
        );

        return false;
    }

    if (
        !hexToBytes(
            OWN_ED25519_PUBLIC,
            ownEdPublic,
            32
        )
    ) {

        Serial.println(
            "ERROR: invalid Ed25519 public key"
        );

        memset(
            ownEdPrivate,
            0,
            sizeof(ownEdPrivate)
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Sign packet
    // ------------------------------------------------------------------------

    signDataPacket(
        packet,
        ownEdPrivate,
        ownEdPublic
    );

    // ------------------------------------------------------------------------
    // Clear Ed25519 keys
    // ------------------------------------------------------------------------

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

// ============================================================================
// SEND SOS
//
// location:
//   Phone GPS location OR fallback location
// ============================================================================

static void sendSOS(
    const char *location
) {
    if (
        waitingForAck
    ) {

        Serial.println(
            "SOS already in progress"
        );

        return;
    }

    uint32_t now =
        millis();

    if (
        now - lastSOSRequest <
        SOS_COOLDOWN_MS
    ) {

        Serial.println(
            "SOS cooldown active"
        );

        return;
    }

    lastSOSRequest =
        now;

    waitingForAck =
        true;

    Serial.println();
    Serial.println(
        "=============================="
    );
    Serial.println(
        "SOS REQUEST RECEIVED"
    );
    Serial.println(
        "=============================="
    );

    Serial.print(
        "SOS Location: "
    );

    Serial.println(
        location
    );

    MeshPacket packet;

    if (
        !createSOS(
            packet,
            location
        )
    ) {

        Serial.println(
            "Failed to create SOS"
        );

        waitingForAck =
            false;

        return;
    }

    Serial.print(
        "Origin NODE: "
    );

    Serial.println(
        packet.origin_id
    );

    Serial.print(
        "Origin root: "
    );

    Serial.println(
        packet.origin_root
    );

    Serial.print(
        "Packet size: "
    );

    Serial.println(
        sizeof(packet)
    );

    for (
        int attempt = 1;
        attempt <= ORIGIN_RETRIES;
        attempt++
    ) {

        Serial.print(
            "Sending SOS attempt "
        );

        Serial.print(
            attempt
        );

        Serial.print(
            "/"
        );

        Serial.println(
            ORIGIN_RETRIES
        );

        transmitData(
            packet
        );

        if (
            waitForAck(
                packet.origin_root
            )
        ) {

            Serial.println(
                "================================"
            );

            Serial.println(
                "SOS DELIVERED / ACK RECEIVED"
            );

            Serial.println(
                "================================"
            );

            waitingForAck =
                false;

            return;
        }

        Serial.println(
            "No valid ACK received"
        );
    }

    Serial.println(
        "SOS delivery failed after retries"
    );

    waitingForAck =
        false;

    LoRa.receive();
}

// ============================================================================
// VERIFY INCOMING DATA PACKET
// ============================================================================

static bool verifyIncomingDataPacket(
    MeshPacket &packet
) {
    if (
        packet.magic != PROTOCOL_MAGIC
    ) {

        return false;
    }

    if (
        packet.version != PROTOCOL_VERSION
    ) {

        return false;
    }

    if (
        packet.type != PACKET_DATA
    ) {

        return false;
    }

    if (
        packet.origin_id != NODE_A_ID &&
        packet.origin_id != NODE_B_ID
    ) {

        return false;
    }

    if (
        packet.origin_id == MY_NODE_ID
    ) {

        return false;
    }

    uint8_t publicKey[32];

    if (
        !getTrustedEd25519PublicKey(
            packet.origin_id,
            publicKey
        )
    ) {

        Serial.println(
            "Unknown packet origin"
        );

        return false;
    }

    if (
        !verifyDataPacket(
            packet,
            publicKey
        )
    ) {

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

// ============================================================================
// CHECK FOR COMPETING RELAY / ACK
// ============================================================================

static bool competingPacketHeard(
    uint32_t originRoot
) {
    int packetSize =
        LoRa.parsePacket();

    if (
        packetSize <= 0
    ) {

        return false;
    }

    // ------------------------------------------------------------------------
    // ACK
    // ------------------------------------------------------------------------

    if (
        packetSize == sizeof(AckPacket)
    ) {

        AckPacket ack;

        int received =
            LoRa.readBytes(
                reinterpret_cast<uint8_t*>(&ack),
                sizeof(ack)
            );

        if (
            received != sizeof(ack)
        ) {

            return false;
        }

        if (
            ack.magic == PROTOCOL_MAGIC &&
            ack.version == PROTOCOL_VERSION &&
            ack.type == PACKET_ACK &&
            ack.origin_root == originRoot
        ) {

            Serial.println(
                "Another node / Rescue already ACKed SOS"
            );

            return true;
        }

        return false;
    }

    // ------------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------------

    if (
        packetSize == sizeof(MeshPacket)
    ) {

        MeshPacket packet;

        int received =
            LoRa.readBytes(
                reinterpret_cast<uint8_t*>(&packet),
                sizeof(packet)
            );

        if (
            received != sizeof(packet)
        ) {

            return false;
        }

        if (
            packet.magic == PROTOCOL_MAGIC &&
            packet.version == PROTOCOL_VERSION &&
            packet.type == PACKET_DATA &&
            packet.origin_root == originRoot
        ) {

            if (
                packet.visited_mask &
                nodeMask(MY_NODE_ID)
            ) {

                return false;
            }

            Serial.println(
                "Another relay packet heard; cancelling relay"
            );

            return true;
        }

        return false;
    }

    while (
        LoRa.available()
    ) {

        LoRa.read();
    }

    return false;
}

// ============================================================================
// RELAY PACKET
// ============================================================================

static void relayPacket(
    MeshPacket packet,
    int receivedRSSI
) {
    Serial.println();
    Serial.println(
        "------------------------------"
    );

    Serial.println(
        "SOS PACKET RECEIVED"
    );

    Serial.println(
        "------------------------------"
    );

    Serial.print(
        "Origin node: "
    );

    Serial.println(
        packet.origin_id
    );

    Serial.print(
        "RSSI: "
    );

    Serial.print(
        receivedRSSI
    );

    Serial.println(
        " dBm"
    );

    Serial.print(
        "Current root: "
    );

    Serial.println(
        packet.current_root
    );

    Serial.print(
        "Hop count: "
    );

    Serial.println(
        packet.hop_count
    );

    Serial.print(
        "Visited mask: 0x"
    );

    Serial.println(
        packet.visited_mask,
        HEX
    );

    uint32_t relayDelay =
        relayDelayFromRSSI(
            receivedRSSI
        );

    Serial.print(
        "Relay delay: "
    );

    Serial.print(
        relayDelay
    );

    Serial.println(
        " ms"
    );

    LoRa.receive();

    uint32_t start =
        millis();

    while (
        millis() - start <
        relayDelay
    ) {

        if (
            competingPacketHeard(
                packet.origin_root
            )
        ) {

            LoRa.receive();

            Serial.println(
                "Relay suppressed"
            );

            return;
        }

        delay(2);
    }

    // ------------------------------------------------------------------------
    // Update routing fields
    // ------------------------------------------------------------------------

    packet.hop_count++;

    packet.visited_mask |=
        nodeMask(MY_NODE_ID);

    packet.current_root =
        createNextRoot(
            packet.current_root,
            MY_NODE_ID
        );

    // ------------------------------------------------------------------------
    // Maximum hop protection
    // ------------------------------------------------------------------------

    if (
        packet.hop_count > 8
    ) {

        Serial.println(
            "Maximum hop count reached; not relaying"
        );

        LoRa.receive();

        return;
    }

    Serial.println(
        "Relaying SOS..."
    );

    Serial.print(
        "New hop count: "
    );

    Serial.println(
        packet.hop_count
    );

    Serial.print(
        "New root: "
    );

    Serial.println(
        packet.current_root
    );

    Serial.print(
        "Visited mask: 0x"
    );

    Serial.println(
        packet.visited_mask,
        HEX
    );

    // ------------------------------------------------------------------------
    // Transmit relay packet
    // ------------------------------------------------------------------------

    transmitData(
        packet
    );

    Serial.println(
        "SOS relayed"
    );

    // ------------------------------------------------------------------------
    // ACK original sender
    // ------------------------------------------------------------------------

    sendAck(
        packet.origin_id,
        packet.origin_root,
        packet.current_root
    );

    LoRa.receive();
}

// ============================================================================
// RECEIVE PACKETS
// ============================================================================

static void receivePackets() {

    int packetSize =
        LoRa.parsePacket();

    if (
        packetSize <= 0
    ) {

        return;
    }

    // ------------------------------------------------------------------------
    // ACK
    // ------------------------------------------------------------------------

    if (
        packetSize == sizeof(AckPacket)
    ) {

        while (
            LoRa.available()
        ) {

            LoRa.read();
        }

        return;
    }

    // ------------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------------

    if (
        packetSize != sizeof(MeshPacket)
    ) {

        Serial.print(
            "Ignoring unexpected packet size: "
        );

        Serial.println(
            packetSize
        );

        while (
            LoRa.available()
        ) {

            LoRa.read();
        }

        LoRa.receive();

        return;
    }

    MeshPacket packet;

    int received =
        LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&packet),
            sizeof(packet)
        );

    int rssi =
        LoRa.packetRssi();

    LoRa.receive();

    if (
        received != sizeof(packet)
    ) {

        Serial.println(
            "Failed to read complete MeshPacket"
        );

        return;
    }

    if (
        !verifyIncomingDataPacket(
            packet
        )
    ) {

        Serial.println(
            "Rejected invalid DATA packet"
        );

        return;
    }

    if (
        packet.visited_mask &
        nodeMask(MY_NODE_ID)
    ) {

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

// ============================================================================
// HTML PAGE
// ============================================================================

const char MAIN_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>

<html>

<head>

<meta
    name="viewport"
    content="width=device-width, initial-scale=1"
>

<meta
    name="theme-color"
    content="#111111"
>

<title>
    Rescue Mesh
</title>

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

    box-shadow:
        0 0 30px rgba(255,0,0,0.5);
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
    margin-top: 12px;
    color: #aaa;
    font-size: 13px;
    word-break: break-all;
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
        onclick="sendSOS()"
    >
        SOS
    </button>

    <div class="status">

        <div>
            Node: <b>NODE B</b>
        </div>

        <div
            id="connection"
            class="connected"
        >
            ESP32 CONNECTED
        </div>

        <div id="message">
            Ready
        </div>

        <div
            id="location"
            class="location"
        >
            Location: Node fallback location
        </div>

    </div>

    <div class="info">
        Your phone location will be used if you allow location access.
        Otherwise Node B's fixed location will be sent.
    </div>

</div>

<script>

function getFallbackMessage() {

    document.getElementById("location").innerHTML =
        "Location: Node B fallback location";

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

    let latitude = null;
    let longitude = null;

    if (
        "geolocation" in navigator
    ) {

        try {

            const position =
                await new Promise(
                    (resolve, reject) => {

                        navigator.geolocation.getCurrentPosition(
                            resolve,
                            reject,
                            {
                                enableHighAccuracy: true,
                                timeout: 8000,
                                maximumAge: 30000
                            }
                        );

                    }
                );

            latitude =
                position.coords.latitude;

            longitude =
                position.coords.longitude;

            locationElement.innerHTML =
                "Location: Phone GPS<br>" +
                latitude.toFixed(6) +
                "," +
                longitude.toFixed(6);

        } catch (error) {

            console.log(
                "Phone GPS unavailable:",
                error
            );

            getFallbackMessage();
        }

    } else {

        getFallbackMessage();
    }

    message.innerHTML =
        '<span class="warning">Sending SOS...</span>';

    try {

        let url =
            "/api/sos";

        if (
            latitude !== null &&
            longitude !== null
        ) {

            url +=
                "?lat=" +
                encodeURIComponent(latitude) +
                "&lon=" +
                encodeURIComponent(longitude);

        }

        const response =
            await fetch(
                url,
                {
                    method: "POST"
                }
            );

        const data =
            await response.json();

        if (
            data.success
        ) {

            message.innerHTML =
                '<span class="success">' +
                'SOS transmission started' +
                '</span>';

        } else {

            message.innerHTML =
                '<span class="error">' +
                data.message +
                '</span>';
        }

    } catch (error) {

        console.log(
            error
        );

        message.innerHTML =
            '<span class="error">' +
            'Could not communicate with ESP32' +
            '</span>';
    }

    setTimeout(
        () => {

            button.disabled =
                false;

        },
        10000
    );
}

</script>

</body>

</html>
)rawliteral";

// ============================================================================
// ROOT PAGE
// ============================================================================

void handleRoot() {

    server.send_P(
        200,
        "text/html",
        MAIN_PAGE
    );
}

// ============================================================================
// SOS API
//
// POST /api/sos
//
// With phone GPS:
//
// POST /api/sos?lat=13.123456&lon=80.123456
//
// Without GPS:
//
// POST /api/sos
//
// In the second case FALLBACK_LOCATION is used.
// ============================================================================

void handleSOS() {

    uint32_t now =
        millis();

    // ------------------------------------------------------------------------
    // Already processing SOS
    // ------------------------------------------------------------------------

    if (
        waitingForAck
    ) {

        server.send(
            409,
            "application/json",
            "{\"success\":false,\"message\":\"SOS already in progress\"}"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Cooldown
    // ------------------------------------------------------------------------

    if (
        now - lastSOSRequest <
        SOS_COOLDOWN_MS
    ) {

        server.send(
            429,
            "application/json",
            "{\"success\":false,\"message\":\"Please wait before sending another SOS\"}"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Default to hardcoded Node B location
    // ------------------------------------------------------------------------

    String sosLocation =
        String(FALLBACK_LOCATION);

    bool phoneLocationUsed =
        false;

    // ------------------------------------------------------------------------
    // Check whether phone sent GPS coordinates
    // ------------------------------------------------------------------------

    if (
        server.hasArg("lat") &&
        server.hasArg("lon")
    ) {

        String lat =
            server.arg("lat");

        String lon =
            server.arg("lon");

        lat.trim();
        lon.trim();

        // ------------------------------------------------------------
        // Basic validation
        // ------------------------------------------------------------

        if (
            lat.length() > 0 &&
            lon.length() > 0 &&
            lat.length() < 20 &&
            lon.length() < 20
        ) {

            float latitude =
                lat.toFloat();

            float longitude =
                lon.toFloat();

            if (
                latitude >= -90.0 &&
                latitude <= 90.0 &&
                longitude >= -180.0 &&
                longitude <= 180.0
            ) {

                sosLocation =
                    lat + "," + lon;

                phoneLocationUsed =
                    true;
            }
        }
    }

    // ------------------------------------------------------------------------
    // Print location source
    // ------------------------------------------------------------------------

    Serial.println();
    Serial.println(
        "=============================="
    );

    Serial.println(
        "WI-FI SOS REQUEST"
    );

    Serial.println(
        "=============================="
    );

    if (
        phoneLocationUsed
    ) {

        Serial.println(
            "Location source: PHONE GPS"
        );

    } else {

        Serial.println(
            "Location source: NODE B FALLBACK"
        );
    }

    Serial.print(
        "Location: "
    );

    Serial.println(
        sosLocation
    );

    // ------------------------------------------------------------------------
    // Tell browser request was accepted
    // ------------------------------------------------------------------------

    server.send(
        200,
        "application/json",
        phoneLocationUsed
            ? "{\"success\":true,\"message\":\"SOS accepted. Phone GPS location used.\"}"
            : "{\"success\":true,\"message\":\"SOS accepted. Node fallback location used.\"}"
    );

    delay(20);

    // ------------------------------------------------------------------------
    // Send SOS
    // ------------------------------------------------------------------------

    sendSOS(
        sosLocation.c_str()
    );
}

// ============================================================================
// STATUS API
// ============================================================================

void handleStatus() {

    String response =
        "{";

    response +=
        "\"node\":\"NODE_B\",";

    response +=
        "\"waitingForAck\":";

    response +=
        waitingForAck
            ? "true"
            : "false";

    response +=
        ",";

    response +=
        "\"wifiClients\":";

    response +=
        WiFi.softAPgetStationNum();

    response +=
        "}";

    server.send(
        200,
        "application/json",
        response
    );
}

// ============================================================================
// CAPTIVE PORTAL REDIRECT
// ============================================================================

void handleNotFound() {

    server.sendHeader(
        "Location",
        String(
            "http://"
        ) +
        WiFi.softAPIP().toString(),
        true
    );

    server.send(
        302,
        "text/plain",
        ""
    );
}

// ============================================================================
// START CAPTIVE PORTAL
// ============================================================================

void startCaptivePortal() {

    Serial.println();

    Serial.println(
        "=============================="
    );

    Serial.println(
        "STARTING RESCUE MESH WI-FI"
    );

    Serial.println(
        "=============================="
    );

    WiFi.mode(
        WIFI_AP
    );

    // ------------------------------------------------------------------------
    // Open Wi-Fi network
    //
    // No password.
    // ------------------------------------------------------------------------

    WiFi.softAP(
        WIFI_AP_SSID
    );

    IPAddress apIP =
        WiFi.softAPIP();

    Serial.print(
        "Wi-Fi SSID: "
    );

    Serial.println(
        WIFI_AP_SSID
    );

    Serial.print(
        "ESP32 IP: "
    );

    Serial.println(
        apIP
    );

    // ------------------------------------------------------------------------
    // DNS wildcard
    // ------------------------------------------------------------------------

    dnsServer.start(
        DNS_PORT,
        "*",
        apIP
    );

    // ------------------------------------------------------------------------
    // Main page
    // ------------------------------------------------------------------------

    server.on(
        "/",
        HTTP_GET,
        handleRoot
    );

    // ------------------------------------------------------------------------
    // SOS endpoint
    // ------------------------------------------------------------------------

    server.on(
        "/api/sos",
        HTTP_POST,
        handleSOS
    );

    // ------------------------------------------------------------------------
    // Status endpoint
    // ------------------------------------------------------------------------

    server.on(
        "/api/status",
        HTTP_GET,
        handleStatus
    );

    // ------------------------------------------------------------------------
    // Android captive portal detection
    // ------------------------------------------------------------------------

    server.on(
        "/generate_204",
        HTTP_GET,
        handleRoot
    );

    // ------------------------------------------------------------------------
    // Apple captive portal detection
    // ------------------------------------------------------------------------

    server.on(
        "/hotspot-detect.html",
        HTTP_GET,
        handleRoot
    );

    // ------------------------------------------------------------------------
    // Windows captive portal detection
    // ------------------------------------------------------------------------

    server.on(
        "/connecttest.txt",
        HTTP_GET,
        handleRoot
    );

    // ------------------------------------------------------------------------
    // Windows NCSI
    // ------------------------------------------------------------------------

    server.on(
        "/ncsi.txt",
        HTTP_GET,
        handleRoot
    );

    // ------------------------------------------------------------------------
    // Any other URL
    // ------------------------------------------------------------------------

    server.onNotFound(
        handleNotFound
    );

    server.begin();

    Serial.println(
        "Captive portal started"
    );
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {

    Serial.begin(
        115200
    );

    delay(
        1000
    );

    Serial.println();

    Serial.println(
        "===================================="
    );

    Serial.println(
        "RESCUE MESH - NODE B"
    );

    Serial.println(
        "===================================="
    );

    // ------------------------------------------------------------------------
    // SOS button
    // ------------------------------------------------------------------------

    pinMode(
        SOS_BUTTON_PIN,
        INPUT_PULLUP
    );

    // ------------------------------------------------------------------------
    // Initialize LoRa
    // ------------------------------------------------------------------------

    initLoRa();

    // ------------------------------------------------------------------------
    // Start Wi-Fi captive portal
    // ------------------------------------------------------------------------

    startCaptivePortal();

    // ------------------------------------------------------------------------
    // Display capabilities
    // ------------------------------------------------------------------------

    Serial.println();

    Serial.println(
        "Role: NORMAL"
    );

    Serial.println(
        "Capabilities:"
    );

    Serial.println(
        "  - Physical SOS"
    );

    Serial.println(
        "  - Wi-Fi SOS"
    );

    Serial.println(
        "  - Captive portal"
    );

    Serial.println(
        "  - Phone GPS location"
    );

    Serial.println(
        "  - Hardcoded location fallback"
    );

    Serial.println(
        "  - SOS relay"
    );

    Serial.println(
        "  - Ed25519 authentication"
    );

    Serial.println(
        "  - X25519 shared secret"
    );

    Serial.println(
        "  - HKDF-SHA256"
    );

    Serial.println(
        "  - ChaCha20-Poly1305"
    );

    Serial.println(
        "  - RSSI-based relay delay"
    );

    Serial.print(
        "Node ID: "
    );

    Serial.println(
        MY_NODE_ID
    );

    Serial.print(
        "Fallback location: "
    );

    Serial.println(
        FALLBACK_LOCATION
    );

    Serial.print(
        "Packet size: "
    );

    Serial.println(
        sizeof(MeshPacket)
    );

    Serial.print(
        "ACK size: "
    );

    Serial.println(
        sizeof(AckPacket)
    );

    Serial.println();

    Serial.println(
        "Wi-Fi network: RESCUE-MESH"
    );

    Serial.println(
        "Wi-Fi security: OPEN"
    );

    Serial.println(
        "Phone GPS: ENABLED"
    );

    Serial.println(
        "Fallback GPS: ENABLED"
    );

    LoRa.receive();

    Serial.println();

    Serial.println(
        "NODE B READY"
    );
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {

    // ------------------------------------------------------------------------
    // Captive portal DNS
    // ------------------------------------------------------------------------

    dnsServer.processNextRequest();

    // ------------------------------------------------------------------------
    // Web server
    // ------------------------------------------------------------------------

    server.handleClient();

    // ------------------------------------------------------------------------
    // Physical SOS button
    // ------------------------------------------------------------------------

    if (
        digitalRead(
            SOS_BUTTON_PIN
        ) == LOW
    ) {

        uint32_t now =
            millis();

        if (
            now - lastButtonPress >=
            BUTTON_DEBOUNCE_MS
        ) {

            lastButtonPress =
                now;

            // ---------------------------------------------------------------
            // Physical button always uses Node B's fixed location
            // ---------------------------------------------------------------

            sendSOS(
                FALLBACK_LOCATION
            );

            // ---------------------------------------------------------------
            // Wait for button release
            // ---------------------------------------------------------------

            while (
                digitalRead(
                    SOS_BUTTON_PIN
                ) == LOW
            ) {

                delay(10);
            }

            LoRa.receive();
        }
    }

    // ------------------------------------------------------------------------
    // Receive / relay LoRa packets
    // ------------------------------------------------------------------------

    if (
        !waitingForAck
    ) {

        receivePackets();
    }

    delay(2);
}