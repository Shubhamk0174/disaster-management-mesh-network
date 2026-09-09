# Disaster Management Mesh Network

## Table of Contents
- [Overview](#overview)
- [How We Solve the Problem](#how-we-solve-the-problem)
- [Deep Dive: Cryptography & Routing](#deep-dive-cryptography--routing)
  - [1. Node Identity & Authentication (Ed25519)](#1-node-identity--authentication-ed25519)
  - [2. Key Agreement (X25519) & Key Derivation (HKDF)](#2-key-agreement-x25519--key-derivation-hkdf)
  - [3. Encrypted Payload (ChaCha20-Poly1305)](#3-encrypted-payload-chacha20-poly1305)
  - [4. Mesh Routing & Loop Prevention (Merkle-Set Hashing)](#4-mesh-routing--loop-prevention-merkle-set-hashing)
- [Project Architecture](#project-architecture)
- [Repository Structure](#repository-structure)
- [Contributing & How to Start](#contributing--how-to-start)

---

## Overview
This project is an ESP32-based emergency rescue communication system operating over a wireless mesh network. It is designed to provide robust and secure communication in disaster scenarios where traditional infrastructure (like cell towers or internet) has failed. 

The system relies on independent ESP32 devices running off power banks, forming a self-sufficient network that can relay critical information to a central rescue node. It features a complete ecosystem with hardware mesh networking, a Node.js/PostgreSQL backend for data persistence, and React/Next.js frontends for monitoring and dashboarding.

---

## How We Solve the Problem
During disasters, communication is the first critical service to fail. First responders and victims need a reliable way to communicate location and status securely.

Our solution deploys a wireless mesh network of **Normal Nodes** (relays) and a single **Rescue Node**. 
- **Confidentiality:** The most sensitive data—*location* and *timestamp*—is encrypted. Normal nodes can only relay the encrypted packets and cannot read the contents.
- **Security & Integrity:** Only the Rescue Node, equipped with the proper cryptographic keys, can decrypt the payload to discover the sender's location and time of distress. 
- **Decentralization:** The nodes do not require laptops, serial provisioning at runtime, or internet access. The cryptographic keys are generated beforehand using Python provisioning scripts and permanently flashed onto the devices. 

---

## Deep Dive: Cryptography & Routing

To guarantee absolute confidentiality and prevent malicious actors from disrupting the network, we implement a multi-layered cryptographic approach.

### 1. Node Identity & Authentication (Ed25519)
Every ESP32 in the network has a unique cryptographic identity. We use the **Ed25519** elliptic curve algorithm for digital signatures. 

When a node sends or forwards a packet, it signs the unencrypted header. Other nodes verify this signature against a hardcoded "Trusted Registry" of public keys. If the signature is invalid or the node is not in the registry, the packet is instantly dropped.

**Key Generation Snippet (`keys/keys.py`):**
```python
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519

def generate_identity() -> dict:
    """Generate one Ed25519 keypair + one X25519 keypair."""
    # 1. Ed25519 for Authentication / Signatures
    ed_priv = ed25519.Ed25519PrivateKey.generate()
    ed_pub = ed_priv.public_key()

    # 2. X25519 for Key Agreement (Diffie-Hellman)
    x_priv = x25519.X25519PrivateKey.generate()
    x_pub = x_priv.public_key()
    
    return {
        "ed25519_private": ed_priv.private_bytes(...),
        "ed25519_public": ed_pub.public_bytes(...),
        "x25519_private": x_priv.private_bytes(...),
        "x25519_public": x_pub.public_bytes(...),
    }
```

### 2. Key Agreement (X25519) & Key Derivation (HKDF)
Normal nodes cannot decrypt the payload; only the Rescue Node can. To achieve this without transmitting passwords over the air, the sender and the Rescue Node use **X25519** (Elliptic-Curve Diffie-Hellman).

The sender combines its *Private X25519 Key* with the Rescue Node's *Public X25519 Key* to create a shared secret. The Rescue Node does the inverse. They then run this shared secret through **HKDF-SHA-256** to derive a symmetric encryption key `K`.

### 3. Encrypted Payload (ChaCha20-Poly1305)
Once the symmetric key `K` is derived, the sensitive data (`location` + `timestamp`) is encrypted using **ChaCha20-Poly1305**. 
This cipher provides both confidentiality and authentication. If a malicious relay node tries to flip bits in the encrypted payload, the Poly1305 authentication tag will fail to verify upon reaching the Rescue Node, and the packet will be dropped.

### 4. Mesh Routing & Loop Prevention (Merkle-Set Hashing)
In a mesh network, nodes broadcast packets to all nearby nodes. Without a way to track the message's path, a packet could bounce back and forth between two nodes forever (an infinite routing loop).

Because ESP32s have extremely limited RAM, they cannot store an infinite history of message IDs. Instead, we use a **Merkle-set accumulator**. As a message hops from node to node, the node appends its ID to the running Merkle root via a SHA-256 hash operation. 

**Root Calculation Snippet (`markle_path_test/merkle.py`):**
```python
import hashlib

def create_next_root(current_root: int, node_id: int) -> int:
    """
    Applies the receiving node's ID to the running Merkle Root.
    """
    data = bytearray()
    
    # 1. Append the current root as a little-endian uint32
    data += current_root.to_bytes(4, byteorder="little")
    
    # 2. Append the node ID (1 byte)
    data += bytes([node_id])
    
    # 3. Hash the combined data
    digest = hashlib.sha256(data).digest()

    # 4. Take the first 4 bytes as the new root
    result = int.from_bytes(digest[:4], byteorder="little")
    return result
```
Before relaying a message, a node checks if its ID has already been applied to the Merkle root. If it has, the node knows it already processed this message, and drops it.

---

## Project Architecture
The network consists of three distinct layers:
1. **Hardware Layer (ESP32):** Runs C++ Arduino sketches, performing cryptographic operations and handling the raw Wi-Fi radio mesh.
2. **Backend Services:** A Node.js/Express server using a PostgreSQL database (managed via Prisma) to ingest data from the Rescue Node and serve it securely.
3. **Frontend Dashboard:** A React/Next.js interface providing real-time geographical visualizations of incoming distress signals.

---

## Repository Structure
For an exhaustive breakdown of the folder structure, please refer to the [FILESTRUCTURE.md](./FILESTRUCTURE.md).

- **`actualplan/`**: Core architectural specifications.
- **`hardware/`**: C++ Arduino sketches for Normal and Rescue ESP32 nodes.
- **`backend/`**: The Node.js Express server.
- **`frontend/`**: The Next.js dashboard application.
- **`keys/`**: Python key generation and provisioning scripts.
- **`markle_path_test/`**: Routing and accumulator testbed.
- **`generated_configs/`**: The hardcoded, secure C++ headers outputted by `keys.py`.

---

## Contributing & How to Start

We welcome contributions to all parts of the stack: hardware, cryptography, backend, and frontend! If you want to contribute, here is the best way to get started:

### Step 1: Understand the Architecture
Read the core architecture documentation located in [`actualplan/final_esp32_rescue_mesh_full_architecture.md`](./actualplan/final_esp32_rescue_mesh_full_architecture.md). You must understand the difference between a Normal Node and a Rescue Node before touching the codebase.

### Step 2: Setup the Keys
You cannot run the hardware code without generating the cryptographic keys first.
1. Ensure you have Python 3 installed.
2. Run `pip install cryptography`.
3. Navigate to the `keys/` directory and execute `python keys.py`. 
4. Verify that C++ header files (`node_a_config.h`, etc.) were created in the `generated_configs/` folder.

### Step 3: Pick an Area to Contribute To
- **Hardware / C++:** Open the `hardware/` directory. You will need the Arduino IDE with the ESP32 board manager installed. Start by looking at `hardware/mesh/normal_node.ino`.
- **Backend (Node.js):** Navigate to `backend/`. Copy `.env.example` to `.env` and set up your PostgreSQL connection string. Run `npm install`, then `npx prisma db push`, and finally `npm run dev`.
- **Frontend (React/Next.js):** Navigate to `frontend/`. Run `npm install` and `npm run dev`. Familiarize yourself with the Tailwind design and how it fetches data from the backend API.

### Step 4: Making Changes
- If modifying the cryptography or routing logic, verify your math using the Python scripts in `keys/` or `markle_path_test/` before porting to C++.
- Ensure all sensitive data (location/timestamp) remains strictly inside the ChaCha20-Poly1305 encryption boundary!

*Happy Hacking!*
