#ifndef MESH_COMMON_H
#define MESH_COMMON_H

#include <Arduino.h>
#include <SPI.h>
#include <LoRa.h>
#include <esp_system.h>   // esp_random()

// =====================================================================
// HARDWARE WIRING - Plain ESP32 DevKit  +  SX1278 / RA-02 LoRa module
// Change these #defines if your jumper wires are connected differently.
// =====================================================================
#define LORA_SCK        18
#define LORA_MISO       19
#define LORA_MOSI       23
#define LORA_CS         27
#define LORA_RST        14
#define LORA_DIO0       26
#define LORA_FREQUENCY 433E6   // 433 MHz module

// =====================================================================
// MESH-WIDE CONSTANTS
// =====================================================================
// Maximum number of distinct nodes the Merkle-set can track.
// Must stay a power of two - it is the leaf count of the Merkle tree.
// Raise it to 32 if you need more boards; node_bitmask (uint32_t)
// already supports up to 32 nodes without changing its type.
#define MAX_NODES 16

#define BODY_LEN  60   // max characters in a message body (including null terminator)

// =====================================================================
// PACKET FORMAT
//
// This is intentionally UNENCRYPTED / UNSIGNED - testing only.
// The full production design (Ed25519 signatures + X25519/HKDF/
// ChaCha20-Poly1305 encryption) is in the project architecture docs -
// swap this struct and add those steps when you're ready to secure it.
//
//   message_id     - fixed for the life of a message, set once by
//                     whichever node originates it
//   node_bitmask   - the Merkle-set: bit i is set once node i has
//                     already relayed/seen this exact message. This
//                     IS the "node id" field - it doubles as the set
//                     representation so branches of the mesh can be
//                     merged with a plain bitwise OR.
//   merkle_root    - fingerprint of node_bitmask, produced by
//                     computeMerkleRoot(). Mutates every hop.
//   origin_node_id - which node created the message. Not needed for
//                     the relay decision, only kept for logging,
//                     because once >1 bit is set in node_bitmask you
//                     can no longer tell which one was the creator.
//   body           - plaintext payload, always null-terminated
// =====================================================================
typedef struct __attribute__((packed)) {
  uint32_t message_id;
  uint32_t node_bitmask;
  uint32_t merkle_root;
  uint8_t  origin_node_id;
  char     body[BODY_LEN];
} MeshPacket;

// =====================================================================
// MERKLE-SET ROOT
//
// A genuine binary Merkle tree over MAX_NODES leaves, one leaf per
// node ID - NOT a hash chain. Two branches of the mesh that each add
// different nodes to the bitmask can be merged with a plain bitwise
// OR and the root simply recomputed from scratch. A chain built as
// SHA256(root || node_id) cannot be merged like that, which is why
// the architecture doc rules it out.
//
// NOTE: mixLeaf()/mixParent() are simple integer-mixing functions,
// not cryptographic hashes - that's fine for this no-encryption test
// build. Swap them for SHA-256 when you move to the secured version.
// =====================================================================
inline uint32_t mixLeaf(uint32_t nodeIndex) {
  uint32_t x = nodeIndex + 0x9E3779B9UL;   // golden-ratio constant, just spreads the bits
  x ^= x >> 16; x *= 0x7FEB352DUL;
  x ^= x >> 15; x *= 0x846CA68BUL;
  x ^= x >> 16;
  return x;
}

inline uint32_t mixParent(uint32_t left, uint32_t right) {
  uint32_t x = left ^ (right + 0x9E3779B9UL + (left << 6) + (left >> 2));
  x ^= x >> 16; x *= 0x85EBCA6BUL;
  x ^= x >> 13; x *= 0xC2B2AE35UL;
  x ^= x >> 16;
  return x;
}

// Builds the Merkle tree bottom-up from the bitmask and returns the root.
inline uint32_t computeMerkleRoot(uint32_t bitmask) {
  uint32_t level[MAX_NODES];

  // Leaves: node present in the set -> hash of its index; absent -> empty leaf (0)
  for (int i = 0; i < MAX_NODES; i++) {
    bool present = bitmask & (1UL << i);
    level[i] = present ? mixLeaf((uint32_t)i) : 0UL;
  }

  // Fold the tree upward, pairwise, until a single root remains.
  int count = MAX_NODES;
  while (count > 1) {
    int next = 0;
    for (int i = 0; i < count; i += 2) {
      level[next++] = mixParent(level[i], level[i + 1]);
    }
    count = next;
  }
  return level[0];
}

// =====================================================================
// LoRa helpers shared by both sketches
// =====================================================================
inline void initLoRa() {
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    Serial.println(F("[LoRa] init FAILED - check wiring / frequency."));
    while (true) { delay(1000); }
  }
  Serial.println(F("[LoRa] radio initialized."));
}

// Sends a MeshPacket as raw bytes, then puts the radio back into
// continuous-receive mode so incoming packets keep triggering onReceive().
inline void transmitPacket(const MeshPacket &pkt) {
  LoRa.beginPacket();
  LoRa.write((const uint8_t *)&pkt, sizeof(MeshPacket));
  LoRa.endPacket();
  LoRa.receive();
}

// Prints a body[] array safely even if it somehow arrived without a
// null terminator.
inline void printBodySafe(const char *body) {
  char safe[BODY_LEN];
  memcpy(safe, body, BODY_LEN);
  safe[BODY_LEN - 1] = '\0';
  Serial.print(safe);
}

// One-line summary of a packet, reused by both sketches for consistent logs.
inline void printPacketSummary(const MeshPacket &pkt) {
  Serial.print(F("  id=0x"));      Serial.print(pkt.message_id, HEX);
  Serial.print(F(" origin="));     Serial.print(pkt.origin_node_id);
  Serial.print(F(" root=0x"));     Serial.print(pkt.merkle_root, HEX);
  Serial.print(F(" body=\""));     printBodySafe(pkt.body);
  Serial.println(F("\""));
}

#endif // MESH_COMMON_H
