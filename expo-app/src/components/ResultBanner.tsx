import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { SOSStatus } from '../hooks/useSOS';

interface ResultBannerProps {
  status: SOSStatus;
  errorMessage: string | null;
  waitingSecondsElapsed: number;
  cooldownSecondsLeft: number;
  onRetry: () => void;
  onDismiss?: () => void;
}

export const ResultBanner: React.FC<ResultBannerProps> = ({
  status,
  errorMessage,
  waitingSecondsElapsed,
  cooldownSecondsLeft,
  onRetry,
  onDismiss,
}) => {
  if (status === 'idle') {
    return (
      <View style={[styles.container, styles.idleContainer]}>
        <View style={styles.idleDot} />
        <Text style={styles.idleText}>
          Ready. Hold red button for 1.5 seconds to broadcast SOS.
        </Text>
      </View>
    );
  }

  if (status === 'locating') {
    return (
      <View style={[styles.container, styles.busyContainer]}>
        <ActivityIndicator size="small" color="#00E676" style={styles.spinner} />
        <View style={styles.textColumn}>
          <Text style={styles.busyTitle}>Acquiring GPS Fix</Text>
          <Text style={styles.busySubtitle}>Securing high accuracy coordinates before transmission...</Text>
        </View>
      </View>
    );
  }

  if (status === 'sending') {
    return (
      <View style={[styles.container, styles.busyContainer]}>
        <ActivityIndicator size="small" color="#FFEB3B" style={styles.spinner} />
        <View style={styles.textColumn}>
          <Text style={styles.busyTitle}>Sending SOS to Node</Text>
          <Text style={styles.busySubtitle}>Dispatching emergency alert to ESP32 mesh node (192.168.4.1)...</Text>
        </View>
      </View>
    );
  }

  if (status === 'waitingAck') {
    return (
      <View style={[styles.container, styles.waitingContainer]}>
        <ActivityIndicator size="small" color="#FFA000" style={styles.spinner} />
        <View style={styles.textColumn}>
          <Text style={styles.waitingTitle}>Transmitting over LoRa Mesh</Text>
          <Text style={styles.waitingSubtitle}>
            SOS accepted by node! Waiting for rescue team ACK... ({waitingSecondsElapsed}s elapsed)
          </Text>
          <Text style={styles.waitingHint}>
            Node is broadcasting over LoRa frequency. Please stay connected to Wi-Fi.
          </Text>
        </View>
      </View>
    );
  }

  if (status === 'confirmed') {
    return (
      <View style={[styles.container, styles.confirmedContainer]}>
        <View style={styles.checkIconWrapper}>
          <Text style={styles.checkIconText}>✓</Text>
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.confirmedTitle}>DELIVERED & CONFIRMED</Text>
          <Text style={styles.confirmedSubtitle}>
            Your emergency SOS was acknowledged by the rescue team over the LoRa mesh network!
          </Text>
          {cooldownSecondsLeft > 0 ? (
            <Text style={styles.cooldownNote}>
              Node cooldown active: {cooldownSecondsLeft}s remaining
            </Text>
          ) : (
            onDismiss && (
              <Pressable onPress={onDismiss} style={styles.dismissButton}>
                <Text style={styles.dismissButtonText}>Dismiss Confirmation</Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    );
  }

  if (status === 'failed') {
    return (
      <View style={[styles.container, styles.failedContainer]}>
        <View style={styles.alertIconWrapper}>
          <Text style={styles.alertIconText}>✕</Text>
        </View>
        <View style={styles.textColumn}>
          <Text style={styles.failedTitle}>DELIVERY NOT CONFIRMED</Text>
          <Text style={styles.failedSubtitle}>
            {errorMessage || 'No confirmation received from the rescue team.'}
          </Text>
          <Pressable
            onPress={onRetry}
            disabled={cooldownSecondsLeft > 0}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.buttonPressed,
              cooldownSecondsLeft > 0 && styles.retryButtonDisabled,
            ]}
          >
            <Text style={styles.retryButtonText}>
              {cooldownSecondsLeft > 0
                ? `Wait Cooldown (${cooldownSecondsLeft}s)`
                : 'RETRY SOS NOW'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === 'cooldown') {
    return (
      <View style={[styles.container, styles.cooldownContainer]}>
        <View style={styles.textColumn}>
          <Text style={styles.cooldownTitle}>Node Cooldown Active</Text>
          <Text style={styles.cooldownSubtitle}>
            Please wait {cooldownSecondsLeft}s before sending another alert.
          </Text>
        </View>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 10,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1.5,
  },
  textColumn: {
    flex: 1,
  },
  spinner: {
    marginRight: 12,
    marginTop: 2,
  },
  idleContainer: {
    backgroundColor: '#181C20',
    borderColor: '#2D3540',
    alignItems: 'center',
    paddingVertical: 12,
  },
  idleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00E676',
    marginRight: 10,
  },
  idleText: {
    color: '#B0BEC5',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  busyContainer: {
    backgroundColor: '#1E242B',
    borderColor: '#37474F',
  },
  busyTitle: {
    color: '#ECEFF1',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  busySubtitle: {
    color: '#B0BEC5',
    fontSize: 13,
    lineHeight: 18,
  },
  waitingContainer: {
    backgroundColor: '#261C02',
    borderColor: '#FFA000',
  },
  waitingTitle: {
    color: '#FFD54F',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  waitingSubtitle: {
    color: '#FFF8E1',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    marginBottom: 4,
  },
  waitingHint: {
    color: '#FFE082',
    fontSize: 11.5,
    fontStyle: 'italic',
  },
  confirmedContainer: {
    backgroundColor: '#002B11',
    borderColor: '#00E676',
    borderWidth: 2,
    elevation: 4,
  },
  checkIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#00E676',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  checkIconText: {
    color: '#000000',
    fontSize: 20,
    fontWeight: '900',
  },
  confirmedTitle: {
    color: '#00E676',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  confirmedSubtitle: {
    color: '#E8F5E9',
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
  },
  cooldownNote: {
    marginTop: 8,
    fontSize: 12,
    color: '#81C784',
    fontStyle: 'italic',
  },
  dismissButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: '#00E676',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  dismissButtonText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '700',
  },
  failedContainer: {
    backgroundColor: '#260B0B',
    borderColor: '#FF1744',
    borderWidth: 2,
    elevation: 4,
  },
  alertIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FF1744',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  alertIconText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
  },
  failedTitle: {
    color: '#FF5252',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  failedSubtitle: {
    color: '#FFEBEE',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#FF1744',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'flex-start',
    alignItems: 'center',
  },
  retryButtonDisabled: {
    backgroundColor: '#522020',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cooldownContainer: {
    backgroundColor: '#1E1924',
    borderColor: '#7E57C2',
  },
  cooldownTitle: {
    color: '#B39DDB',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  cooldownSubtitle: {
    color: '#EDE7F6',
    fontSize: 12.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
});

