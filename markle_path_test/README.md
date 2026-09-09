# Merkle-Set Testing

This directory contains experimental and testing code related to the Merkle-set implementation.

## Purpose
In a wireless mesh network, packets are broadcasted to all nearby listening nodes. To prevent infinite loops (where Node A sends to B, B sends back to A, ad infinitum), the network must track which nodes have already seen and processed a message.

Because memory on an ESP32 is constrained, we cannot store infinite lists of message hashes. Instead, a Merkle-set (or similar cryptographic accumulator) is used to efficiently track message propagation and replay protection.

## Files
- `merkle.py`: A Python script that models and tests the logic for inserting nodes into the set, verifying membership, and maintaining state. This serves as a conceptual testbed before porting the logic to C++ for the ESP32 hardware.
