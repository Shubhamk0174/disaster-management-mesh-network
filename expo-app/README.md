# Rescue Mesh — Offline SOS Client App

An emergency SOS client app built with Expo (React Native & TypeScript) designed to communicate directly with an **ESP32 LoRa Mesh Node** (`RESCUE-MESH`) over local Wi-Fi with **no internet access required**.

It replaces the node's captive portal web interface because modern mobile browsers block GPS location access over insecure plain HTTP. The app acquires high-accuracy GPS coordinates natively and dispatches the SOS alert to the node over HTTP, which the node then cryptographically signs and broadcasts across the LoRa mesh network to emergency rescue stations.

---

## ⚠️ Important: Development & Preview Builds Only (No Expo Go)

> **This app will NOT work in Expo Go.**
> It utilizes custom native modules (`react-native-wifi-reborn` for Android Wi-Fi network routing bypass and `expo-build-properties` for cleartext HTTP traffic). You must build a **development build** or a **preview APK build** using EAS Build.

---

## 📦 Required Dependencies Installation

Run the following commands inside `expo-app/`:

```bash
# Pin SDK-compatible versions of required native modules
npx expo install expo-location expo-haptics expo-build-properties react-native-wifi-reborn

# Install all remaining dependencies
npm install
```

---

## 🔨 Building the Android APK with EAS

The project includes an `eas.json` configured with a `preview` profile targeting standalone APK generation (`buildType: "apk"`).

### Option A: Local EAS Build (Recommended for offline / local machines)

Make sure you have Android SDK and build tools installed on your machine, then run:

```bash
cd expo-app
npx eas-cli build --platform android --profile preview --local
```

The resulting `.apk` file will be saved in your build directory and can be transferred/installed directly onto any Android device.

### Option B: Cloud EAS Build

```bash
cd expo-app
npx eas-cli build --platform android --profile preview
```

EAS will build the APK in the cloud and provide a direct download link / QR code to install on your Android device.

---

## 📡 Testing Against the ESP32 Node

1. **Power on the ESP32 Node**:
   Ensure the node is flashed with `RescueMesh_Node1.ino` and broadcasting the SoftAP Wi-Fi SSID `RESCUE-MESH`.
2. **Connect Phone to Wi-Fi**:
   - **Auto-Connect**: On launch, the app automatically triggers a connection to **`RESCUE-MESH`** (or tap the prominent **`Connect to RESCUE-MESH Wi-Fi`** button in the app). On Android 10+, Android will display a 1-tap system prompt: *"Connect to RESCUE-MESH? [Connect]"*.
   - **Manual Connect**: Alternatively, join Wi-Fi network: **`RESCUE-MESH`** (open network, no password).
   - If Android shows the notification **"Wi-Fi has no internet access. Tap for options"**, tap it and select **"Stay Connected"** / **"Yes"**.
   - If Android still attempts to route HTTP requests over mobile data, disable **Mobile Data** in Android quick settings.
3. **Launch the App**:
   - The top status pill will turn **Green**: `Connected to NODE_A (X on AP)`.
   - If disconnected, tap the pill or use the in-app hint card button **"Open Wi-Fi Settings"**.
4. **Acquire GPS / Set Coordinates**:
   - The app immediately requests GPS permissions on startup and queries `Location.Accuracy.High` with a 15-second timeout, falling back to cached location if needed.
   - You can also enter a manual coordinate override in `Location (optional, if GPS fails)` (e.g. `16.494485, 80.499179`).
5. **Press and Hold the SOS Button**:
   - Press and hold the circular red SOS button for **1.5 seconds**.
   - A visible amber ring will track hold progress. Releasing early cancels the trigger to prevent accidental activations.
   - On completion, haptic feedback fires, and the SOS is dispatched to `http://192.168.4.1/api/sos`.
6. **Wait for LoRa ACK Confirmation**:
   - The node replies `202 Accepted` and transmits the packet over LoRa.
   - The app polls `/api/ack-status` every 1.5 seconds.
   - When the rescue station responds, a large **Green Banner** confirms: `DELIVERED & CONFIRMED BY RESCUE TEAM`.
   - If transmission retries fail or 30 seconds elapse, a **Red Banner** appears with a `RETRY SOS` button.

---

## ⚙️ Architecture & ESP32 Node API

All node parameters are centralized in [`src/config.ts`](./src/config.ts):

- **Base URL**: `http://192.168.4.1`
- **Heartbeat Status**: `GET /api/status` (polled every 5 seconds, 3s timeout)
- **Emergency Dispatch**: `POST /api/sos`
  ```json
  {
    "latitude": 16.494485,
    "longitude": 80.499179,
    "mobile": "9876543210",
    "msg": "Trapped on 2nd floor"
  }
  ```
  - Coordinates rounded to 6 decimal places (omitted entirely if no GPS/manual location is available to use the node's fixed fallback location).
  - Quotes `"` and backslashes `\` are stripped from `msg` (max 47 chars) to avoid breaking the ESP32 naive parser.
  - Mobile is stripped to digits only (max 12 chars).
- **ACK Polling**: `GET /api/ack-status` (polled every 1.5s, 3s timeout, 30s cap)
- **Cooldown**: 10-second countdown between SOS requests.

---

## 🔒 Security & Privacy

- **Zero Cryptographic Keys in App**: All Ed25519 signatures, ChaCha20 encryption, and Merkle root verification occur exclusively on the ESP32 hardware.
- **In-Memory Only**: User coordinates and phone numbers are never persisted to disk, AsyncStorage, SQLite, or third-party analytics.
