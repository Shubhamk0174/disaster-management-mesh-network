# ESP32 Rescue Mesh — Test Build (No Encryption)

Two sketches, no crypto, just the mesh relay logic so you can prove the
Merkle-set relay decision and many-to-many LoRa broadcast work before
layering the real security back on.

```
normal_node/
  normal_node.ino
  mesh_common.h
rescue_node/
  rescue_node.ino
  mesh_common.h
```

## 1. Hardware per board

- ESP32 DevKit
- SX1278 / RA-02 LoRa module (433 MHz)
- Jumper wires, 3.3V supply to the LoRa module (**not 5V**)

### Wiring (matches the #defines at the top of `mesh_common.h`)

| LoRa module pin | ESP32 pin |
|---|---|
| SCK   | 18 |
| MISO  | 19 |
| MOSI  | 23 |
| NSS / CS | 5 |
| RST   | 14 |
| DIO0  | 2  |
| VCC   | 3.3V |
| GND   | GND |

If your wiring differs, just edit the `#define LORA_*` lines in
`mesh_common.h` — everything else uses those constants.

## 2. Library

Arduino IDE → **Tools → Manage Libraries** → install **"LoRa" by Sandeep Mistry**.

## 3. Flashing

- Open `normal_node/normal_node.ino`. Before uploading to each relay
  board, change `#define MY_NODE_ID` to a unique number (0–15) — two
  boards sharing an ID will confuse the Merkle-set.
- Open `rescue_node/rescue_node.ino` and upload it, unchanged, to the
  destination board.

You need at least 2 normal nodes + 1 rescue node to actually see
"many-to-many" relaying happen; 1 normal node will just show sending
straight to Rescue.

## 4. Testing

1. Power all boards, open a Serial Monitor per board at **115200 baud**,
   line ending **Newline**.
2. On any normal node's monitor, type a message and press Enter.
3. That node prints `Message sent.`
4. Every other normal node in range prints either:
   - `Message received and relayed.` (its bit wasn't in the set yet — it
     added itself, got a new Merkle root, and rebroadcast), or
   - `Message received and ignored.` (it had already relayed this exact
     message).
5. The Rescue node prints a full block for every packet that reaches it:
   `message_id`, `origin_node`, the `node_bitmask` in binary (which
   nodes it passed through), `merkle_root`, and the `body` text.

## 5. What's deliberately left out (for now)

Per your request, this build has **no encryption or signatures** — no
Ed25519, no X25519, no HKDF, no ChaCha20-Poly1305. The packet is plain:
`message_id`, `node_bitmask` (the Merkle-set), `merkle_root`, `origin_node_id`,
`body`. When you're ready to secure it, the full architecture doc you
shared describes exactly where each of those pieces slots back in —
notably, the Merkle-root function here uses simple integer mixing, not
SHA-256, so that's the first thing to swap out.
