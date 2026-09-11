// ============================================================================
// RescueMesh_Node1.ino
//
// NODE A - NORMAL NODE
//
// Capabilities:
//   1. SOS sender
//   2. SOS relay
//   3. Receives NODE B SOS and relays it
//   4. Ed25519 authentication
//   5. X25519 shared-secret derivation
//   6. HKDF-SHA256 encryption key derivation
//   7. ChaCha20-Poly1305 encryption
//   8. RSSI-based relay delay
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
// Required files in this folder:
//
//   RescueMesh_Node1.ino
//   mesh_common.h
//   node_a_config.h
// ============================================================================

#include <Arduino.h>
#include <LoRa.h>

#include "node_a_config.h"
#include "mesh_common.h"

// ============================================================================
// NODE ID
// ============================================================================

#define MY_NODE_ID NODE_A_ID

// ============================================================================
// CHANGE THIS TO THE ACTUAL LOCATION OF NODE A
// Example:
// const char SOS_LOCATION[] = "13.0827,80.2707";
// ============================================================================

const char SOS_LOCATION[] = "16.494939,80.499298";

// ============================================================================
// TIMING
// ============================================================================

#define ACK_TIMEOUT_MS       1200
#define ORIGIN_RETRIES      3
#define BUTTON_DEBOUNCE_MS  250

// ============================================================================
// NODE STATE
// ============================================================================

bool waitingForAck = false;
uint32_t lastButtonPress = 0;

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
//
// Uses the ACK helpers already provided by mesh_common.h:
//
//   createAck()
//   transmitAck()
//
// ============================================================================

static void sendAck(
    uint8_t originId,
    uint32_t originRoot,
    uint32_t currentRoot
) {
    AckPacket ack;

    uint8_t privateKey[32];
    uint8_t publicKey[32];

    // ------------------------------------------------------------------------
    // Load our Ed25519 private key
    // ------------------------------------------------------------------------

    if (!hexToBytes(
        OWN_ED25519_PRIVATE,
        privateKey,
        32
    )) {
        Serial.println("ERROR: invalid Ed25519 private key");
        return;
    }

    // ------------------------------------------------------------------------
    // Load our Ed25519 public key
    // ------------------------------------------------------------------------

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        publicKey,
        32
    )) {
        Serial.println("ERROR: invalid Ed25519 public key");
        memset(privateKey, 0, sizeof(privateKey));
        return;
    }

    // ------------------------------------------------------------------------
    // Create and sign ACK
    // ------------------------------------------------------------------------

    createAck(
        ack,
        MY_NODE_ID,
        originId,
        originRoot,
        currentRoot,
        privateKey,
        publicKey
    );

    // Clear private key from RAM
    memset(privateKey, 0, sizeof(privateKey));
    memset(publicKey, 0, sizeof(publicKey));

    Serial.print("Sending ACK from NODE_A to origin NODE_");
    Serial.println(originId);

    // ------------------------------------------------------------------------
    // Transmit ACK
    // ------------------------------------------------------------------------

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

    while (millis() - start < ACK_TIMEOUT_MS) {

        int packetSize = LoRa.parsePacket();

        if (packetSize <= 0) {
            delay(2);
            continue;
        }

        // --------------------------------------------------------------------
        // Ignore anything that is not an ACK
        // --------------------------------------------------------------------

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

        // --------------------------------------------------------------------
        // Basic ACK validation
        // --------------------------------------------------------------------

        if (ack.magic != PROTOCOL_MAGIC ||
            ack.version != PROTOCOL_VERSION ||
            ack.type != PACKET_ACK) {

            continue;
        }

        // --------------------------------------------------------------------
        // ACK must belong to this node
        // --------------------------------------------------------------------

        if (ack.origin_id != MY_NODE_ID) {
            continue;
        }

        // --------------------------------------------------------------------
        // ACK must belong to this exact SOS
        // --------------------------------------------------------------------

        if (ack.origin_root != originRoot) {
            continue;
        }

        // --------------------------------------------------------------------
        // Get trusted public key of responder
        // --------------------------------------------------------------------

        uint8_t responderPublicKey[32];

        if (!getTrustedEd25519PublicKey(
            ack.responder_id,
            responderPublicKey
        )) {
            Serial.println("Unknown ACK responder");
            continue;
        }

        // --------------------------------------------------------------------
        // Verify ACK signature
        // --------------------------------------------------------------------

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

// ============================================================================
// CREATE + ENCRYPT SOS
// ============================================================================

static bool createSOS(
    MeshPacket &packet
) {
    memset(&packet, 0, sizeof(packet));

    // ------------------------------------------------------------------------
    // Basic packet information
    // ------------------------------------------------------------------------

    packet.magic = PROTOCOL_MAGIC;
    packet.version = PROTOCOL_VERSION;
    packet.type = PACKET_DATA;

    packet.origin_id = MY_NODE_ID;
    packet.hop_count = 0;

    // ------------------------------------------------------------------------
    // Timestamp
    // ------------------------------------------------------------------------

    packet.timestamp_ms = millis();

    // ------------------------------------------------------------------------
    // Generate cryptographically random nonce
    // ------------------------------------------------------------------------

    generateNonce(packet.nonce);

    // ------------------------------------------------------------------------
    // Create initial routing root
    //
    // ROOT0 = SHA256(
    //     location +
    //     timestamp +
    //     origin node ID
    // )
    // ------------------------------------------------------------------------

    packet.origin_root = createInitialRoot(
        SOS_LOCATION,
        packet.timestamp_ms,
        MY_NODE_ID
    );

    packet.current_root = packet.origin_root;

    // ------------------------------------------------------------------------
    // Mark NODE A as visited
    // ------------------------------------------------------------------------

    packet.visited_mask = nodeMask(MY_NODE_ID);

    // ------------------------------------------------------------------------
    // Load our X25519 private key
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Load Rescue X25519 public key
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Derive X25519 shared secret
    // ------------------------------------------------------------------------

    uint8_t sharedSecret[32];

    if (!deriveSharedSecret(
        ownX25519Private,
        rescueX25519Public,
        sharedSecret
    )) {

        Serial.println("ERROR: X25519 shared-secret derivation failed");

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

    // Clear X25519 key material that is no longer needed
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
    //
    // encryptBody() internally:
    //
    //   1. Derives encryption key using HKDF
    //   2. Creates plaintext
    //   3. Creates ChaChaPoly cipher
    //   4. Adds authenticated data
    //   5. Encrypts plaintext
    //   6. Generates authentication tag
    // ------------------------------------------------------------------------

    if (!encryptBody(
        SOS_LOCATION,
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

    // ------------------------------------------------------------------------
    // Shared secret no longer needed
    // ------------------------------------------------------------------------

    memset(
        sharedSecret,
        0,
        sizeof(sharedSecret)
    );

    // ------------------------------------------------------------------------
    // Load our Ed25519 keys
    // ------------------------------------------------------------------------

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

        memset(
            ownEdPrivate,
            0,
            sizeof(ownEdPrivate)
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Sign immutable packet contents
    //
    // signDataPacket() deliberately excludes:
    //
    //   current_root
    //   visited_mask
    //   hop_count
    //
    // because these fields change while the packet is relayed.
    // ------------------------------------------------------------------------

    signDataPacket(
        packet,
        ownEdPrivate,
        ownEdPublic
    );

    // ------------------------------------------------------------------------
    // Clear key material
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

    // ------------------------------------------------------------------------
    // Create packet
    // ------------------------------------------------------------------------

    if (!createSOS(packet)) {

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

    // ------------------------------------------------------------------------
    // Send with retries
    // ------------------------------------------------------------------------

    for (
        int attempt = 1;
        attempt <= ORIGIN_RETRIES;
        attempt++
    ) {

        Serial.print("Sending SOS attempt ");
        Serial.print(attempt);
        Serial.print("/");
        Serial.println(ORIGIN_RETRIES);

        // --------------------------------------------------------------------
        // transmitData() sends the complete MeshPacket.
        // --------------------------------------------------------------------

        transmitData(packet);

        // --------------------------------------------------------------------
        // Wait for signed ACK
        // --------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // All retries failed
    // ------------------------------------------------------------------------

    Serial.println(
        "SOS delivery failed after retries"
    );

    waitingForAck = false;

    LoRa.receive();
}

// ============================================================================
// VERIFY INCOMING DATA PACKET
// ============================================================================
//
// This wrapper avoids a name collision with mesh_common.h's:
//
//     verifyDataPacket(packet, publicKey)
//
// ============================================================================

static bool verifyIncomingDataPacket(
    MeshPacket &packet
) {
    // ------------------------------------------------------------------------
    // Basic packet validation
    // ------------------------------------------------------------------------

    if (packet.magic != PROTOCOL_MAGIC) {
        return false;
    }

    if (packet.version != PROTOCOL_VERSION) {
        return false;
    }

    if (packet.type != PACKET_DATA) {
        return false;
    }

    // ------------------------------------------------------------------------
    // Only accept NODE A / NODE B originated SOS packets
    // ------------------------------------------------------------------------

    if (packet.origin_id != NODE_A_ID &&
        packet.origin_id != NODE_B_ID) {

        return false;
    }

    // ------------------------------------------------------------------------
    // Don't accept our own packet as a relay packet
    // ------------------------------------------------------------------------

    if (packet.origin_id == MY_NODE_ID) {
        return false;
    }

    // ------------------------------------------------------------------------
    // Find trusted public key for origin
    // ------------------------------------------------------------------------

    uint8_t publicKey[32];

    if (!getTrustedEd25519PublicKey(
        packet.origin_id,
        publicKey
    )) {
        Serial.println("Unknown packet origin");
        return false;
    }

    // ------------------------------------------------------------------------
    // Verify Ed25519 signature
    //
    // mesh_common.h's verifyDataPacket() reconstructs the immutable
    // SignedData structure before verification.
    // ------------------------------------------------------------------------

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

// ============================================================================
// CHECK WHETHER ANOTHER NODE HAS ALREADY RELAYED / ACCEPTED THE MESSAGE
// ============================================================================

static bool competingPacketHeard(
    uint32_t originRoot
) {
    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return false;
    }

    // ------------------------------------------------------------------------
    // ACK
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // DATA packet
    // ------------------------------------------------------------------------

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

            // If our bit is already present, this packet has already
            // passed through this node.
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

    // ------------------------------------------------------------------------
    // Unknown packet
    // ------------------------------------------------------------------------

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

    Serial.print("Hop count: ");
    Serial.println(packet.hop_count);

    Serial.print("Visited mask: 0x");
    Serial.println(packet.visited_mask, HEX);

    // ------------------------------------------------------------------------
    // RSSI-based relay delay
    //
    // Stronger signal -> shorter delay
    // Weaker signal   -> longer delay
    // ------------------------------------------------------------------------

    uint32_t relayDelay =
        relayDelayFromRSSI(receivedRSSI);

    Serial.print("Relay delay: ");
    Serial.print(relayDelay);
    Serial.println(" ms");

    // ------------------------------------------------------------------------
    // Listen during relay backoff period
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Update mutable routing information
    //
    // IMPORTANT:
    //
    // These fields are intentionally NOT re-signed because the signature
    // only covers immutable origin information.
    // ------------------------------------------------------------------------

    packet.hop_count++;

    packet.visited_mask |= nodeMask(MY_NODE_ID);

    packet.current_root =
        createNextRoot(
            packet.current_root,
            MY_NODE_ID
        );

    // ------------------------------------------------------------------------
    // Optional hop protection
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Send unchanged encrypted payload and signature.
    //
    // Only routing fields were modified.
    // ------------------------------------------------------------------------

    transmitData(packet);

    Serial.println("SOS relayed");

    // ------------------------------------------------------------------------
    // ACK origin after successful relay
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

    int packetSize = LoRa.parsePacket();

    if (packetSize <= 0) {
        return;
    }

    // ------------------------------------------------------------------------
    // ACK packets
    //
    // The sender handles its own ACK while waitingForAck.
    // If we're not waiting, simply ignore it.
    // ------------------------------------------------------------------------

    if (packetSize == sizeof(AckPacket)) {

        while (LoRa.available()) {
            LoRa.read();
        }

        return;
    }

    // ------------------------------------------------------------------------
    // Only accept exact MeshPacket size
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Read packet
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Verify cryptographic signature
    // ------------------------------------------------------------------------

    if (!verifyIncomingDataPacket(packet)) {

        Serial.println(
            "Rejected invalid DATA packet"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Check whether this node has already seen this packet
    // ------------------------------------------------------------------------

    if (packet.visited_mask & nodeMask(MY_NODE_ID)) {

        Serial.println(
            "Packet already visited this node"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Relay
    // ------------------------------------------------------------------------

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
    Serial.println("RESCUE MESH - NODE A");
    Serial.println("====================================");

    // ------------------------------------------------------------------------
    // SOS button
    // ------------------------------------------------------------------------

    pinMode(
        SOS_BUTTON_PIN,
        INPUT_PULLUP
    );

    // ------------------------------------------------------------------------
    // Initialize LoRa
    //
    // IMPORTANT:
    // initLoRa() is void in the supplied mesh_common.h.
    // It handles LoRa.begin() failure internally.
    // ------------------------------------------------------------------------

    initLoRa();

    // ------------------------------------------------------------------------
    // Display configuration
    // ------------------------------------------------------------------------

    Serial.println("Role: NORMAL");

    Serial.println("Capabilities:");
    Serial.println("  - SOS sender");
    Serial.println("  - SOS relay");
    Serial.println("  - Ed25519 authentication");
    Serial.println("  - X25519 shared secret");
    Serial.println("  - HKDF-SHA256");
    Serial.println("  - ChaCha20-Poly1305");
    Serial.println("  - RSSI-based relay delay");

    Serial.print("Node ID: ");
    Serial.println(MY_NODE_ID);

    Serial.print("Packet size: ");
    Serial.println(sizeof(MeshPacket));

    Serial.print("ACK size: ");
    Serial.println(sizeof(AckPacket));

    Serial.println("NODE A READY");

    LoRa.receive();
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {

    // ------------------------------------------------------------------------
    // SOS BUTTON
    // ------------------------------------------------------------------------

    if (digitalRead(SOS_BUTTON_PIN) == LOW) {

        uint32_t now = millis();

        if (now - lastButtonPress >= BUTTON_DEBOUNCE_MS) {

            lastButtonPress = now;

            sendSOS();

            // Wait until button is released
            while (digitalRead(SOS_BUTTON_PIN) == LOW) {
                delay(10);
            }

            LoRa.receive();
        }
    }

    // ------------------------------------------------------------------------
    // RECEIVE / RELAY
    // ------------------------------------------------------------------------

    if (!waitingForAck) {
        receivePackets();
    }

    delay(2);
}