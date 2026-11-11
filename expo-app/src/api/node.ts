import { Platform } from 'react-native';
import {
  BASE_URL,
  STATUS_TIMEOUT_MS,
  ACK_REQUEST_TIMEOUT_MS,
  MAX_MOBILE_LENGTH,
  MAX_MSG_LENGTH,
  COORDINATE_DECIMALS,
} from '../config';

// Safe dynamic import for react-native-wifi-reborn
let WifiManager: typeof import('react-native-wifi-reborn').default | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wifiModule = require('react-native-wifi-reborn');
  WifiManager = wifiModule.default || wifiModule;
} catch {
  // Expected fallback in dev environments / web where native module is unlinked
}

export const MESH_SSID = 'RESCUE-MESH';

/**
 * Ensures network requests are forced over Wi-Fi on Android,
 * bypassing mobile data routing when connected to an offline AP.
 */
export async function ensureWifiBound(): Promise<void> {
  if (Platform.OS === 'android' && WifiManager?.forceWifiUsage) {
    try {
      await WifiManager.forceWifiUsage(true);
    } catch (error) {
      // Non-fatal warning: connection attempt will still proceed
      console.warn('WifiManager.forceWifiUsage failed:', error);
    }
  }
}

/**
 * Automatically attempts to connect to the Rescue Mesh Wi-Fi network.
 * - On Android <= 9: Connects silently in the background.
 * - On Android >= 10: Triggers Android's WifiNetworkSpecifier prompt
 *   ("Connect to RESCUE-MESH?") and binds process network upon approval.
 * - Submits network suggestion so Android can auto-connect in the background.
 */
export async function autoConnectToMeshWifi(): Promise<{ success: boolean; message: string }> {
  if (Platform.OS !== 'android' || !WifiManager) {
    return { success: false, message: 'Wi-Fi auto-connection only supported on Android' };
  }

  try {
    // 1. Enable Wi-Fi if currently off
    if (WifiManager.isEnabled && WifiManager.setEnabled) {
      try {
        const enabled = await WifiManager.isEnabled();
        if (!enabled) {
          WifiManager.setEnabled(true);
        }
      } catch {
        // Continue if enabling fails
      }
    }

    // 2. Check if already connected to RESCUE-MESH
    if (WifiManager.getCurrentWifiSSID) {
      try {
        const ssid = await WifiManager.getCurrentWifiSSID();
        const cleanSsid = ssid ? ssid.replace(/^"|"$/g, '') : '';
        if (cleanSsid === MESH_SSID) {
          await ensureWifiBound();
          return { success: true, message: `Already connected to ${MESH_SSID}` };
        }
      } catch {
        // Continue to connect
      }
    }

    // 3. Register network suggestion (for Android 10+ background auto-join)
    if (WifiManager.suggestWifiNetwork) {
      try {
        await WifiManager.suggestWifiNetwork([
          { ssid: MESH_SSID, password: '', isAppInteractionRequired: false },
        ]);
      } catch {
        // Ignore suggestion failure, proceed to direct connect
      }
    }

    // 4. Connect to open SSID RESCUE-MESH (password is empty string, isWEP false)
    if (WifiManager.connectToProtectedSSID) {
      await WifiManager.connectToProtectedSSID(MESH_SSID, '', false, false);
      await ensureWifiBound();
      return { success: true, message: `Connected to ${MESH_SSID}` };
    }

    return { success: false, message: 'connectToProtectedSSID not available' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to connect to Wi-Fi';
    console.warn('autoConnectToMeshWifi failed:', error);
    return { success: false, message: msg };
  }
}

export interface NodeStatus {
  node: string;
  waitingForAck: boolean;
  wifiClients: number;
  fallbackLocation: string;
}

export interface SOSPayload {
  latitude?: number;
  longitude?: number;
  mobile?: string;
  msg?: string;
}

export interface SOSResponse {
  success: boolean;
  message: string;
  status: number;
}

export interface AckStatus {
  ackReceived: boolean;
  waitingForAck: boolean;
  sosWasSent: boolean;
  isBusyOrTimeout?: boolean;
}

/**
 * Custom error class for API responses with HTTP status codes.
 */
export class NodeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'NodeApiError';
    this.status = status;
  }
}

/**
 * Helper to execute fetch with an AbortController timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number
): Promise<Response> {
  await ensureWifiBound();

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/status
 * Queries current connection status, connected clients, and fallback coordinates.
 * Called periodically (every 5 seconds) as a heartbeat check.
 */
export async function getStatus(): Promise<NodeStatus> {
  const url = `${BASE_URL}/api/status`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    },
    STATUS_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new NodeApiError(`Node status request failed with HTTP ${response.status}`, response.status);
  }

  const data = await response.json();
  return {
    node: String(data.node || 'UNKNOWN'),
    waitingForAck: Boolean(data.waitingForAck),
    wifiClients: Number(data.wifiClients ?? 0),
    fallbackLocation: String(data.fallbackLocation || ''),
  };
}

/**
 * POST /api/sos
 * Dispatches an emergency SOS request to the ESP32 node.
 * - Omits latitude/longitude if coordinates are undefined/null.
 * - Rounds latitude/longitude to 6 decimal places.
 * - Extracts digits-only for mobile (max 12 characters).
 * - Strips double quotes (") and backslashes (\) from message (max 47 characters).
 */
export async function sendSOS(payload: SOSPayload): Promise<SOSResponse> {
  const url = `${BASE_URL}/api/sos`;

  // Build clean payload complying with ESP32 naive parser constraints
  const cleanMobile = payload.mobile ? payload.mobile.replace(/\D/g, '').slice(0, MAX_MOBILE_LENGTH) : '';
  const cleanMsg = payload.msg ? payload.msg.replace(/["\\]/g, '').slice(0, MAX_MSG_LENGTH) : '';

  const body: Record<string, unknown> = {
    mobile: cleanMobile,
    msg: cleanMsg,
  };

  // Only include coordinates if both are valid numbers
  if (
    typeof payload.latitude === 'number' &&
    !isNaN(payload.latitude) &&
    typeof payload.longitude === 'number' &&
    !isNaN(payload.longitude)
  ) {
    body.latitude = Number(payload.latitude.toFixed(COORDINATE_DECIMALS));
    body.longitude = Number(payload.longitude.toFixed(COORDINATE_DECIMALS));
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    5000 // 5s timeout for initial SOS transmission request
  );

  const status = response.status;

  if (status === 202) {
    const data = await response.json().catch(() => ({}));
    return {
      success: true,
      message: data.message || 'SOS accepted. Transmitting over LoRa mesh...',
      status: 202,
    };
  }

  if (status === 409) {
    throw new NodeApiError('An SOS is already in progress on the node.', 409);
  }

  if (status === 429) {
    throw new NodeApiError('Cooldown active. Please wait 10 seconds between SOS alerts.', 429);
  }

  throw new NodeApiError(`Failed to send SOS (HTTP ${status})`, status);
}

/**
 * GET /api/ack-status
 * Polls for LoRa ACK confirmation from the rescue team.
 * The ESP32 is single-threaded and blocked during LoRa transmission (up to ~4s),
 * so timeouts or fetch failures are treated as "busy, try again" rather than hard failures.
 */
export async function getAckStatus(): Promise<AckStatus> {
  const url = `${BASE_URL}/api/ack-status`;

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      },
      ACK_REQUEST_TIMEOUT_MS
    );

    if (!response.ok) {
      // Treat server error status as node busy during LoRa transmit
      return {
        ackReceived: false,
        waitingForAck: true,
        sosWasSent: true,
        isBusyOrTimeout: true,
      };
    }

    const data = await response.json();
    return {
      ackReceived: Boolean(data.ackReceived),
      waitingForAck: Boolean(data.waitingForAck),
      sosWasSent: Boolean(data.sosWasSent),
      isBusyOrTimeout: false,
    };
  } catch {
    // Network error or timeout: node is actively busy transmitting LoRa packets
    return {
      ackReceived: false,
      waitingForAck: true,
      sosWasSent: true,
      isBusyOrTimeout: true,
    };
  }
}

