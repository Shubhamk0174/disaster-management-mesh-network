#include <SPI.h>
#include <LoRa.h>

// =========================
// LoRa Pin Configuration
// =========================
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_SS    27
#define LORA_RST   14
#define LORA_DIO0  26

// =========================
// SOS Button
// =========================
#define SOS_BUTTON 33

// =========================
// LoRa Frequency
// =========================
#define LORA_FREQUENCY 433E6


void setup() {

  Serial.begin(115200);
  delay(1000);

  // SOS button
  // Released = HIGH
  // Pressed  = LOW
  pinMode(SOS_BUTTON, INPUT_PULLUP);

  // Start SPI
  SPI.begin(
    LORA_SCK,
    LORA_MISO,
    LORA_MOSI,
    LORA_SS
  );

  // Configure LoRa pins
  LoRa.setPins(
    LORA_SS,
    LORA_RST,
    LORA_DIO0
  );

  // Start LoRa
  if (!LoRa.begin(LORA_FREQUENCY)) {

    Serial.println("LoRa initialization failed!");

    while (true) {
      delay(1000);
    }
  }

  // LoRa configuration
  LoRa.setTxPower(17);
  LoRa.setSpreadingFactor(7);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);

  Serial.println();
  Serial.println("================================");
  Serial.println("      LoRa SOS NODE READY");
  Serial.println("================================");
  Serial.println("Listening for messages...");
  Serial.println("Press the button to send SOS.");
  Serial.println();

  // Start in receive mode
  LoRa.receive();
}


void loop() {

  // ==================================================
  // 1. CHECK SOS BUTTON
  // ==================================================

  if (digitalRead(SOS_BUTTON) == LOW) {

    Serial.println();
    Serial.println("SOS BUTTON PRESSED!");
    Serial.println("Sending SOS message...");

    // Send SOS message
    LoRa.beginPacket();
    LoRa.print("SOS: EMERGENCY!");
    LoRa.endPacket();

    Serial.println("SOS MESSAGE SENT!");
    Serial.println();

    // Return to receive mode
    LoRa.receive();

    // Debounce / prevent repeated messages
    delay(1000);
  }


  // ==================================================
  // 2. CHECK FOR INCOMING LORA MESSAGE
  // ==================================================

  int packetSize = LoRa.parsePacket();

  if (packetSize) {

    String receivedMessage = "";

    while (LoRa.available()) {
      receivedMessage += (char)LoRa.read();
    }

    Serial.println();
    Serial.println("========== MESSAGE RECEIVED ==========");

    Serial.print("Message: ");
    Serial.println(receivedMessage);

    Serial.print("RSSI: ");
    Serial.print(LoRa.packetRssi());
    Serial.println(" dBm");

    Serial.print("SNR: ");
    Serial.print(LoRa.packetSnr());
    Serial.println(" dB");

    Serial.println("======================================");
    Serial.println();

    // Continue listening
    LoRa.receive();
  }
}