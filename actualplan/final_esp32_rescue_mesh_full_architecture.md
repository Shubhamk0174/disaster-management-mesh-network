# ESP32 Rescue Mesh Communication System
## Final Project Architecture, Cryptography, Provisioning, Packet Format, and Arduino/Python Rules

> **Final prototype decision:** Cryptographic keys are generated ONCE by Python and then intentionally hardcoded into each device's generated Arduino configuration. Each ESP32 is flashed ONCE. After deployment, the nodes run from power banks with no laptop or Serial provisioning required.

---

# 1. Project Overview

This project is an ESP32-based emergency rescue communication system using a wireless mesh network.

There are two types of ESP32 devices:

- **Normal Nodes** — relay messages through the mesh.
- **Rescue Node** — the final destination that decrypts the sensitive information.

The sensitive information in this project is:

```text
location
timestamp
```

Normal nodes should be able to forward a packet without learning the location or timestamp.

Only the Rescue Node should be able to decrypt and reveal:

```text
location + timestamp
```

The project uses:

```text
Ed25519              → authentication/signatures
X25519               → key agreement
HKDF-SHA-256         → derives encryption key K
ChaCha20-Poly1305    → encryption + authentication
Merkle-set           → tracks nodes that have received a message
Sequence/replay data → replay protection
Python provisioning  → one-time key generation
Hardcoded config     → offline deployment
```

---

# 2. Two Arduino Programs

There are two Arduino IDE sketches.

```text
normal_node.ino
rescue_node.ino
```

## 2.1 normal_node.ino

Installed on every normal relay ESP32.

Responsibilities:

- Load its own provisioned keys.
- Know the trusted public keys.
- Receive packets.
- Verify authentication.
- Perform replay checks.
- Check the Merkle-set.
- Add itself to the Merkle-set if necessary.
- Relay the packet.
- Never decrypt the sensitive body.

## 2.2 rescue_node.ino

Installed on the Rescue ESP32.

Responsibilities:

- Load Rescue's own provisioned keys.
- Verify trusted sender information.
- Verify authentication.
- Perform replay checks.
- Perform X25519 key agreement.
- Derive `K` using HKDF-SHA-256.
- Decrypt the sensitive body using ChaCha20-Poly1305.
- Reveal location and timestamp.

---

# 3. Key Architecture

Every ESP32 has TWO cryptographic key pairs.

## 3.1 Ed25519 key pair

Used for:

```text
Digital signatures
Authentication
Node identity
```

Each node has:

```text
Ed25519 private key
Ed25519 public key
```

The private key belongs only to that node.

The public key is shared with trusted nodes.

---

## 3.2 X25519 key pair

Used for:

```text
Key agreement
```

Each node has:

```text
X25519 private key
X25519 public key
```

The private key belongs only to that node.

The public key is distributed to trusted nodes.

---

# 4. FINAL KEY DECISION: KEYS ARE HARDCODED

For this college prototype, we intentionally use compile-time provisioning.

The process is:

```text
setup_keys.py
      ↓
Generate all cryptographic keys
      ↓
Generate device-specific configuration
      ↓
Hardcode generated keys into that configuration
      ↓
Compile Arduino sketch
      ↓
Flash ESP32 once
```

There is no runtime key-generation requirement.

There is no second flashing requirement.

There is no laptop requirement after deployment.

---

# 5. Why Python Generates the Keys

The Python program is the provisioning tool.

It generates the identities before the ESP32s are deployed.

For example:

```text
Node A
  Ed25519 private/public
  X25519 private/public

Node B
  Ed25519 private/public
  X25519 private/public

Node C
  Ed25519 private/public
  X25519 private/public

Rescue
  Ed25519 private/public
  X25519 private/public
```

The Python program also creates the trusted public-key registry.

---

# 6. Important: Each Node Gets Only Its Own Private Keys

This is critical.

## Node A contains:

```text
A Ed25519 private key      YES
A X25519 private key       YES

A Ed25519 public key       YES
A X25519 public key        YES

B Ed25519 public key       YES
B X25519 public key        YES

C Ed25519 public key       YES
C X25519 public key        YES

Rescue Ed25519 public key  YES
Rescue X25519 public key   YES
```

But:

```text
B private keys              NO
C private keys              NO
Rescue private keys         NO
```

Node B follows the same rule:

```text
B's own private keys
+
public keys of trusted nodes
```

Node C:

```text
C's own private keys
+
public keys of trusted nodes
```

Rescue:

```text
Rescue's own private keys
+
public keys of trusted nodes
```

---

# 7. No Pairwise Manual Key Copying

We do NOT do this:

```text
A private key → B
B private key → A

A public key → B
B public key → A

A public key → C
C public key → A

...
```

Instead, Python creates the complete trusted public-key information.

Each device gets:

```text
its own private keys
+
the public keys it needs to verify trusted nodes
```

Therefore Node A already knows B and C's public keys when it is deployed.

Node A does not need to discover them later.

---

# 8. No Runtime Laptop

The nodes are intended to run from power banks.

Therefore:

```text
Laptop
   ↓
used only during setup/development

ESP32 nodes
   ↓
operate independently
   ↓
power banks
```

The laptop is NOT required for:

- Key exchange
- Trust provisioning
- Normal communication
- Message forwarding
- Decryption

---

# 9. Complete Provisioning Process

The provisioning process happens before deployment.

## Step 1 — Run Python

Run:

```text
setup_keys.py
```

It generates every node's cryptographic identity.

---

## Step 2 — Generate device configurations

Python generates:

```text
node_A_config.h
node_B_config.h
node_C_config.h
rescue_config.h
```

Each file contains:

```text
that device's private keys
that device's public keys
trusted public keys
node ID
role
Rescue public key
other protocol configuration
```

---

## Step 3 — Compile Node A

Compile:

```text
normal_node.ino
+
node_A_config.h
```

Flash Node A.

---

## Step 4 — Compile Node B

Compile:

```text
normal_node.ino
+
node_B_config.h
```

Flash Node B.

---

## Step 5 — Compile Node C

Compile:

```text
normal_node.ino
+
node_C_config.h
```

Flash Node C.

---

## Step 6 — Compile Rescue

Compile:

```text
rescue_node.ino
+
rescue_config.h
```

Flash Rescue.

---

# 10. Each ESP32 Is Flashed Only Once

The complete workflow is:

```text
Python generates keys
       ↓
Python generates configs
       ↓
Flash Node A ONCE
       ↓
Flash Node B ONCE
       ↓
Flash Node C ONCE
       ↓
Flash Rescue ONCE
       ↓
Disconnect laptop
       ↓
Use power banks
       ↓
Mesh operates independently
```

There is NO:

```text
second flash
second key generation
Serial provisioning
runtime laptop
manual public-key copying
```

---

# 11. What Is Manually Copy/Pasted?

With the Python-generated configuration system:

```text
Cryptographic key copy/paste: NONE
```

You do not manually type:

```text
A public key
B public key
C public key
Rescue public key
```

Python generates and inserts them into the appropriate configuration.

Your manual work is:

```text
Run Python setup
Compile the correct device configuration
Flash each ESP32 once
Deploy the ESP32s
```

---

# 12. What Is Hardcoded?

For this prototype, the generated cryptographic values are intentionally hardcoded into the device-specific firmware/configuration.

### Hardcoded on Node A

```text
A Ed25519 private key
A Ed25519 public key
A X25519 private key
A X25519 public key

B Ed25519 public key
B X25519 public key

C Ed25519 public key
C X25519 public key

Rescue Ed25519 public key
Rescue X25519 public key
```

### Hardcoded on Node B

```text
B's Ed25519 private/public
B's X25519 private/public

A/C/Rescue public keys
```

### Hardcoded on Node C

```text
C's Ed25519 private/public
C's X25519 private/public

A/B/Rescue public keys
```

### Hardcoded on Rescue

```text
Rescue's Ed25519 private/public
Rescue's X25519 private/public

trusted public keys
```

---

# 13. What Is NOT Hardcoded?

These values are created during message processing:

```text
X25519 shared secret
K
```

The shared secret is derived using X25519.

Then `K` is derived using HKDF-SHA-256.

Therefore:

```text
X25519 shared secret
       ↓
     HKDF
       ↓
       K
```

`K` is not placed into the packet.

---

# 14. K — The Actual Encryption Key

`K` is the symmetric encryption key used by:

```text
ChaCha20-Poly1305
```

The sender obtains `K` by:

```text
Sender X25519 private key
          +
Rescue X25519 public key
          ↓
    X25519 shared secret
          ↓
     HKDF-SHA-256
          ↓
          K
```

Rescue independently obtains the same `K`:

```text
Rescue X25519 private key
          +
Sender X25519 public key
          ↓
    X25519 shared secret
          ↓
     HKDF-SHA-256
          ↓
          K
```

The two sides therefore get the same key without transmitting `K`.

---

# 15. Why Normal Nodes Cannot Decrypt

A normal node does not possess:

```text
Rescue X25519 private key
```

Therefore it cannot perform:

```text
X25519(Rescue private, Sender public)
```

and cannot derive the sender-to-Rescue shared secret.

Therefore it cannot derive `K`.

Therefore it cannot decrypt:

```text
location
timestamp
```

This is the core confidentiality property.

---

# 16. Sensitive Body

The sensitive body contains:

```text
location
timestamp
```

They are encrypted together.

Conceptually:

```text
plaintext = location || timestamp
```

Then:

```text
ciphertext =
    ChaCha20-Poly1305_Encrypt(
        K,
        nonce,
        plaintext,
        authenticated_data
    )
```

The normal nodes see only ciphertext.

Rescue decrypts and gets:

```text
location
timestamp
```

---

# 17. ChaCha20-Poly1305

ChaCha20-Poly1305 provides:

```text
Confidentiality
+
Integrity
+
Authentication of ciphertext
```

The packet contains:

```text
nonce
ciphertext
authentication tag
```

The tag allows Rescue to detect:

```text
modified ciphertext
wrong key
wrong authenticated metadata
corrupted packet
```

If tag verification fails:

```text
DROP PACKET
```

Do not decrypt and display unverified data.

---

# 18. Nonce Rule

ChaCha20-Poly1305 must NEVER reuse the same nonce with the same key.

The implementation must guarantee nonce uniqueness.

A suitable construction can use a protocol-defined unique message/sequence value, but the exact nonce construction must be fixed and implemented carefully.

Do not simply use a random nonce without considering collision probability and key reuse.

Do not reuse:

```text
same K + same nonce
```

---

# 19. Ed25519 Authentication

Ed25519 is separate from encryption.

It answers:

> Who created/authenticated the message?

The sender signs the immutable/origin-authenticated portion of the message.

A receiving node uses the trusted registry to find the expected public key.

Then:

```text
signature verification
       ↓
    VALID?
    /    \
  YES     NO
   |       |
continue   DROP
```

---

# 20. Do Not Trust Public Keys Learned From the Mesh

A node must NOT say:

```text
"I received a packet claiming to be Node B,
so I will trust the public key included in it."
```

Instead:

```text
claimed node_id
      ↓
lookup in trusted registry
      ↓
expected Ed25519 public key
      ↓
verify signature
```

If the node is not in the trusted registry:

```text
UNKNOWN NODE
     ↓
DROP
```

If the key does not match the trusted identity:

```text
KEY MISMATCH
     ↓
DROP
```

This is the project's trust mechanism.

---

# 21. Trusted Registry

The trusted registry is generated by Python.

Conceptually:

```text
NODE_A
    role = NORMAL
    Ed25519 public key
    X25519 public key

NODE_B
    role = NORMAL
    Ed25519 public key
    X25519 public key

NODE_C
    role = NORMAL
    Ed25519 public key
    X25519 public key

RESCUE
    role = RESCUE
    Ed25519 public key
    X25519 public key
```

Every node receives the public-key information it needs.

No runtime registry download is necessary.

---

# 22. Packet Structure

A conceptual packet is:

```text
+------------------------------------------------+
| HEADER                                         |
+------------------------------------------------+
| protocol_version                               |
| origin_node_id                                 |
| sender_node_id                                 |
| sequence_number                                |
| message_id / Merkle-set root                   |
| sender Ed25519 key ID                          |
| sender X25519 key ID                           |
| Rescue key ID / version                        |
| routing metadata                               |
+------------------------------------------------+
| AUTHENTICATION                                 |
+------------------------------------------------+
| Ed25519 signature                              |
+------------------------------------------------+
| ENCRYPTED BODY                                 |
+------------------------------------------------+
| nonce                                          |
| ciphertext                                     |
| authentication tag                             |
+------------------------------------------------+
```

Private keys are NEVER in packets.

---

# 23. Origin Node vs Relay Node

The packet contains information about the origin and the current relay.

For example:

```text
origin_node_id = NODE_A
sender_node_id = NODE_C
```

This means:

```text
NODE_A originally created/authenticated the message.

NODE_C is the node currently forwarding it.
```

The protocol must clearly distinguish immutable origin data from mutable routing data.

---

# 24. Important Signature Rule

The Merkle root changes as the packet travels.

Therefore the original Ed25519 signature must NOT be defined as a signature over the mutable Merkle root.

Conceptually separate:

```text
IMMUTABLE ORIGIN DATA
+
MUTABLE ROUTING DATA
```

The Ed25519 origin signature authenticates the immutable portion.

The Merkle-set root is routing state.

---

# 25. Replay Protection

Packets should contain:

```text
origin_node_id
sequence_number
```

or another protocol-defined unique message/sequence identifier.

Nodes use this information to reject replayed messages according to the project's replay policy.

An attacker should not be able to capture a valid old packet and continuously inject it as if it were new.

Replay protection and Merkle-set processing are separate mechanisms.

---

# 26. Merkle-Set Based message_id

The project's `message_id` is intended to represent:

> The set of nodes that have already received the message.

For example:

```text
{A, B, C}
```

is represented by a Merkle-set root.

This is NOT a hash chain.

Do NOT implement:

```text
new_root = SHA256(old_root || node_id)
```

That is a hash chain and does not provide the required set semantics.

---

# 27. Required Merkle-Set Behavior

The Merkle-set implementation must support:

```text
Add node
Check whether node exists
Merge information from different paths
Produce a root representing the set
```

Example:

```text
Message reaches A
Set = {A}

Message reaches B
Set = {A, B}

Message reaches C
Set = {A, B, C}
```

If B receives the message again:

```text
B already exists
     ↓
do not add B again
     ↓
do not relay
```

If D receives it:

```text
D does not exist
     ↓
add D
     ↓
new set = {A, B, C, D}
     ↓
update root
     ↓
relay
```

---

# 28. Branching Mesh

The network can branch.

Example:

```text
             B
            /
A ---------- 
            \
             C
```

Both B and C may receive the same message.

The set should eventually represent:

```text
{A, B, C}
```

The implementation therefore needs a real set/merge mechanism.

A linear hash chain is not sufficient.

---

# 29. Normal Node Receive Flow

When a normal node receives a packet:

```text
Receive packet
      ↓
Validate packet structure
      ↓
Find trusted origin/sender identity
      ↓
Verify Ed25519 authentication
      ↓
Replay check
      ↓
Process Merkle-set
      ↓
Is my node_id already represented?
       / \
     YES  NO
      |    |
     DROP  Add node
           ↓
       Update root
           ↓
         Relay
```

The normal node does NOT decrypt the body.

---

# 30. Rescue Receive Flow

When Rescue receives a packet:

```text
Receive packet
      ↓
Validate packet structure
      ↓
Verify trusted identity
      ↓
Verify Ed25519 signature
      ↓
Replay check
      ↓
Obtain sender X25519 public key
      ↓
X25519(
    Rescue private key,
    sender X25519 public key
)
      ↓
Shared secret
      ↓
HKDF-SHA-256
      ↓
K
      ↓
ChaCha20-Poly1305
      ↓
Verify authentication tag
      ↓
Decrypt
      ↓
Location + timestamp
```

---

# 31. Complete End-to-End Example

Suppose:

```text
Node A = source
Node B = relay
Node C = relay
Rescue = destination
```

Node A prepares:

```text
location = emergency location
timestamp = event timestamp
```

Then:

```text
A X25519 private
+
Rescue X25519 public
        ↓
shared secret
        ↓
HKDF
        ↓
K
```

A encrypts:

```text
location + timestamp
```

using:

```text
ChaCha20-Poly1305
```

A signs the immutable origin-authenticated information with:

```text
A Ed25519 private key
```

The packet enters the mesh.

---

# 32. Node B

Node B receives the packet.

It:

```text
verifies authentication
checks replay protection
checks Merkle-set
```

Suppose B is not represented.

It adds itself:

```text
{A}
   ↓
{A, B}
```

and forwards the packet.

B does NOT decrypt:

```text
location
timestamp
```

---

# 33. Node C

C receives the packet.

It verifies and checks the Merkle-set.

If C is not present:

```text
{A, B}
    ↓
{A, B, C}
```

C updates the Merkle-set state and relays.

Again, C never decrypts the sensitive body.

---

# 34. Rescue

Rescue receives the packet.

Rescue has:

```text
Rescue X25519 private key
```

and the trusted sender X25519 public key.

It computes:

```text
X25519(Rescue private, Sender public)
```

which produces the same shared secret used by the sender.

Then:

```text
shared secret
     ↓
HKDF-SHA-256
     ↓
K
```

Rescue uses `K` with the packet's nonce and authenticated metadata to decrypt.

Result:

```text
location
timestamp
```

---

# 35. Complete System Diagram

```text
                    SETUP ONLY
                        |
                        v
                  setup_keys.py
                        |
            +-----------+-----------+
            |           |           |
            v           v           v
        Node A       Node B       Node C
          keys         keys         keys
            \           |           /
             \          |          /
              +---------+---------+
                        |
                     Rescue
                      keys
                        |
                        v
             Trusted public registry
                        |
                        v
             Device-specific configs
                        |
          +-------------+-------------+
          |             |             |
          v             v             v
       Node A        Node B        Node C
     normal_node   normal_node   normal_node
          |             |             |
          +-------------+-------------+
                        |
                      Rescue
                 rescue_node.ino
                        |
                        v
                 FLASH EACH ONCE
                        |
                        v
                 DISCONNECT PC
                        |
                        v
                  POWER BANKS
                        |
                        v
                  MESH OPERATION
```

---

# 36. Runtime Message Diagram

```text
Node A
  |
  | location + timestamp
  v
X25519 with Rescue public key
  |
  v
shared secret
  |
  v
HKDF
  |
  v
K
  |
  v
ChaCha20-Poly1305
  |
  v
encrypted body
  |
  +---- Ed25519 signature
  |
  +---- packet header
  |
  +---- Merkle-set root
  |
  v
Node B
  |
  | verify
  | replay check
  | Merkle-set check
  | add B
  | relay
  |
  v
Node C
  |
  | verify
  | replay check
  | Merkle-set check
  | add C
  | relay
  |
  v
Rescue
  |
  | verify
  | replay check
  | X25519
  | HKDF
  | K
  | decrypt
  |
  v
location + timestamp
```

---

# 37. Python Setup Program

The provisioning program should be responsible for generating keys and generating device-specific hardcoded configurations.

Recommended Python dependency:

```text
cryptography
```

Install:

```bash
pip install cryptography
```

A provisioning program can follow this structure:

```python
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives import serialization
from pathlib import Path
import json


NODES = {
    "NODE_A": "NORMAL",
    "NODE_B": "NORMAL",
    "NODE_C": "NORMAL",
    "RESCUE": "RESCUE",
}


def raw_private_key(private_key):
    return private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )


def raw_public_key(public_key):
    return public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def generate_identity():
    ed_private = ed25519.Ed25519PrivateKey.generate()
    x_private = x25519.X25519PrivateKey.generate()

    return {
        "ed_private": raw_private_key(ed_private).hex(),
        "ed_public": raw_public_key(ed_private.public_key()).hex(),
        "x_private": raw_private_key(x_private).hex(),
        "x_public": raw_public_key(x_private.public_key()).hex(),
    }


def main():
    output = Path("generated")
    output.mkdir(exist_ok=True)

    identities = {}

    for node_id, role in NODES.items():
        identities[node_id] = {
            "role": role,
            **generate_identity(),
        }

    registry = {}

    for node_id, data in identities.items():
        registry[node_id] = {
            "role": data["role"],
            "ed_public": data["ed_public"],
            "x_public": data["x_public"],
        }

    (output / "trusted_registry.json").write_text(
        json.dumps(registry, indent=2),
        encoding="utf-8",
    )

    for node_id, data in identities.items():

        lines = [
            "#pragma once",
            "",
            f'#define NODE_ID "{node_id}"',
            f'#define NODE_ROLE "{data["role"]}"',
            "",
            f'const char OWN_ED25519_PRIVATE[] = "{data["ed_private"]}";',
            f'const char OWN_ED25519_PUBLIC[]  = "{data["ed_public"]}";',
            f'const char OWN_X25519_PRIVATE[]  = "{data["x_private"]}";',
            f'const char OWN_X25519_PUBLIC[]   = "{data["x_public"]}";',
            "",
            "// Trusted public keys",
            "",
        ]

        for trusted_id, trusted in registry.items():

            lines.append(
                f'// {trusted_id} ({trusted["role"]})'
            )

            lines.append(
                f'const char TRUSTED_{trusted_id}_ED25519[] = '
                f'"{trusted["ed_public"]}";'
            )

            lines.append(
                f'const char TRUSTED_{trusted_id}_X25519[] = '
                f'"{trusted["x_public"]}";'
            )

            lines.append("")

        config_path = output / f"{node_id.lower()}_config.h"

        config_path.write_text(
            "\n".join(lines),
            encoding="utf-8",
        )

    print("Provisioning complete.")
    print("Generated device configurations are in ./generated/")


if __name__ == "__main__":
    main()
```

This is the provisioning foundation. The actual ESP32 code should convert the hexadecimal strings into validated binary key buffers before passing them to the cryptographic library.

---

# 38. Python Key-Generation Rules

`setup_keys.py` must follow these rules:

1. Generate Ed25519 keys using a trusted library.
2. Generate X25519 keys using a trusted library.
3. Give every node a unique ID.
4. Generate every identity only once for a deployment.
5. Build the trusted public-key registry.
6. Generate one device-specific configuration per ESP32.
7. Put only that device's private keys into its configuration.
8. Put trusted public keys into the configuration.
9. Include Rescue's public keys in normal-node configurations.
10. Never place another node's private key in a device configuration.
11. Do not regenerate keys as part of compilation.
12. Protect the generated private-key files.
13. Never publish generated private-key files.

---

# 39. Important Python Rule: Do Not Regenerate After Deployment

If you run:

```text
setup_keys.py
```

again and it generates new identities, the identities will change.

That means the trusted registry changes.

Therefore:

> Run the key-generation/provisioning step once for a deployment and preserve the generated configuration.

If you intentionally regenerate keys, treat it as a new provisioning event and reflash/reprovision the affected devices.

---

# 40. Arduino Configuration Rule

The Arduino sketches should contain the application logic.

The generated configuration contains the device-specific hardcoded cryptographic values.

Example:

```cpp
#include "node_config.h"
```

Then the sketch can access:

```cpp
OWN_ED25519_PRIVATE
OWN_ED25519_PUBLIC

OWN_X25519_PRIVATE
OWN_X25519_PUBLIC

TRUSTED_NODE_A_ED25519
TRUSTED_NODE_A_X25519

TRUSTED_NODE_B_ED25519
TRUSTED_NODE_B_X25519

TRUSTED_NODE_C_ED25519
TRUSTED_NODE_C_X25519

TRUSTED_RESCUE_ED25519
TRUSTED_RESCUE_X25519
```

The generated header is still hardcoded into the compiled firmware.

---

# 41. Rules for normal_node.ino

`normal_node.ino` must:

```text
1. Load its own hardcoded Ed25519 private key.
2. Load its own hardcoded X25519 private key.
3. Load its own public keys.
4. Load trusted public keys.
5. Know the Rescue X25519 public key.
6. Validate packet structure.
7. Verify trusted signatures.
8. Perform replay protection.
9. Process the Merkle-set.
10. Add its node ID if absent.
11. Relay only when appropriate.
12. Never decrypt the sensitive body.
13. Never expose its private keys.
14. Never transmit private keys.
15. Never trust arbitrary public keys learned from the mesh.
16. Use established cryptographic libraries.
17. Never reuse a ChaCha20-Poly1305 nonce with the same key.
```

---

# 42. Rules for rescue_node.ino

`rescue_node.ino` must:

```text
1. Load Rescue's own Ed25519 private key.
2. Load Rescue's own X25519 private key.
3. Load trusted public keys.
4. Validate packet structure.
5. Verify sender identity.
6. Verify Ed25519 signature.
7. Perform replay protection.
8. Obtain the sender's trusted X25519 public key.
9. Perform X25519 with Rescue's private key.
10. Run HKDF-SHA-256.
11. Derive K.
12. Use ChaCha20-Poly1305.
13. Verify the authentication tag.
14. Only then release decrypted data.
15. Display location and timestamp.
16. Never expose Rescue's private keys.
```

---

# 43. Cryptographic Library Rule

Do NOT implement cryptographic primitives yourself.

Do not write your own:

```text
Ed25519
X25519
HKDF
ChaCha20
Poly1305
```

Use established ESP32-compatible cryptographic implementations.

The exact Arduino library/API should be selected during implementation and tested on the target ESP32 board.

---

# 44. Private-Key Rules

Private keys are the most sensitive values.

For every node:

```text
Own private keys
    ↓
hardcoded into its own device-specific firmware
    ↓
never transmitted
```

Never do:

```text
Node A private key → Node B
Node B private key → Node C
Rescue private key → Node A
```

---

# 45. Public-Key Rules

Public keys can be distributed.

The project uses the trusted registry to associate:

```text
node_id → public key
```

For example:

```text
NODE_A → A Ed25519 public key
NODE_B → B Ed25519 public key
NODE_C → C Ed25519 public key
RESCUE → Rescue Ed25519 public key
```

and similarly for X25519 public keys.

---

# 46. Trust Mechanism Summary

The trust mechanism is entirely pre-provisioned.

```text
Python
  ↓
generates identities
  ↓
builds trusted registry
  ↓
hardcodes registry into device configurations
  ↓
flash once
  ↓
nodes operate offline
```

At runtime:

```text
packet claims NODE_B
       ↓
look up NODE_B in trusted registry
       ↓
get trusted B public key
       ↓
verify signature
       ↓
accept/reject
```

No runtime certificate server is required.

No laptop is required.

No node needs to learn trust dynamically.

---

# 47. Security Trade-Off

Hardcoding private keys is intentionally chosen for this college prototype because it makes deployment simple.

The trade-off is:

> If someone extracts a node's private key from its firmware, that node's identity can potentially be impersonated.

Therefore:

```text
Keep generated files private.
Keep firmware binaries private.
Do not publish private-key headers.
Do not upload them to public GitHub.
```

For a production rescue system, use secure hardware-backed key storage and secure provisioning instead.

For this prototype:

```text
Python-generated keys
+
hardcoded device-specific configuration
+
one-time flashing
```

is the chosen design.

---

# 48. Adding a New Node

Suppose Node D is added later.

Do NOT manually invent or copy keys.

Run the provisioning process for the updated deployment:

```text
Generate D's identity
       ↓
Add D public keys to trusted registry
       ↓
Generate D configuration
       ↓
Update trusted public-key configurations
       ↓
Reflash affected nodes if their trusted registry must contain D
```

Existing node private keys should remain unchanged unless intentionally rotated.

---

# 49. Key Rotation

If a node's key is compromised or must be replaced:

```text
Generate new identity
       ↓
Update trusted registry
       ↓
Generate updated device configurations
       ↓
Reflash/reprovision affected nodes
```

Key rotation is not part of normal operation.

---

# 50. Final Deployment Checklist

Before deployment:

```text
[ ] Node IDs are unique
[ ] setup_keys.py generated all identities
[ ] Trusted registry is correct
[ ] Node A config contains only A private keys
[ ] Node B config contains only B private keys
[ ] Node C config contains only C private keys
[ ] Rescue config contains only Rescue private keys
[ ] Every node has required trusted public keys
[ ] Every normal node has Rescue X25519 public key
[ ] Generated private-key files are protected
[ ] Correct configuration is compiled for each ESP32
[ ] Each ESP32 is flashed once
```

After deployment:

```text
[ ] Laptop disconnected
[ ] Each ESP32 powered independently
[ ] Mesh communication tested
[ ] Relay behavior tested
[ ] Duplicate relay behavior tested
[ ] Authentication failure tested
[ ] Replay rejection tested
[ ] Rescue decryption tested
[ ] Tampered ciphertext/tag rejection tested
```

---

# 51. Final "What Do I Copy?" Answer

## Manually copy cryptographic keys?

```text
NO
```

Python generates them.

## Manually copy Node B's key into Node A?

```text
NO
```

Python puts B's public key into A's generated configuration.

## Manually copy Node C's key into Node A?

```text
NO
```

Python does it.

## Manually copy Rescue's public key into every node?

```text
NO
```

Python does it.

## Manually copy private keys?

```text
NEVER
```

Each node gets only its own private keys in its own generated hardcoded configuration.

## Flash each node twice?

```text
NO
```

Each node is flashed once.

## Need laptop while the mesh is operating?

```text
NO
```

Power banks are sufficient after deployment.

---

# 52. Final Project Architecture in One Picture

```text
                    ┌──────────────────┐
                    │   setup_keys.py  │
                    └────────┬─────────┘
                             │
                 Generate all identities
                             │
                             ▼
                 ┌──────────────────────┐
                 │ Trusted Public       │
                 │ Key Registry         │
                 └──────────┬───────────┘
                            │
             Generate device-specific configs
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
    Node A config       Node B config       Node C config
    A private keys      B private keys      C private keys
    + all trusted       + all trusted       + all trusted
      public keys         public keys         public keys
        │                   │                   │
        ▼                   ▼                   ▼
 normal_node.ino       normal_node.ino       normal_node.ino
        │                   │                   │
        ▼                   ▼                   ▼
    Flash once          Flash once          Flash once
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
                     Rescue config
                     Rescue private keys
                     + trusted public keys
                            │
                            ▼
                    rescue_node.ino
                            │
                            ▼
                       Flash once
                            │
                            ▼
                   Disconnect computer
                            │
                            ▼
                      POWER BANKS
                            │
                            ▼
                         MESH
                            │
          ┌─────────────────┴─────────────────┐
          │                                   │
          ▼                                   ▼
      Normal nodes                         Rescue
   authenticate + relay             authenticate + decrypt
          │                                   │
          │                                   ▼
          │                         location + timestamp
          │
          └──── sensitive body remains encrypted ────┘
```

---

# 53. Final Mental Model

Remember the system as five separate jobs:

```text
ED25519
    ↓
"WHO AUTHENTICATED THIS?"

X25519
    ↓
"HOW DO SENDER AND RESCUE GET THE SAME SECRET?"

HKDF
    ↓
"TURN THAT SECRET INTO K"

CHACHA20-POLY1305
    ↓
"ENCRYPT + AUTHENTICATE LOCATION/TIMESTAMP"

MERKLE-SET
    ↓
"WHICH NODES HAVE ALREADY RECEIVED THIS MESSAGE?"
```

And provisioning is:

```text
PYTHON
    ↓
generate all keys ONCE
    ↓
hardcode them into device-specific configurations
    ↓
flash each ESP32 ONCE
    ↓
disconnect laptop
    ↓
power-bank operation
```

---

# 54. The Final Rules — Do Not Change These Accidentally

For this project, the agreed architecture is:

```text
1. Python generates the cryptographic keys.
2. Generated keys are hardcoded into device-specific firmware/configuration.
3. Each ESP32 is flashed only once for initial deployment.
4. Each node contains its own private keys only.
5. Other nodes' public keys are hardcoded as trusted public keys.
6. Rescue's X25519 public key is included in every normal node's configuration.
7. No runtime laptop is required.
8. No runtime Serial provisioning is required.
9. No private key is transmitted.
10. K is derived at runtime, not transmitted.
11. X25519 shared secrets are derived at runtime.
12. Ed25519 authenticates the immutable/origin portion.
13. The Merkle-set root is mutable routing state.
14. A simple hash chain must NOT be substituted for the Merkle-set.
15. Normal nodes relay without decrypting.
16. Rescue alone decrypts the sensitive body.
17. Location and timestamp are encrypted together.
18. ChaCha20-Poly1305 nonce reuse is forbidden.
19. Established cryptographic libraries must be used.
20. Generated private-key files and private-key-containing firmware must be protected.
```

---

# 55. One-Sentence Final Project Description

> **An ESP32 emergency mesh network in which Python-generated cryptographic identities are provisioned into each node at compile time, normal nodes securely authenticate and relay encrypted messages without seeing sensitive location/timestamp data, and a trusted Rescue Node alone derives the encryption key and decrypts the information at the destination.**
