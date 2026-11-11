/**
 * Rescue Mesh SOS Client Configuration
 * All node URLs, timing constants, and limits are configured here.
 */

// Base URL for the ESP32 LoRa Mesh Node Access Point
export const BASE_URL = 'http://192.168.4.1';

// Connection monitoring
export const STATUS_POLL_INTERVAL_MS = 5000; // Check node status every 5 seconds
export const STATUS_TIMEOUT_MS = 3000;        // 3-second timeout for status ping

// LoRa ACK polling after SOS is submitted (202)
export const ACK_POLL_INTERVAL_MS = 1500;     // Poll every 1.5 seconds
export const ACK_REQUEST_TIMEOUT_MS = 3000;   // 3-second timeout per ACK request
export const ACK_TOTAL_POLL_TIMEOUT_MS = 30000; // Total 30-second cap for ACK confirmation

// ESP32 rate limits & cooldowns
export const SOS_COOLDOWN_MS = 10000;         // 10-second cooldown between SOS requests

// Button interaction
export const PRESS_HOLD_DURATION_MS = 1500;   // Hold for 1.5 seconds to trigger SOS

// Location fetching
export const GPS_TIMEOUT_MS = 15000;          // 15-second timeout for high-accuracy GPS fix

// Payload constraints
export const MAX_MOBILE_LENGTH = 12;          // Digits only, max 12 chars
export const MAX_MSG_LENGTH = 47;             // Max 47 chars (ESP32 LoRa packet constraint)
export const COORDINATE_DECIMALS = 6;         // Round lat/lon to 6 decimals (max 31 chars)

