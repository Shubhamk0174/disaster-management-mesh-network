const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Expo Config Plugin for react-native-wifi-reborn.
 * Ensures all required Wi-Fi and network state permissions are added
 * to the AndroidManifest.xml for local Wi-Fi communication without internet.
 */
module.exports = function withWifiReborn(config) {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;
    const permissions = [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_WIFI_STATE',
      'android.permission.CHANGE_NETWORK_STATE',
    ];

    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    permissions.forEach((permissionName) => {
      const exists = androidManifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === permissionName
      );
      if (!exists) {
        androidManifest['uses-permission'].push({
          $: { 'android:name': permissionName },
        });
      }
    });

    return config;
  });
};

