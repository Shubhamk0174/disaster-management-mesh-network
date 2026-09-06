#!/usr/bin/env python3
"""
setup_keys.py
--------------
One-time provisioning tool for the ESP32 Rescue Mesh project.

For every node listed in NODES below, this script:
  1. Generates a fresh Ed25519 keypair (signatures / authentication)
  2. Generates a fresh X25519 keypair (key agreement)
  3. Builds a trusted public-key registry containing every node's public keys
  4. Writes ONE header file per device containing:
       - that device's own private + public keys
       - the public keys of every node it needs to trust (including itself)
       - NODE_ID / NODE_ROLE

Run this ONCE per deployment.
Re-running it generates a brand-new identity for every node, which
invalidates every device you've already flashed — treat that as a fresh
deployment / full key rotation, not routine use.

Requires: pip install cryptography
"""

import os
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PrivateFormat,
    PublicFormat,
    NoEncryption,
)

# ----------------------------------------------------------------------
# 1. DEFINE THE DEPLOYMENT
#    Edit this list to match your actual node count. Order doesn't matter.
# ----------------------------------------------------------------------
NODES = [
    # (node_id, role)
    ("NODE_A", "NORMAL"),
    ("NODE_B", "NORMAL"),
    # ("NODE_C", "NORMAL"),   # <- add more normal nodes here if you have them
    ("RESCUE", "RESCUE"),
]

OUTPUT_DIR = "generated_configs"


def hexlify(b: bytes) -> str:
    return b.hex()


def generate_identity() -> dict:
    """Generate one Ed25519 keypair + one X25519 keypair as raw 32-byte values."""
    ed_priv = ed25519.Ed25519PrivateKey.generate()
    ed_pub = ed_priv.public_key()

    x_priv = x25519.X25519PrivateKey.generate()
    x_pub = x_priv.public_key()

    return {
        "ed25519_private": ed_priv.private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        ),
        "ed25519_public": ed_pub.public_bytes(Encoding.Raw, PublicFormat.Raw),
        "x25519_private": x_priv.private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        ),
        "x25519_public": x_pub.public_bytes(Encoding.Raw, PublicFormat.Raw),
    }


def build_registry(nodes: list) -> dict:
    """Generate an identity for every node and collect it into one registry."""
    registry = {}
    for node_id, role in nodes:
        if node_id in registry:
            raise ValueError(f"Duplicate node id: {node_id}")
        registry[node_id] = {"role": role, **generate_identity()}
    return registry


def render_header(node_id: str, role: str, registry: dict) -> str:
    """Build the C header text for one device."""
    own = registry[node_id]
    lines = []
    lines.append("#pragma once")
    lines.append("")
    lines.append(f'#define NODE_ID "{node_id}"')
    lines.append(f'#define NODE_ROLE "{role}"')
    lines.append("")
    lines.append(f'const char OWN_ED25519_PRIVATE[] = "{hexlify(own["ed25519_private"])}";')
    lines.append(f'const char OWN_ED25519_PUBLIC[]  = "{hexlify(own["ed25519_public"])}";')
    lines.append(f'const char OWN_X25519_PRIVATE[] = "{hexlify(own["x25519_private"])}";')
    lines.append(f'const char OWN_X25519_PUBLIC[]  = "{hexlify(own["x25519_public"])}";')
    lines.append("")
    lines.append("// Trusted public keys")
    lines.append("")
    for other_id, data in registry.items():
        lines.append(f"// {other_id} ({data['role']})")
        lines.append(
            f'const char TRUSTED_{other_id}_ED25519[] = "{hexlify(data["ed25519_public"])}";'
        )
        lines.append(
            f'const char TRUSTED_{other_id}_X25519[] = "{hexlify(data["x25519_public"])}";'
        )
        lines.append("")
    return "\n".join(lines)


def output_filename(node_id: str, role: str) -> str:
    if role == "RESCUE":
        return "rescue_config.h"
    return f"{node_id.lower()}_config.h"


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    registry = build_registry(NODES)

    for node_id, role in NODES:
        header_text = render_header(node_id, role, registry)
        filename = output_filename(node_id, role)
        path = os.path.join(OUTPUT_DIR, filename)
        with open(path, "w") as f:
            f.write(header_text)
        print(f"[+] Wrote {path}")

    print()
    print(f"Provisioning complete. Generated at {datetime.now(timezone.utc).isoformat()}")
    print()
    print("REMEMBER:")
    print(" - Every file in generated_configs/ contains a PRIVATE key.")
    print(" - Never commit generated_configs/ to git or paste its contents anywhere.")
    print(" - Copy each *_config.h onto the matching device only, then compile + flash.")
    print(" - Re-running this script creates a brand-new identity set for ALL nodes.")


if __name__ == "__main__":
    main()