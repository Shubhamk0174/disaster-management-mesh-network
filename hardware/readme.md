# Hardware (ESP32)

This directory contains the C++ Arduino source code that is flashed onto the ESP32 microcontrollers.

## Purpose
The hardware forms the physical mesh network. These devices are designed to operate independently on battery power, creating an ad-hoc Wi-Fi mesh to securely route distress signals to the Rescue Node.

## Structure
- `/mesh` / `/encrypted_mesh`: These subdirectories contain the primary `.ino` sketches for the nodes.
  - `normal_node.ino`: The code for the relay nodes. It verifies message authenticity and forwards packets without being able to decrypt the payload.
  - `rescue_node.ino`: The code for the destination node. It performs X25519 key agreement, derives the ChaCha20-Poly1305 encryption key, and decrypts the sensitive payload.
- `/test`: Contains sketches used for preliminary testing of connections and basic mesh capabilities before applying the encryption layer.
- `connections.md`: Provides documentation on the physical wiring, pinouts, and sensor connections for the ESP32 boards.

## Usage
Before compiling these sketches in the Arduino IDE, you must run the Python key generation script and ensure the `_config.h` files are present in the `/generated_configs` directory. Each node is flashed exactly once.
