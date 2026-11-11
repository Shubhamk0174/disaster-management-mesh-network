#define GPS_RX 16   // ESP32 pin connected to GPS TX
#define GPS_TX 17   // ESP32 pin connected to GPS RX

HardwareSerial GPS(2);

void setup() {
  Serial.begin(115200);
  GPS.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  Serial.println("GPS raw test started...");
}

void loop() {
  while (GPS.available()) {
    Serial.write(GPS.read());
  }
}