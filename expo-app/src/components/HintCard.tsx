import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';

interface HintCardProps {
  onRetryConnection?: () => void;
  isRetrying?: boolean;
  onConnectWifi?: () => void;
  isConnectingWifi?: boolean;
}

export const HintCard: React.FC<HintCardProps> = ({
  onRetryConnection,
  isRetrying = false,
  onConnectWifi,
  isConnectingWifi = false,
}) => {
  const handleOpenWifiSettings = async () => {
    if (Platform.OS === 'android') {
      try {
        await Linking.sendIntent('android.settings.WIFI_SETTINGS');
        return;
      } catch (err) {
        console.warn('sendIntent failed, falling back to openSettings:', err);
      }
    }
    try {
      await Linking.openSettings();
    } catch (err) {
      console.warn('Could not open device settings:', err);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>!</Text>
        </View>
        <Text style={styles.title}>Rescue Mesh Node Unreachable</Text>
      </View>

      <Text style={styles.subtitle}>
        The app communicates directly with the ESP32 mesh node over its local offline Wi-Fi access point.
      </Text>

      {/* 1-Tap Auto Connect Action */}
      {onConnectWifi && (
        <Pressable
          style={({ pressed }) => [
            styles.autoConnectButton,
            pressed && styles.buttonPressed,
            isConnectingWifi && styles.buttonDisabled,
          ]}
          onPress={onConnectWifi}
          disabled={isConnectingWifi}
          accessibilityRole="button"
          accessibilityLabel="Connect to RESCUE-MESH Wi-Fi"
        >
          {isConnectingWifi ? (
            <ActivityIndicator size="small" color="#000000" style={styles.buttonSpinner} />
          ) : (
            <Text style={styles.autoConnectButtonIcon}>⚡</Text>
          )}
          <Text style={styles.autoConnectButtonText}>
            {isConnectingWifi ? 'Connecting to RESCUE-MESH...' : 'Connect to RESCUE-MESH Wi-Fi'}
          </Text>
        </Pressable>
      )}

      <View style={styles.stepsList}>
        <View style={styles.stepItem}>
          <Text style={styles.stepNumber}>1</Text>
          <Text style={styles.stepText}>
            Connect your phone to Wi-Fi SSID:{' '}
            <Text style={styles.boldText}>RESCUE-MESH</Text>
          </Text>
        </View>

        <View style={styles.stepItem}>
          <Text style={styles.stepNumber}>2</Text>
          <Text style={styles.stepText}>
            If Android prompts <Text style={styles.italicText}>&quot;No internet, stay connected?&quot;</Text>, choose{' '}
            <Text style={styles.boldText}>YES / Stay connected</Text>.
          </Text>
        </View>

        <View style={styles.stepItem}>
          <Text style={styles.stepNumber}>3</Text>
          <Text style={styles.stepText}>
            <Text style={styles.boldText}>Turn off Mobile Data</Text> if Android routes traffic away from offline Wi-Fi.
          </Text>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [styles.actionButton, pressed && styles.buttonPressed]}
          onPress={handleOpenWifiSettings}
          accessibilityRole="button"
          accessibilityLabel="Open Wi-Fi Settings"
        >
          <Text style={styles.actionButtonText}>Open Wi-Fi Settings</Text>
        </Pressable>

        {onRetryConnection && (
          <Pressable
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              isRetrying && styles.buttonDisabled,
            ]}
            onPress={onRetryConnection}
            disabled={isRetrying}
            accessibilityRole="button"
            accessibilityLabel="Check Connection Now"
          >
            <Text style={styles.secondaryButtonText}>
              {isRetrying ? 'Checking...' : 'Check Connection'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E1414',
    borderColor: '#D32F2F',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    marginVertical: 12,
    marginHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF5252',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  iconText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '900',
  },
  title: {
    color: '#FF8A80',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subtitle: {
    color: '#D0D0D0',
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 14,
  },
  autoConnectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00E676',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    elevation: 3,
  },
  autoConnectButtonIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  autoConnectButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  buttonSpinner: {
    marginRight: 8,
  },
  stepsList: {
    gap: 10,
    marginBottom: 16,
  },
  stepItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#371818',
    color: '#FF8A80',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 20,
    marginRight: 10,
    marginTop: 1,
  },
  stepText: {
    flex: 1,
    color: '#EEEEEE',
    fontSize: 13,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  italicText: {
    fontStyle: 'italic',
    color: '#FFCDD2',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#2A1818',
    borderWidth: 1,
    borderColor: '#7A2222',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonText: {
    color: '#FFCDD2',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    flex: 1,
    minWidth: 130,
    backgroundColor: '#2A1818',
    borderWidth: 1,
    borderColor: '#7A2222',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: '#FFCDD2',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
