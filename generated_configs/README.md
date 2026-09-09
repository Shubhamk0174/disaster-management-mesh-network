# Generated Configurations

This directory contains the output of the Python provisioning process.

## Purpose
The mesh network is designed to be deployed completely offline, without needing a laptop or Serial terminal to exchange cryptographic keys. To achieve this, the keys are pre-generated.

When the Python scripts in the `/keys` directory are run, they output C++ header files into this folder.

## Files
- `node_a_config.h`, `node_b_config.h`: Configurations for the Normal Nodes (relays).
- `rescue_config.h`: Configuration for the Rescue Node.

## Contents
Each file contains that specific device's:
- **Private Keys:** Ed25519 and X25519 private keys.
- **Public Keys:** Its own public keys, plus the public keys of the other trusted nodes in the network.
- **Node Role:** Designating whether it acts as a normal relay or the rescue endpoint.

These files are `#include`'d directly into the Arduino sketches before compiling and flashing the ESP32 hardware.
