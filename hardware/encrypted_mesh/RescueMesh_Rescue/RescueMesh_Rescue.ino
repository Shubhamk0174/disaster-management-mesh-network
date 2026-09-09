#include "rescue_config.h"
#include "mesh_common.h"

// ============================================================
// RESCUE NODE
// ============================================================

#define MY_NODE_ID RESCUE_ID

// ============================================================
// KEY BUFFERS
// ============================================================

uint8_t ownEdPrivate[32];
uint8_t ownEdPublic[32];

uint8_t ownXPrivate[32];
uint8_t ownXPublic[32];

uint8_t nodeAEdPublic[32];
uint8_t nodeAXPublic[32];

uint8_t nodeBEdPublic[32];
uint8_t nodeBXPublic[32];

// ============================================================
// FIND TRUSTED ORIGIN KEYS
// ============================================================

bool getOriginKeys(
    uint8_t originId,
    uint8_t edPublic[32],
    uint8_t xPublic[32])
{
    if (originId == NODE_A_ID)
    {
        memcpy(
            edPublic,
            nodeAEdPublic,
            32
        );

        memcpy(
            xPublic,
            nodeAXPublic,
            32
        );

        return true;
    }

    if (originId == NODE_B_ID)
    {
        memcpy(
            edPublic,
            nodeBEdPublic,
            32
        );

        memcpy(
            xPublic,
            nodeBXPublic,
            32
        );

        return true;
    }

    return false;
}

// ============================================================
// SEND ACK TO ORIGIN
// ============================================================

void sendRescueAck(
    const MeshPacket &packet)
{
    AckPacket ack;

    createAck(
        ack,
        RESCUE_ID,
        packet.origin_id,
        packet.origin_root,
        packet.current_root,
        ownEdPrivate,
        ownEdPublic
    );

    transmitAck(ack);

    Serial.println(
        "[RESCUE] ACK sent"
    );
}

// ============================================================
// PROCESS DATA
// ============================================================

void processPacket()
{
    int packetSize =
        LoRa.parsePacket();

    if (packetSize != sizeof(MeshPacket))
    {
        if (packetSize > 0)
        {
            while (LoRa.available())
                LoRa.read();

            LoRa.receive();
        }

        return;
    }

    MeshPacket packet;

    int n =
        LoRa.readBytes(
            (uint8_t *)&packet,
            sizeof(packet)
        );

    int rssi =
        LoRa.packetRssi();

    LoRa.receive();

    if (n != sizeof(packet))
        return;

    // ========================================================
    // BASIC VALIDATION
    // ========================================================

    if (packet.magic != PROTOCOL_MAGIC)
    {
        Serial.println(
            "[RESCUE] bad magic"
        );

        return;
    }

    if (packet.version != PROTOCOL_VERSION)
    {
        Serial.println(
            "[RESCUE] bad version"
        );

        return;
    }

    if (packet.type != PACKET_DATA)
        return;

    if (
        packet.origin_id != NODE_A_ID &&
        packet.origin_id != NODE_B_ID
    )
    {
        Serial.println(
            "[RESCUE] unknown origin"
        );

        return;
    }

    // ========================================================
    // TRUSTED KEY LOOKUP
    // ========================================================

    uint8_t originEdPublic[32];
    uint8_t originXPublic[32];

    if (!getOriginKeys(
            packet.origin_id,
            originEdPublic,
            originXPublic))
    {
        Serial.println(
            "[RESCUE] origin not trusted"
        );

        return;
    }

    // ========================================================
    // ED25519 AUTHENTICATION
    // ========================================================

    if (!verifyDataPacket(
            packet,
            originEdPublic))
    {
        Serial.println();
        Serial.println(
            "[RESCUE] !!! INVALID SIGNATURE !!!"
        );

        return;
    }

    Serial.println(
        "[RESCUE] Ed25519 signature VALID"
    );

    // ========================================================
    // STATELESS NODE CHECK
    // ========================================================

    uint8_t myMask =
        nodeMask(RESCUE_ID);

    if (
        packet.visited_mask &
        myMask
    )
    {
        Serial.println(
            "[RESCUE] already visited"
        );

        return;
    }

    // ========================================================
    // UPDATE ROOT
    // ========================================================

    packet.visited_mask |=
        myMask;

    packet.current_root =
        createNextRoot(
            packet.current_root,
            RESCUE_ID
        );

    Serial.print(
        "[RESCUE] final root = 0x"
    );

    Serial.println(
        packet.current_root,
        HEX
    );

    Serial.print(
        "[RESCUE] RSSI = "
    );

    Serial.print(
        rssi
    );

    Serial.println(
        " dBm"
    );

    // ========================================================
    // X25519
    // ========================================================

    uint8_t sharedSecret[32];

    if (!deriveSharedSecret(
            ownXPrivate,
            originXPublic,
            sharedSecret))
    {
        Serial.println(
            "[RESCUE] X25519 FAILED"
        );

        memset(
            sharedSecret,
            0,
            sizeof(sharedSecret)
        );

        return;
    }

    Serial.println(
        "[RESCUE] X25519 shared secret derived"
    );

    // ========================================================
    // CHACHA20-POLY1305
    // ========================================================

    uint8_t plaintext[PLAINTEXT_LEN];

    memset(
        plaintext,
        0,
        sizeof(plaintext)
    );

    bool valid =
        decryptBody(
            packet,
            sharedSecret,
            plaintext
        );

    memset(
        sharedSecret,
        0,
        sizeof(sharedSecret)
    );

    if (!valid)
    {
        Serial.println();
        Serial.println(
            "[RESCUE] !!! AUTHENTICATION TAG INVALID !!!"
        );

        memset(
            plaintext,
            0,
            sizeof(plaintext)
        );

        return;
    }

    // ========================================================
    // DATA IS NOW AUTHENTICATED
    // ========================================================

    char location[33];

    memcpy(
        location,
        plaintext,
        32
    );

    location[32] =
        '\0';

    uint32_t timestamp =
        readTimestamp(
            plaintext
        );

    memset(
        plaintext,
        0,
        sizeof(plaintext)
    );

    // ========================================================
    // PRINT RESCUE MESSAGE
    // ========================================================

    Serial.println();
    Serial.println(
        "========================================"
    );

    Serial.println(
        "        RESCUE MESSAGE RECEIVED"
    );

    Serial.println(
        "========================================"
    );

    Serial.print(
        "Origin Node : NODE_"
    );

    if (packet.origin_id == NODE_A_ID)
        Serial.println("A");
    else
        Serial.println("B");

    Serial.print(
        "Location    : "
    );

    Serial.println(
        location
    );

    Serial.print(
        "Timestamp   : "
    );

    Serial.print(
        timestamp
    );

    Serial.println(
        " ms since origin boot"
    );

    Serial.print(
        "RSSI        : "
    );

    Serial.print(
        rssi
    );

    Serial.println(
        " dBm"
    );

    Serial.print(
        "Origin Root : 0x"
    );

    Serial.println(
        packet.origin_root,
        HEX
    );

    Serial.print(
        "Final Root  : 0x"
    );

    Serial.println(
        packet.current_root,
        HEX
    );

    Serial.print(
        "Hop Count   : "
    );

    Serial.println(
        packet.hop_count
    );

    Serial.println(
        "Encryption  : ChaCha20-Poly1305"
    );

    Serial.println(
        "Auth        : Ed25519"
    );

    Serial.println(
        "========================================"
    );

    // ========================================================
    // ACK
    // ========================================================

    sendRescueAck(packet);
}

// ============================================================
// SETUP
// ============================================================

void setup()
{
    Serial.begin(115200);

    delay(1000);

    Serial.println();
    Serial.println(
        "================================"
    );

    Serial.println(
        "RESCUE MESH - RESCUE NODE"
    );

    Serial.println(
        "================================"
    );

    // --------------------------------------------------------
    // OWN ED25519
    // --------------------------------------------------------

    if (!hexToBytes(
            OWN_ED25519_PRIVATE,
            ownEdPrivate,
            32))
    {
        Serial.println(
            "ERROR: Rescue Ed private"
        );

        while (true)
            delay(1000);
    }

    if (!hexToBytes(
            OWN_ED25519_PUBLIC,
            ownEdPublic,
            32))
    {
        Serial.println(
            "ERROR: Rescue Ed public"
        );

        while (true)
            delay(1000);
    }

    // --------------------------------------------------------
    // OWN X25519
    // --------------------------------------------------------

    if (!hexToBytes(
            OWN_X25519_PRIVATE,
            ownXPrivate,
            32))
    {
        Serial.println(
            "ERROR: Rescue X private"
        );

        while (true)
            delay(1000);
    }

    if (!hexToBytes(
            OWN_X25519_PUBLIC,
            ownXPublic,
            32))
    {
        Serial.println(
            "ERROR: Rescue X public"
        );

        while (true)
            delay(1000);
    }

    // --------------------------------------------------------
    // NODE A TRUSTED KEYS
    // --------------------------------------------------------

    if (!hexToBytes(
            TRUSTED_NODE_A_ED25519,
            nodeAEdPublic,
            32))
    {
        Serial.println(
            "ERROR: Node A Ed public"
        );

        while (true)
            delay(1000);
    }

    if (!hexToBytes(
            TRUSTED_NODE_A_X25519,
            nodeAXPublic,
            32))
    {
        Serial.println(
            "ERROR: Node A X public"
        );

        while (true)
            delay(1000);
    }

    // --------------------------------------------------------
    // NODE B TRUSTED KEYS
    // --------------------------------------------------------

    if (!hexToBytes(
            TRUSTED_NODE_B_ED25519,
            nodeBEdPublic,
            32))
    {
        Serial.println(
            "ERROR: Node B Ed public"
        );

        while (true)
            delay(1000);
    }

    if (!hexToBytes(
            TRUSTED_NODE_B_X25519,
            nodeBXPublic,
            32))
    {
        Serial.println(
            "ERROR: Node B X public"
        );

        while (true)
            delay(1000);
    }

    initLoRa();

    Serial.println(
        "RESCUE READY"
    );

    Serial.println(
        "Waiting for SOS..."
    );
}

// ============================================================
// LOOP
// ============================================================

void loop()
{
    processPacket();

    delay(2);
}