
// ============================================================================
// RescueMesh_Node2.ino
//
// NODE B - NORMAL NODE
//
// Capabilities:
//   1. SOS sender
//   2. SOS relay
//   3. Receives NODE A SOS and relays it
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
// Required files:
//
//   RescueMesh_Node2.ino
//   mesh_common.h
//   node_b_config.h
// ============================================================================

#include <Arduino.h>
#include <LoRa.h>

#include "node_b_config.h"
#include "mesh_common.h"

// ============================================================================
// NODE ID
// ============================================================================

#define MY_NODE_ID NODE_B_ID

// ============================================================================
// CHANGE THIS TO THE ACTUAL LOCATION OF NODE B
//
// Example:
// const char SOS_LOCATION[] = "13.0827,80.2707";
// ============================================================================

const char SOS_LOCATION[] = "16.494889,80.499150";

// ============================================================================
// TIMING
// ============================================================================

#define ACK_TIMEOUT_MS       1200
#define ORIGIN_RETRIES       3
#define BUTTON_DEBOUNCE_MS   250

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

static void sendAck(
    uint8_t originId,
    uint32_t originRoot,
    uint32_t currentRoot
) {
    AckPacket ack;

    uint8_t privateKey[32];
    uint8_t publicKey[32];

    // ------------------------------------------------------------------------
    // Load NODE B Ed25519 private key
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Load NODE B Ed25519 public key
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Create + sign ACK
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

    // ------------------------------------------------------------------------
    // Clear key material
    // ------------------------------------------------------------------------

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

    Serial.println(originId);

    // ------------------------------------------------------------------------
    // Send ACK
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
        // Ignore packets that are not ACKs
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
        // Basic validation
        // --------------------------------------------------------------------

        if (ack.magic != PROTOCOL_MAGIC ||
            ack.version != PROTOCOL_VERSION ||
            ack.type != PACKET_ACK) {

            continue;
        }

        // --------------------------------------------------------------------
        // ACK must belong to NODE B
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
        // Get responder's trusted public key
        // --------------------------------------------------------------------

        uint8_t responderPublicKey[32];

        if (!getTrustedEd25519PublicKey(
            ack.responder_id,
            responderPublicKey
        )) {

            Serial.println(
                "Unknown ACK responder"
            );

            continue;
        }

        // --------------------------------------------------------------------
        // Verify ACK signature
        // --------------------------------------------------------------------

        if (!verifyAck(
            ack,
            responderPublicKey
        )) {

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
// ============================================================================

static bool createSOS(
    MeshPacket &packet
) {
    memset(
        &packet,
        0,
        sizeof(packet)
    );

    // ------------------------------------------------------------------------
    // Packet header
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

    generateNonce(
        packet.nonce
    );

    // ------------------------------------------------------------------------
    // Create initial root
    // ------------------------------------------------------------------------

    packet.origin_root = createInitialRoot(
        SOS_LOCATION,
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

    if (!hexToBytes(
        OWN_X25519_PRIVATE,
        ownX25519Private,
        32
    )) {

        Serial.println(
            "ERROR: invalid own X25519 private key"
        );

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
    //
    // encryptBody() handles:
    //
    //   - HKDF key derivation
    //   - plaintext construction
    //   - ChaCha20-Poly1305
    //   - authenticated data
    //   - authentication tag
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
    // Shared secret no longer required
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

    if (!hexToBytes(
        OWN_ED25519_PRIVATE,
        ownEdPrivate,
        32
    )) {

        Serial.println(
            "ERROR: invalid own Ed25519 private key"
        );

        return false;
    }

    if (!hexToBytes(
        OWN_ED25519_PUBLIC,
        ownEdPublic,
        32
    )) {

        Serial.println(
            "ERROR: invalid own Ed25519 public key"
        );

        memset(
            ownEdPrivate,
            0,
            sizeof(ownEdPrivate)
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Sign immutable packet data
    //
    // signDataPacket() signs the immutable fields only.
    // Mutable routing fields such as hop_count, current_root and
    // visited_mask are deliberately excluded.
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

        Serial.println(
            "Failed to create SOS"
        );

        waitingForAck = false;

        return;
    }

    Serial.print(
        "Origin NODE: "
    );

    Serial.println(
        MY_NODE_ID
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

    // ------------------------------------------------------------------------
    // Retry
    // ------------------------------------------------------------------------

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

        // --------------------------------------------------------------------
        // Transmit packet
        // --------------------------------------------------------------------

        transmitData(
            packet
        );

        // --------------------------------------------------------------------
        // Wait for ACK
        // --------------------------------------------------------------------

        if (waitForAck(
            packet.origin_root
        )) {

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
            "No valid ACK received"
        );
    }

    // ------------------------------------------------------------------------
    // Failed
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
// This wrapper is intentionally named differently from the helper inside
// mesh_common.h.
//
// mesh_common.h already contains:
//
//     verifyDataPacket(packet, publicKey)
//
// ============================================================================

static bool verifyIncomingDataPacket(
    MeshPacket &packet
) {
    // ------------------------------------------------------------------------
    // Basic packet checks
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
    // Only NODE A / NODE B are valid SOS origins for a normal node
    // ------------------------------------------------------------------------

    if (packet.origin_id != NODE_A_ID &&
        packet.origin_id != NODE_B_ID) {

        return false;
    }

    // ------------------------------------------------------------------------
    // Ignore our own originated packets
    // ------------------------------------------------------------------------

    if (packet.origin_id == MY_NODE_ID) {
        return false;
    }

    // ------------------------------------------------------------------------
    // Find trusted origin public key
    // ------------------------------------------------------------------------

    uint8_t publicKey[32];

    if (!getTrustedEd25519PublicKey(
        packet.origin_id,
        publicKey
    )) {

        Serial.println(
            "Unknown packet origin"
        );

        return false;
    }

    // ------------------------------------------------------------------------
    // Verify Ed25519 signature
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
// CHECK FOR COMPETING RELAY / ACK
// ============================================================================

static bool competingPacketHeard(
    uint32_t originRoot
) {
    int packetSize =
        LoRa.parsePacket();

    if (packetSize <= 0) {
        return false;
    }

    // ------------------------------------------------------------------------
    // ACK
    // ------------------------------------------------------------------------

    if (packetSize == sizeof(AckPacket)) {

        AckPacket ack;

        int received =
            LoRa.readBytes(
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
    // DATA
    // ------------------------------------------------------------------------

    if (packetSize == sizeof(MeshPacket)) {

        MeshPacket packet;

        int received =
            LoRa.readBytes(
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

            // Already visited this node?
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

    // ------------------------------------------------------------------------
    // RSSI relay delay
    // ------------------------------------------------------------------------

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

    // ------------------------------------------------------------------------
    // Listen during relay delay
    // ------------------------------------------------------------------------

    LoRa.receive();

    uint32_t start = millis();

    while (
        millis() - start < relayDelay
    ) {

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

    // ------------------------------------------------------------------------
    // Update routing information
    //
    // These fields are mutable and are intentionally not re-signed.
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
    // Hop protection
    // ------------------------------------------------------------------------

    if (packet.hop_count > 8) {

        Serial.println(
            "Maximum hop count reached; not relaying"
        );

        LoRa.receive();

        return;
    }

    // ------------------------------------------------------------------------
    // Print updated routing state
    // ------------------------------------------------------------------------

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
    // ACK origin
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

    if (packetSize <= 0) {
        return;
    }

    // ------------------------------------------------------------------------
    // ACK
    // ------------------------------------------------------------------------

    if (packetSize == sizeof(AckPacket)) {

        while (LoRa.available()) {
            LoRa.read();
        }

        return;
    }

    // ------------------------------------------------------------------------
    // DATA
    // ------------------------------------------------------------------------

    if (packetSize != sizeof(MeshPacket)) {

        Serial.print(
            "Ignoring unexpected packet size: "
        );

        Serial.println(
            packetSize
        );

        while (LoRa.available()) {
            LoRa.read();
        }

        LoRa.receive();

        return;
    }

    // ------------------------------------------------------------------------
    // Read complete MeshPacket
    // ------------------------------------------------------------------------

    MeshPacket packet;

    int received =
        LoRa.readBytes(
            reinterpret_cast<uint8_t*>(&packet),
            sizeof(packet)
        );

    int rssi =
        LoRa.packetRssi();

    LoRa.receive();

    if (received != sizeof(packet)) {

        Serial.println(
            "Failed to read complete MeshPacket"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Verify origin signature
    // ------------------------------------------------------------------------

    if (!verifyIncomingDataPacket(
        packet
    )) {

        Serial.println(
            "Rejected invalid DATA packet"
        );

        return;
    }

    // ------------------------------------------------------------------------
    // Do not relay packets that already visited NODE B
    // ------------------------------------------------------------------------

    if (packet.visited_mask &
        nodeMask(MY_NODE_ID)) {

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
    Serial.println("RESCUE MESH - NODE B");
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
    // Do NOT write:
    //
    //     if (!initLoRa())
    //
    // ------------------------------------------------------------------------

    initLoRa();

    // ------------------------------------------------------------------------
    // Display capabilities
    // ------------------------------------------------------------------------

    Serial.println(
        "Role: NORMAL"
    );

    Serial.println(
        "Capabilities:"
    );

    Serial.println(
        "  - SOS sender"
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

    LoRa.receive();

    Serial.println(
        "NODE B READY"
    );
}

// ============================================================================
// LOOP
// ============================================================================

void loop() {

    // ------------------------------------------------------------------------
    // SOS BUTTON
    // ------------------------------------------------------------------------

    if (digitalRead(
        SOS_BUTTON_PIN
    ) == LOW) {

        uint32_t now =
            millis();

        if (
            now - lastButtonPress >=
            BUTTON_DEBOUNCE_MS
        ) {

            lastButtonPress =
                now;

            sendSOS();

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
    // RECEIVE / RELAY
    // ------------------------------------------------------------------------

    if (!waitingForAck) {
        receivePackets();
    }

    delay(2);
}
