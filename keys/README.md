# Key Provisioning System

This folder contains the Python scripts responsible for the offline cryptographic provisioning of the mesh network.

## Purpose
To maintain absolute security and eliminate the need for an active laptop or Serial terminal during deployment, all cryptographic identities are created before the devices are ever flashed.

## How it Works
The primary script is `keys.py`. When executed, it performs the following steps:
1. Generates Ed25519 private/public key pairs for authentication.
2. Generates X25519 private/public key pairs for key agreement.
3. Compiles a "Trusted Registry" mapping node identities to their public keys.
4. Generates C++ header files (`.h`) containing these hardcoded keys.

These generated header files are saved to the `../generated_configs` directory, ready to be compiled into the Arduino sketches.

## Security Rule
This script ensures that each ESP32 device only receives its *own* private keys and the public keys of the other nodes. No node has access to another node's private keys.
