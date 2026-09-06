# Mesh Rescue Communication — Final Concise Architecture

## 1. System Overview

There are two ESP32 programs:

- `normal_node.ino` — runs on all normal mesh relay nodes.
- `rescue_node.ino` — runs on the Rescue ESP32.

Normal nodes forward packets through the mesh. They **must not be able to read the sensitive rescue body**.

The Rescue node is the final destination and is the only node that decrypts and unveils the sensitive data.

```text
Node A → Node B → Node C → Rescue
          MESH
```

---

# 2. What Each ESP32 Has

Every ESP32 has:

### Identity

```text
node_id
```

Example:

```text
Node A → A
Node B → B
Node C → C
Rescue → R
```

### Ed25519 key pair

Used for authentication/signatures.

```text
Ed25519 Private Key  → SECRET, stays on device
Ed25519 Public Key   → can be shared
```

### X25519 key pair

Used for key agreement.

```text
X25519 Private Key   → SECRET, stays on device
X25519 Public Key    → can be shared
```

Every ESP32 generates its **own unique key pairs**.

---

# 3. Key Generation and Storage

Keys are **not hard-coded into the `.ino` code**.

The same program handles first boot and later boots.

```text
ESP32 boots
     ↓
Are keys already stored in NVS?
     │
 ┌───┴────┐
 YES      NO
 │         │
Load      Generate
keys      key pairs
 │         │
 │       Save to NVS
 └────┬────┘
      ↓
Use existing keys
```

Therefore:

```text
First boot:
Generate → Save → Use

Later boot:
Load → Use
```

The same keys are reused after reboot.

If NVS/persistent storage is erased, the ESP32 loses its identity and generates a new key pair.

## Private Key Rule

Private keys:

- Are never transmitted in packets.
- Are never copied to other nodes.
- Stay inside the ESP32.
- Should be stored securely in persistent storage.

---

# 4. Rescue Key Provisioning

Every normal node needs the **Rescue public key**.

The Rescue public key does not need to be hard-coded into `normal_node.ino`.

It is provisioned once.

## Step 1 — Rescue

Connect Rescue to the computer through USB.

```text
Rescue ESP32
     │
     │ USB
     ▼
 Computer
```

`rescue_node.ino` generates its keys if they don't already exist and displays the Rescue public key through Serial.

Example:

```text
Rescue X25519 Public Key:
A1B2C3D4...
```

Copy only the public key.

**Never copy Rescue's private key.**

## Step 2 — Normal Node

Disconnect Rescue.

Connect Node A to the computer.

```text
Node A
  │
  │ USB
  ▼
Computer
```

Run `normal_node.ino`.

Enter provisioning mode and paste the Rescue public key through Serial.

The normal node stores it in NVS.

```text
Node A NVS
├── Node A private keys       [SECRET]
├── Node A public keys
└── Rescue X25519 public key
```

Repeat for Node B, C, etc.

After provisioning, the computer is not required during normal operation.

---

# 5. Keys Stored by Each Device

## Normal Node

```text
Normal Node NVS
├── node_id
├── Ed25519 private key       [SECRET]
├── Ed25519 public key
├── X25519 private key        [SECRET]
├── X25519 public key
└── Rescue X25519 public key
```

## Rescue Node

```text
Rescue NVS
├── node_id
├── Ed25519 private key       [SECRET]
├── Ed25519 public key
├── X25519 private key        [SECRET]
└── X25519 public key
```

---

# 6. Packet Structure

A packet has a **Header** and an **Encrypted Body**.

```text
┌─────────────────────────────────────┐
│               HEADER                │
├─────────────────────────────────────┤
│ node_id                             │
│ message_id / Merkle root            │
│ routing information                 │
│ public-key information              │
│ key-establishment information      │
│ other required metadata             │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│          ENCRYPTED BODY             │
├─────────────────────────────────────┤
│ Encrypted location                  │
│ Encrypted timestamp                 │
│ ChaCha20-Poly1305 authentication    │
│ tag                                 │
└─────────────────────────────────────┘
```

### Private keys are NOT in the header.

A private key remains inside the ESP32 and is never transmitted.

---

# 7. What Is in the Body?

The sensitive body contains:

```text
BODY
├── Location
└── Timestamp
```

For example:

```text
Location  = 12.9716, 77.5946
Timestamp = 14:32:15
```

These two values are encrypted **together**.

```text
Location + Timestamp
          ↓
      Encryption
          ↓
     Encrypted Body
```

Relay nodes therefore cannot see either the location or timestamp.

---

# 8. Understanding K

**K is the symmetric encryption key used by ChaCha20-Poly1305.**

It is the key that actually encrypts and decrypts the body.

The clean architecture is:

```text
X25519
   ↓
Shared Secret
   ↓
HKDF-SHA-256
   ↓
K
   ↓
ChaCha20-Poly1305
   ↓
Encrypt/Decrypt Body
```

K is not the same thing as:

- Ed25519 private/public keys
- X25519 private/public keys
- Rescue public key
- Merkle root

K is specifically the **symmetric encryption key for the message body**.

---

# 9. How K Is Obtained

K is derived from an X25519 shared secret.

Node A has:

```text
Node A X25519 Private A
Node A X25519 Public A
```

Rescue has:

```text
Rescue X25519 Private R
Rescue X25519 Public R
```

Node A already knows Rescue's public key because it was provisioned earlier.

## Node A

Conceptually:

```text
Node A Private A
       +
Rescue Public R
       ↓
      X25519
       ↓
Shared Secret
       ↓
HKDF-SHA-256
       ↓
K
```

## Rescue

Rescue performs the corresponding operation:

```text
Rescue Private R
       +
Node A Public A
       ↓
      X25519
       ↓
Same Shared Secret
       ↓
HKDF-SHA-256
       ↓
Same K
```

Therefore, **K does not have to be transmitted through the mesh**.

Both sides independently derive the same K.

---

# 10. Why Normal Nodes Cannot Get K

Node B may see Node A's public key and Rescue's public key, but it does not have Rescue's private key.

Therefore B cannot perform:

```text
Rescue Private R + Node A Public A
```

So B cannot obtain the X25519 shared secret.

Therefore:

```text
No shared secret
      ↓
No K
      ↓
Cannot decrypt body
```

The same applies to every normal relay node.

---

# 11. Encrypting the Body

Node A has:

```text
Location
Timestamp
```

Node A derives K using:

```text
X25519 → HKDF-SHA-256 → K
```

Then:

```text
Location + Timestamp
          +
          K
          ↓
ChaCha20-Poly1305
          ↓
Encrypted Body
+
Nonce
+
Authentication Tag
```

Conceptually:

```text
Plaintext:
"12.9716,77.5946 | 14:32:15"

        ↓ K

ChaCha20-Poly1305

        ↓

Ciphertext + Authentication Tag
```

The nonce is also required for decryption.

**A nonce must never be reused with the same encryption key.**

---

# 12. What Travels Through the Mesh?

The packet travels like:

```text
Node A
   │
   │ Encrypted body
   ▼
Node B
   │
   │ Encrypted body
   ▼
Node C
   │
   │ Encrypted body
   ▼
Rescue
```

B and C can inspect/process the header information required for routing and authentication.

They cannot read:

```text
Location
Timestamp
```

because those are inside the encrypted body.

---

# 13. Rescue Decryption

Rescue receives the packet.

It obtains the necessary sender public-key information and performs:

```text
Rescue Private R
       +
Node A Public A
       ↓
      X25519
       ↓
Shared Secret
       ↓
HKDF-SHA-256
       ↓
Same K
```

Then:

```text
Encrypted Body
      +
      K
      +
    Nonce
      ↓
ChaCha20-Poly1305 Decryption
      ↓
Location + Timestamp
```

Rescue therefore **unveils both the location and timestamp**.

Example:

```text
Location: 12.9716, 77.5946
Timestamp: 14:32:15
```

If the authentication tag is invalid, Rescue rejects the body.

---

# 14. Ed25519 — A Different Job

Ed25519 is not used to encrypt the body.

It is used to answer:

> "Who created/authenticated this message?"

Node A uses:

```text
Node A Ed25519 Private Key
             ↓
          Signature
```

Other nodes use Node A's Ed25519 public key to verify the signature.

If verification fails:

```text
Invalid signature
      ↓
DROP PACKET
```

The origin signature should cover the appropriate **immutable** message information.

It should not simply cover the mutable Merkle root.

---

# 15. Merkle-Root Message ID

The `message_id` is based on your **Merkle-set/authenticated-set concept**.

It represents the nodes that have already received the message.

It is used for relay decisions, not encryption.

When a node receives a message, it checks its own `node_id` against the current set/root representation.

Conceptually:

```text
Current Merkle root
        +
Node's node_id
        ↓
Check/update set representation
```

## Node Already Represented

```text
Node already represented
        ↓
No root change
        ↓
DO NOT RELAY
```

## Node Not Represented

```text
Node not represented
        ↓
Update set/root
        ↓
RELAY
```

No `seen_messages` cache is required for this mechanism.

### Important

Do not implement this as:

```text
SHA256(current_root || node_id)
```

That would be a hash chain, not the intended Merkle-set design.

A proper set-style Merkle/authenticated-set construction is required, especially because the mesh can branch and information from different paths may need to be merged.

---

# 16. Normal Node Processing

A normal node does:

```text
Receive packet
      ↓
Verify authentication
      ↓
Check replay protection
      ↓
Process Merkle-root/set information
      ↓
Is my node_id already represented?
      │
   ┌──┴──┐
  YES    NO
   │      │
 DROP   Update root
          ↓
        RELAY
```

It does **not** decrypt the body.

---

# 17. Rescue Node Processing

Rescue does:

```text
Receive packet
      ↓
Verify authentication
      ↓
Check replay protection
      ↓
Perform X25519
      ↓
HKDF-SHA-256
      ↓
Derive K
      ↓
ChaCha20-Poly1305 decrypt
      ↓
Verify authentication tag
      ↓
Unveil Location + Timestamp
```

---

# 18. Replay Protection

The packet should contain replay-protection information such as:

```text
sender_node_id
sequence_number
```

This helps prevent an attacker from repeatedly injecting an old valid packet.

ChaCha20-Poly1305 also uses a nonce.

The nonce must be unique for a given encryption key.

---

# 19. Complete Example

Suppose Node A detects:

```text
Location  = 12.9716, 77.5946
Timestamp = 14:32:15
```

### Node A

```text
1. Prepare Location + Timestamp
2. Use Node A private/public keys as required
3. Perform X25519 with Rescue public key
4. Obtain shared secret
5. Use HKDF-SHA-256
6. Derive K
7. Encrypt Location + Timestamp with K
8. Generate required nonce
9. Create authentication tag
10. Authenticate/sign immutable origin information
11. Add Merkle-root/message ID
12. Send packet
```

### Node B

```text
1. Receive packet
2. Verify authentication
3. Check replay protection
4. Check its node_id in the Merkle-set
5. If already represented → drop
6. If not represented → update root and relay
7. Never decrypt the body
```

### Node C

Same process as Node B.

### Rescue

```text
1. Receive packet
2. Verify authentication
3. Check replay protection
4. Perform X25519 using Rescue private key
5. Derive same shared secret
6. Run HKDF-SHA-256
7. Derive same K
8. Decrypt encrypted body
9. Verify authentication tag
10. Unveil Location
11. Unveil Timestamp
```

---

# 20. Final Mental Model

Remember the system as five separate jobs:

```text
┌─────────────────────────────────────────────┐
│ ED25519                                     │
│ "WHO CREATED/AUTHENTICATED THE MESSAGE?"    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ X25519                                      │
│ "HOW DO NODE A AND RESCUE GET A SECRET?"    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ HKDF-SHA-256                                │
│ "TURN THE SHARED SECRET INTO K"             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ K + ChaCha20-Poly1305                      │
│ "ENCRYPT LOCATION + TIMESTAMP"              │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ MERKLE SET / ROOT                           │
│ "SHOULD THIS NODE RELAY THE MESSAGE?"       │
└─────────────────────────────────────────────┘
```

## The One Flow to Remember

```text
Node A
  │
  │ Location + Timestamp
  ↓
X25519 with Rescue public key
  ↓
Shared Secret
  ↓
HKDF-SHA-256
  ↓
K
  ↓
ChaCha20-Poly1305
  ↓
Encrypted Location + Timestamp
  ↓
Add header + authentication + Merkle-root information
  ↓
──────────────── MESH ────────────────
  ↓
Normal nodes verify + check Merkle root + relay
  ↓
Rescue
  ↓
X25519 with Rescue private key
  ↓
Same Shared Secret
  ↓
HKDF-SHA-256
  ↓
Same K
  ↓
ChaCha20-Poly1305
  ↓
Location + Timestamp unveiled
```

## Final Key Rules

1. **Every ESP32 generates its own Ed25519 and X25519 key pairs once and stores them in NVS.**
2. **Private keys never leave their ESP32.**
3. **Rescue's X25519 public key is provisioned once to each normal node through Serial and stored in NVS.**
4. **K is the symmetric key used by ChaCha20-Poly1305.**
5. **K is derived using X25519 + HKDF-SHA-256; it is not sent directly through the mesh.**
6. **Location and timestamp are encrypted together.**
7. **Only Rescue has the private key needed to derive the encryption key for a message from a normal sender.**
8. **Normal nodes relay the encrypted body without decrypting it.**
9. **Ed25519 handles authentication/signatures; it is separate from body encryption.**
10. **The Merkle-set/root handles relay detection; it is separate from encryption.**
11. **The mutable Merkle root must not simply be included in the immutable origin signature.**
12. **A proper Merkle-set/authenticated-set construction must be defined before implementation; `SHA256(root || node_id)` is not a substitute.**
