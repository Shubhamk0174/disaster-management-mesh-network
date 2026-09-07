// =====================================================================
// rescue_node.ino
// Destination node for the ESP32 rescue mesh — TEST BUILD, no encryption.
//
// The Rescue node only LISTENS. It never relays and never adds its own
// bit to the Merkle-set — it's the end of the line, not a hop.
// Every packet that reaches it is printed to the Serial Monitor.
//
// DEBUG MODE ADDED:
//   Any radio activity is now logged, even packets that don't match
//   our MeshPacket size, along with RSSI (signal strength). This is
//   here specifically to diagnose "Rescue never receives anything" —
//   if you see NOTHING at all, even the debug line, the radio isn't
//   hearing any RF (check antenna/DIO0/power). If you see the debug
//   line with a wrong size, packets ARE arriving but don't match the
//   struct — check that both boards use the identical mesh_common.h.
//
// HOW TO USE
//   1. Install the "LoRa" library by Sandeep Mistry via
//      Arduino IDE -> Tools -> Manage Libraries.
//   2. Wire the SX1278/RA-02 module per mesh_common.h (adjust the
//      pin #defines there if your wiring is different).
//   3. Open the Serial Monitor at 115200 baud and watch it fill up
//      as normal nodes send/relay messages.
// =====================================================================

#include "mesh_common.h"

static volatile bool  packetWaiting = false;
static uint8_t         rxBuffer[sizeof(MeshPacket)];
static volatile int    lastRssi = 0;

void onLoRaReceive(int packetSize) {
  if (packetSize == 0) return;   // library sometimes fires a spurious 0-size event

  int rssi = LoRa.packetRssi();

  if (packetSize != sizeof(MeshPacket)) {
    // DEBUG: something arrived over the air but doesn't match our
    // packet format. Seeing this at all proves the radio link works.
    Serial.print(F("[LoRa][DEBUG] got "));
    Serial.print(packetSize);
    Serial.print(F(" bytes (expected "));
    Serial.print(sizeof(MeshPacket));
    Serial.print(F("), RSSI="));
    Serial.println(rssi);
    while (LoRa.available()) LoRa.read();
    return;
  }

  for (int i = 0; i < packetSize; i++) {
    rxBuffer[i] = (uint8_t)LoRa.read();
  }
  lastRssi = rssi;
  packetWaiting = true;
}

// Full, human-readable dump of a packet — the Rescue node is the one
// place in the mesh where we want to see everything, not just a summary.
void printPacket(const MeshPacket &pkt) {
  Serial.println(F("======================================"));
  Serial.println(F("MESSAGE RECEIVED AT RESCUE"));
  Serial.print(F("  message_id   : 0x")); Serial.println(pkt.message_id, HEX);
  Serial.print(F("  origin_node  : "));   Serial.println(pkt.origin_node_id);

  Serial.print(F("  node_bitmask : 0b"));
  for (int i = MAX_NODES - 1; i >= 0; i--) {
    Serial.print((pkt.node_bitmask >> i) & 1);
  }
  Serial.println();

  Serial.print(F("  merkle_root  : 0x")); Serial.println(pkt.merkle_root, HEX);
  Serial.print(F("  rssi         : "));   Serial.println(lastRssi);
  Serial.print(F("  body         : \""));
  printBodySafe(pkt.body);
  Serial.println(F("\""));
  Serial.println(F("======================================"));
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("=== Rescue Node booting ==="));

  initLoRa();

  LoRa.onReceive(onLoRaReceive);
  LoRa.receive();

  Serial.println(F("Listening for mesh traffic..."));
}

void loop() {
  // DEBUG: heartbeat every 5s so you can confirm the board is alive
  // and still in the loop, independent of whether LoRa hears anything.
  static unsigned long lastBeat = 0;
  if (millis() - lastBeat > 5000) {
    lastBeat = millis();
    Serial.println(F("[heartbeat] Rescue node alive, still listening..."));
  }

  if (packetWaiting) {
    packetWaiting = false;

    MeshPacket pkt;
    memcpy(&pkt, (const void *)rxBuffer, sizeof(MeshPacket));
    printPacket(pkt);
  }
}
