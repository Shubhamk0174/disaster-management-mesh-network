// =====================================================================
// normal_node.ino
// ESP32 Rescue Mesh - TEST BUILD
//
// GPIO 33 button -> sends SOS
// LoRa packets are received by polling, NOT interrupts.
//
// Button:
//   GPIO 33 ---- Push Button ---- GND
//
// INPUT_PULLUP:
//   Released = HIGH
//   Pressed  = LOW
// =====================================================================

#include "mesh_common.h"

// ---------------------------------------------------------------------
// NODE ID
// ---------------------------------------------------------------------
#define MY_NODE_ID 1

// ---------------------------------------------------------------------
// BUTTON
// ---------------------------------------------------------------------
#define BUTTON_PIN 33

const char *BUTTON_MESSAGE = "SOS";

// ---------------------------------------------------------------------
// Generate message ID
// ---------------------------------------------------------------------
uint32_t generateMessageId() {

  uint32_t r = esp_random() & 0x00FFFFFFUL;

  return ((uint32_t)MY_NODE_ID << 24) | r;
}

// ---------------------------------------------------------------------
// Send a brand-new message
// ---------------------------------------------------------------------
void sendNewMessage(const char *text) {

  MeshPacket pkt;

  memset(&pkt, 0, sizeof(pkt));

  pkt.message_id = generateMessageId();

  pkt.origin_node_id = MY_NODE_ID;

  pkt.node_bitmask = (1UL << MY_NODE_ID);

  pkt.merkle_root = computeMerkleRoot(pkt.node_bitmask);

  strncpy(pkt.body, text, BODY_LEN - 1);
  pkt.body[BODY_LEN - 1] = '\0';

  Serial.println();
  Serial.println(F("================================"));
  Serial.println(F("BUTTON PRESSED"));
  Serial.println(F("CREATING SOS MESSAGE"));
  Serial.println(F("================================"));

  printPacketSummary(pkt);

  Serial.println(F("Transmitting..."));

  transmitPacket(pkt);

  Serial.println(F("Data sent."));
  Serial.println(F("SOS MESSAGE SENT."));
}

// ---------------------------------------------------------------------
// Handle incoming packet
// ---------------------------------------------------------------------
void handleIncomingPacket(const MeshPacket &pkt) {

  bool alreadyIncluded =
      pkt.node_bitmask & (1UL << MY_NODE_ID);

  if (alreadyIncluded) {

    Serial.println();
    Serial.println(F("Message received and ignored."));

    printPacketSummary(pkt);

    return;
  }

  MeshPacket relayed = pkt;

  relayed.node_bitmask |= (1UL << MY_NODE_ID);

  relayed.merkle_root =
      computeMerkleRoot(relayed.node_bitmask);

  Serial.println();
  Serial.println(F("Message received."));
  Serial.println(F("Preparing relay..."));

  Serial.print(F("old root=0x"));
  Serial.print(pkt.merkle_root, HEX);

  Serial.print(F(" -> new root=0x"));
  Serial.println(relayed.merkle_root, HEX);

  // Small random delay to reduce collisions
  delay(random(50, 250));

  transmitPacket(relayed);

  Serial.println(F("Message relayed."));

  printPacketSummary(relayed);
}

// ---------------------------------------------------------------------
// Check LoRa for a packet
// ---------------------------------------------------------------------
void checkLoRa() {

  int packetSize = LoRa.parsePacket();

  if (packetSize == 0) {
    return;
  }

  Serial.print(F("LoRa packet received. Size = "));
  Serial.println(packetSize);

  if (packetSize != sizeof(MeshPacket)) {

    Serial.println(F("Invalid packet size - dropping."));

    while (LoRa.available()) {
      LoRa.read();
    }

    return;
  }

  MeshPacket pkt;

  uint8_t *ptr = (uint8_t *)&pkt;

  for (int i = 0; i < sizeof(MeshPacket); i++) {

    if (LoRa.available()) {
      ptr[i] = (uint8_t)LoRa.read();
    }
  }

  handleIncomingPacket(pkt);
}

// ---------------------------------------------------------------------
// Check button
// ---------------------------------------------------------------------
void checkButton() {

  static bool buttonHandled = false;

  int state = digitalRead(BUTTON_PIN);

  // ---------------------------------------------------------------
  // Button pressed
  // ---------------------------------------------------------------
  if (state == LOW && !buttonHandled) {

    delay(30);

    // Confirm after debounce
    if (digitalRead(BUTTON_PIN) == LOW) {

      buttonHandled = true;

      Serial.println();
      Serial.println(F("Button pressed."));

      sendNewMessage(BUTTON_MESSAGE);
    }
  }

  // ---------------------------------------------------------------
  // Button released
  // ---------------------------------------------------------------
  if (state == HIGH && buttonHandled) {

    buttonHandled = false;

    Serial.println(F("Button released."));
  }
}

// ---------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------
void setup() {

  Serial.begin(115200);

  delay(1000);

  Serial.println();
  Serial.println(F("================================"));
  Serial.print(F("NORMAL NODE "));
  Serial.print(MY_NODE_ID);
  Serial.println(F(" BOOTING"));
  Serial.println(F("================================"));

  // Button
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.print(F("GPIO 33 initial state = "));
  Serial.println(digitalRead(BUTTON_PIN));

  // Random seed
  randomSeed(esp_random());

  // LoRa
  Serial.println(F("Initializing LoRa..."));

  initLoRa();

  // IMPORTANT:
  // Do NOT use LoRa.onReceive().
  // We poll with LoRa.parsePacket() in loop().

  LoRa.receive();

  Serial.println(F("LoRa ready."));
  Serial.println(F("Button ready."));
  Serial.println(F("Press button to send SOS."));
  Serial.println();
}

// ---------------------------------------------------------------------
// MAIN LOOP
// ---------------------------------------------------------------------
void loop() {

  // Button gets checked continuously
  checkButton();

  // Check incoming LoRa packet
  checkLoRa();

  delay(5);
}