# Hardware Connections

## ESP32 → Ra-02 LoRa

| Ra-02 Pin | ESP32 Pin |
|---|---|
| 3.3V | 3V3 |
| GND | GND |
| SCK | G18 (GPIO18) |
| MISO | G19 (GPIO19) |
| MOSI | G23 (GPIO23) |
| NSS | G27 (GPIO27) |
| RST | G14 (GPIO14) |
| DIO0 | G26 (GPIO26) |
| DIO1 | Not connected |
| DIO2 | Not connected |

## SOS Button → ESP32

| Button | ESP32 |
|---|---|
| One side | G33 (GPIO33) |
| Opposite side | GND |

For the 4-pin button, use **one pin from each opposite side** of the button. Do not use two pins from the same side.

## Important

- **Ra-02 3.3V → ESP32 3V3 only.**
- **Do NOT connect Ra-02 3.3V to 5V or VIN.**
- ESP32 GND, Ra-02 GND, and button GND must share a **common ground**.
- Connect the correct **LoRa antenna before transmitting**.
- Keep the wiring consistent with the GPIO definitions in the code.
- Ensure there are no loose wires or short circuits between adjacent pins.

## GPIO Configuration

```cpp
#define LORA_SCK   18
#define LORA_MISO  19
#define LORA_MOSI  23
#define LORA_SS    27
#define LORA_RST   14
#define LORA_DIO0  26

#define SOS_BUTTON 33
```
