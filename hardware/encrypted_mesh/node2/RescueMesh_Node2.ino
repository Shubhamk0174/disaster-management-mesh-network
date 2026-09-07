// ============================================================================
// RescueMesh_Node2.ino
//
// NODE_B
// - SOS sender
// - SOS relay
// - Receives NODE_A SOS and relays it toward RESCUE
// - Uses Ed25519 authentication
// - Uses X25519 + HKDF-SHA256 for encryption-key derivation
// - Uses ChaCha20-Poly1305 for encryption/authentication
// - Uses RSSI-based relay delay
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
//   mesh_common.h
//   node_b_config.h
// ============================================================================

#include <Arduino.h>

#include "node_b_config.h"
#include "mesh_common.h"

#define MY_NODE_ID NODE_B_ID

// -----------------------------------------------------------------------------
// CHANGE THIS TO THE ACTUAL LOCATION OF NODE B
// -----------------------------------------------------------------------------
const char SOS_LOCATION[] = "YOUR_LATITUDE,YOUR_LONGITUDE";

// -----------------------------------------------------------------------------
// Timing
// -----------------------------------------------------------------------------

#define ACK_TIMEOUT_MS       1200
#define ORIGIN_RETRIES       3
#define BUTTON_DEBOUNCE_MS   250

// -----------------------------------------------------------------------------
// Node state
// -----------------------------------------------------------------------------

bool waitingForAck = false;
uint32_t lastButtonPress = 0;

// ============================================================================
// KEY LOOKUP
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

    memset(&ack, 0, sizeof(ack));

    ack.magic = PROTOCOL_MAGIC;
    ack.version = PROTOCOL_VERSION;
    ack.type = PACKET_ACK;

    ack.responder_id = MY_NODE_ID;
    ack.origin_id = originId;

    ack.origin_root = originRoot;
    ack.current_root = currentRoot;

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
        return;
    }

    uint8_t message[
        sizeof(AckPacket) - SIGNATURE_LEN
    ];

    memcpy(
        message,
        &ack,
        sizeof(AckPacket) - SIGNATURE_LEN
    );

    if (!signEd25519(
        ack.signature,
        privateKey,
        publicKey,
        message,
        sizeof(message)
    )) {
        Serial.println("ERROR: ACK signing failed");
        return;
    }

    Serial.print("Sending ACK from NODE_B to origin NODE_");
    Serial.println(originId);

    loraSend(
        reinterpret_cast<uint8_t*>(&ack),
        sizeof(ack)
    );
}

// ============================================================================
// WAIT FOR ACK
// ============================================================================

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

        LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&ack),
            sizeof(ack)
        );

        if (ack.magic != PROTOCOL_MAGIC ||
            ack.version != PROTOCOL_VERSION ||
            ack.type != PACKET_ACK) {

            LoRa.receive();
            continue;
        }

        if (ack.origin_id != MY_NODE_ID) {
            LoRa.receive();
            continue;
        }

        if (ack.origin_root != originRoot) {
            LoRa.receive();
            continue;
        }

        uint8_t responderPublicKey[32];

        if (!getTrustedEd25519PublicKey(
            ack.responder_id,
            responderPublicKey
        )) {
            LoRa.receive();
            continue;
        }

        uint8_t message[
            sizeof(AckPacket) - SIGNATURE_LEN
        ];

        memcpy(
            message,
            &ack,
            sizeof(AckPacket) - SIGNATURE_LEN
        );

        if (!verifyEd25519(
            ack.signature,
            responderPublicKey,
            message,
            sizeof(message)
        )) {
            Serial.println("Invalid ACK signature");
            LoRa.receive();
            continue;
        }

        Serial.print("ACK received from node ID: ");
        Serial.println(ack.responder_id);

        return true;
    }

    LoRa.receive();

    return false;
}

// ============================================================================
// CREATE + ENCRYPT SOS
// ============================================================================

static bool createSOS(
    MeshPacket &packet
) {
    memset(&packet, 0, sizeof(packet));

    packet.magic = PROTOCOL_MAGIC;
    packet.version = PROTOCOL_VERSION;
    packet.type = PACKET_DATA;

    packet.origin_id = MY_NODE_ID;
    packet.hop_count = 0;

    packet.timestamp_ms = millis();

    // -------------------------------------------------------------------------
    // Generate nonce
    // -------------------------------------------------------------------------

    randomBytes(
        packet.nonce,
        NONCE_LEN
    );

    // -------------------------------------------------------------------------
    // Initial root
    // -------------------------------------------------------------------------

    packet.origin_root = createInitialRoot(
        SOS_LOCATION,
        packet.timestamp_ms,
        MY_NODE_ID
    );

    packet.current_root = packet.origin_root;

    packet.visited_mask = nodeMask(MY_NODE_ID);

    // -------------------------------------------------------------------------
    // Plaintext
    // -------------------------------------------------------------------------

    uint8_t plaintext[PLAINTEXT_LEN];

    memset(
        plaintext,
        0,
        sizeof(plaintext)
    );

    size_t locationLength = strlen(SOS_LOCATION);

    if (locationLength > MAX_LOCATION_LEN) {
        locationLength = MAX_LOCATION_LEN;
    }

    memcpy(
        plaintext,
        SOS_LOCATION,
        locationLength
    );

    writeTimestamp(
        plaintext + MAX_LOCATION_LEN,
        packet.timestamp_ms
    );

    // -------------------------------------------------------------------------
    // X25519 with Rescue public key
    // -------------------------------------------------------------------------

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
        return false;
    }

    uint8_t sharedSecret[32];

    if (!deriveX25519SharedSecret(
        sharedSecret,
        ownX25519Private,
        rescueX25519Public
    )) {
        Serial.println("ERROR: X25519 failed");
        return false;
    }

    uint8_t encryptionKey[32];

    if (!deriveEncryptionKey(
        encryptionKey,
        sharedSecret,
        packet.origin_id,
        packet.origin_root
    )) {
        Serial.println("ERROR: HKDF failed");
        return false;
    }

    // -------------------------------------------------------------------------
    // ChaCha20-Poly1305
    // -------------------------------------------------------------------------

    uint8_t aad[10];

    createAAD(
        aad,
        packet.origin_id,
        packet.origin_root,
        packet.timestamp_ms
    );

    if (!encryptChaChaPoly(
        encryptionKey,
        packet.nonce,
        aad,
        sizeof(aad),
        plaintext,
        packet.ciphertext,
        PLAINTEXT_LEN,
        packet.tag
    )) {
        Serial.println(
            "ERROR: ChaCha20-Poly1305 encryption failed"
        );

        return false;
    }

    // -------------------------------------------------------------------------
    // Ed25519 signature
    // -------------------------------------------------------------------------

    uint8_t ownEdPrivate[32];
    uint8_t ownEdPublic[32];

    if (!hexToBytes(
        OWN_ED25519_PRIVATE,
        ownEdPrivate,
        32
    )) {
        Serial.println("ERROR: invalid own Ed25519 private key");
        return false;
    }

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        ownEdPublic,
        32
    )) {
        Serial.println("ERROR: invalid own Ed25519 public key");
        return false;
    }

    uint8_t signedData[
        sizeof(MeshPacket) - SIGNATURE_LEN
    ];

    memcpy(
        signedData,
        &packet,
        sizeof(MeshPacket) - SIGNATURE_LEN
    );

    if (!signEd25519(
        packet.signature,
        ownEdPrivate,
        ownEdPublic,
        signedData,
        sizeof(signedData)
    )) {
        Serial.println("ERROR: Ed25519 signing failed");
        return false;
    }

    return true;
}

// ============================================================================
// SEND SOS
// ============================================================================

static void sendSOS() {

    if (waitingForAck) {
        return;
    }

    waitingForAck = true;

    Serial.println();
    Serial.println("==============================");
    Serial.println("SOS BUTTON PRESSED");
    Serial.println("==============================");

    MeshPacket packet;

    if (!createSOS(packet)) {

        Serial.println(
            "Failed to create SOS"
        );

        waitingForAck = false;

        return;
    }

    Serial.print("Origin NODE: ");
    Serial.println(MY_NODE_ID);

    Serial.print("Origin root: ");
    Serial.println(packet.origin_root);

    for (int attempt = 1; attempt <= ORIGIN_RETRIES; attempt++) {

        Serial.print("Sending SOS attempt ");
        Serial.print(attempt);
        Serial.print("/");
        Serial.println(ORIGIN_RETRIES);

        loraSend(
            reinterpret_cast<uint8_t*>(&packet),
            sizeof(packet)
        );

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

        Serial.println(
            "No ACK received"
        );
    }

    Serial.println(
        "SOS delivery failed after retries"
    );

    waitingForAck = false;

    LoRa.receive();
}

// ============================================================================
// VERIFY DATA PACKET
// ============================================================================

static bool verifyDataPacket(
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
        return false;
    }

    uint8_t signedData[
        sizeof(MeshPacket) - SIGNATURE_LEN
    ];

    memcpy(
        signedData,
        &packet,
        sizeof(MeshPacket) - SIGNATURE_LEN
    );

    if (!verifyEd25519(
        packet.signature,
        publicKey,
        signedData,
        sizeof(signedData)
    )) {
        Serial.println(
            "DATA signature verification failed"
        );

        return false;
    }

    return true;
}

// ============================================================================
// CHECK FOR COMPETING RELAY / ACK
// ============================================================================

static bool competingPacketHeard(
    uint32_t originRoot
) {
    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return false;
    }

    // -------------------------------------------------------------------------
    // ACK
    // -------------------------------------------------------------------------

    if (packetSize == sizeof(AckPacket)) {

        AckPacket ack;

        LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&ack),
            sizeof(ack)
        );

        if (ack.magic == PROTOCOL_MAGIC &&
            ack.version == PROTOCOL_VERSION &&
            ack.type == PACKET_ACK &&
            ack.origin_root == originRoot) {

            Serial.println(
                "Another node/Rescue already ACKed SOS"
            );

            return true;
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // DATA
    // -------------------------------------------------------------------------

    if (packetSize == sizeof(MeshPacket)) {

        MeshPacket packet;

        LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&packet),
            sizeof(packet)
        );

        if (packet.magic == PROTOCOL_MAGIC &&
            packet.version == PROTOCOL_VERSION &&
            packet.type == PACKET_DATA &&
            packet.origin_root == originRoot) {

            if (packet.visited_mask &
                nodeMask(MY_NODE_ID)) {

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

// ============================================================================
// RELAY PACKET
// ============================================================================

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

    // -------------------------------------------------------------------------
    // RSSI-based relay delay
    // -------------------------------------------------------------------------

    uint32_t relayDelay = rssiToRelayDelay(
        receivedRSSI
    );

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

            Serial.println(
                "Relay suppressed"
            );

            return;
        }

        delay(2);
    }

    // -------------------------------------------------------------------------
    // Update mutable routing state ONCE
    // -------------------------------------------------------------------------

    packet.hop_count++;

    packet.visited_mask |= nodeMask(
        MY_NODE_ID
    );

    packet.current_root = nextRoot(
        packet.current_root,
        MY_NODE_ID
    );

    Serial.println(
        "Relaying SOS..."
    );

    Serial.print("New hop count: ");
    Serial.println(packet.hop_count);

    Serial.print("New root: ");
    Serial.println(packet.current_root);

    Serial.print("Visited mask: 0x");
    Serial.println(
        packet.visited_mask,
        HEX
    );

    // -------------------------------------------------------------------------
    // Relay
    // -------------------------------------------------------------------------

    loraSend(
        reinterpret_cast<uint8_t*>(&packet),
        sizeof(packet)
    );

    Serial.println(
        "SOS relayed"
    );

    // -------------------------------------------------------------------------
    // Tell origin that relay succeeded
    // -------------------------------------------------------------------------

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

    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return;
    }

    // -------------------------------------------------------------------------
    // ACK
    // -------------------------------------------------------------------------

    if (packetSize == sizeof(AckPacket)) {

        while (LoRa.available()) {
            LoRa.read();
        }

        return;
    }

    // -------------------------------------------------------------------------
    // DATA
    // -------------------------------------------------------------------------

    if (packetSize != sizeof(MeshPacket)) {

        while (LoRa.available()) {
            LoRa.read();
        }

        LoRa.receive();

        return;
    }

    MeshPacket packet;

    LoRa.readBytes(
        reinterpret_cast<uint8_t*>(&packet),
        sizeof(packet)
    );

    int rssi = LoRa.packetRssi();

    LoRa.receive();

    if (!verifyDataPacket(packet)) {

        Serial.println(
            "Rejected invalid DATA packet"
        );

        return;
    }

    // -------------------------------------------------------------------------
    // Do not relay a packet that has already visited this node
    // -------------------------------------------------------------------------

    if (packet.visited_mask &
        nodeMask(MY_NODE_ID)) {

        Serial.println(
            "Packet already visited this node"
        );

        return;
    }

    // -------------------------------------------------------------------------
    // This node is a relay
    // -------------------------------------------------------------------------

    relayPacket(
        packet,
        rssi
    );
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {

    Serial.begin(115200);

    delay(1000);

    Serial.println();
    Serial.println("====================================");
    Serial.println("RESCUE MESH - NODE B");
    Serial.println("====================================");

    pinMode(
        SOS_BUTTON_PIN,
        INPUT_PULLUP
    );

    if (!initLoRa()) {

        Serial.println(
            "LoRa initialization FAILED"
        );

        while (true) {
            delay(1000);
        }
    }

    Serial.println("Role: NORMAL");

    Serial.println("Capabilities:");
    Serial.println("  - SOS sender");
    Serial.println("  - SOS relay");
    Serial.println("  - Ed25519 authentication");
    Serial.println("  - X25519 + HKDF");
    Serial.println("  - ChaCha20-Poly1305");

    LoRa.receive();

    Serial.println(
        "NODE B READY"
    );
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {

    // -------------------------------------------------------------------------
    // SOS BUTTON
    // -------------------------------------------------------------------------

    if (digitalRead(SOS_BUTTON_PIN) == LOW) {

        uint32_t now = millis();

        if (now - lastButtonPress >=
            BUTTON_DEBOUNCE_MS) {

            lastButtonPress = now;

            sendSOS();

            while (
                digitalRead(SOS_BUTTON_PIN) == LOW
            ) {
                delay(10);
            }

            LoRa.receive();
        }
    }

    // -------------------------------------------------------------------------
    // RECEIVE / RELAY
    // -------------------------------------------------------------------------

    if (!waitingForAck) {
        receivePackets();
    }

    delay(2);
}