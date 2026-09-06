#include <SPI.h>
#include <LoRa.h>

#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_SS    27
#define LORA_RST   14
#define LORA_DIO0  26

void setup() {
  Serial.begin(115200);
  delay(1000);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa initialization FAILED!");
    while (true);
  }

  Serial.println("LoRa receiver ready!");

  LoRa.receive();
}

void loop() {

  int packetSize = LoRa.parsePacket();

  if (packetSize) {

    Serial.print("Received: ");

    while (LoRa.available()) {
      Serial.print((char)LoRa.read());
    }

    Serial.print(" | RSSI: ");
    Serial.println(LoRa.packetRssi());

    LoRa.receive();
  }
}