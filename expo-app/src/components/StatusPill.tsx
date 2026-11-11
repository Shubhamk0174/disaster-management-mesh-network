import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';

interface StatusPillProps {
  isConnected: boolean;
  nodeId: string | null;
  wifiClients?: number;
  isChecking?: boolean;
  isConnectingWifi?: boolean;
  onPress?: () => void;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  isConnected,
  nodeId,
  wifiClients = 0,
  isChecking = false,
  isConnectingWifi = false,
  onPress,
}) => {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        isConnected
          ? styles.connectedContainer
          : isConnectingWifi
          ? styles.connectingContainer
          : styles.disconnectedContainer,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        isConnected
          ? `Connected to ${nodeId || 'Rescue Mesh Node'}`
          : isConnectingWifi
          ? 'Connecting to RESCUE-MESH Wi-Fi...'
          : 'Not connected to Rescue Mesh node. Tap to retry.'
      }
    >
      <View
        style={[
          styles.dot,
          isConnected
            ? styles.connectedDot
            : isConnectingWifi
            ? styles.connectingDot
            : styles.disconnectedDot,
        ]}
      />

      <Text
        style={[
          styles.label,
          isConnected
            ? styles.connectedText
            : isConnectingWifi
            ? styles.connectingText
            : styles.disconnectedText,
        ]}
      >
        {isConnected
          ? `Connected to ${nodeId || 'Mesh Node'}`
          : isConnectingWifi
          ? 'Connecting to RESCUE-MESH...'
          : 'Not connected to Rescue Mesh node'}
      </Text>

      {isConnected && wifiClients > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{wifiClients} on AP</Text>
        </View>
      )}

      {(isChecking || isConnectingWifi) && (
        <ActivityIndicator
          size="small"
          color={isConnected ? '#00E676' : isConnectingWifi ? '#FFD54F' : '#FF5252'}
          style={styles.spinner}
        />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'center',
    maxWidth: '100%',
  },
  connectedContainer: {
    backgroundColor: 'rgba(0, 230, 118, 0.12)',
    borderColor: '#00E676',
  },
  connectingContainer: {
    backgroundColor: 'rgba(255, 213, 79, 0.12)',
    borderColor: '#FFD54F',
  },
  disconnectedContainer: {
    backgroundColor: 'rgba(255, 82, 82, 0.12)',
    borderColor: '#FF5252',
  },
  pressed: {
    opacity: 0.75,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 8,
  },
  connectedDot: {
    backgroundColor: '#00E676',
  },
  connectingDot: {
    backgroundColor: '#FFD54F',
  },
  disconnectedDot: {
    backgroundColor: '#FF5252',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  connectedText: {
    color: '#00E676',
  },
  connectingText: {
    color: '#FFD54F',
  },
  disconnectedText: {
    color: '#FF5252',
  },
  badge: {
    marginLeft: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    color: '#E0E0E0',
    fontWeight: '600',
  },
  spinner: {
    marginLeft: 8,
  },
});
