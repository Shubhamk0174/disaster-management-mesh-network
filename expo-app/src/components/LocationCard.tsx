import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { ActiveLocation, LocationCoordinates } from '../hooks/useLocation';

interface LocationCardProps {
  activeLocation: ActiveLocation;
  manualInput: string;
  setManualInput: (text: string) => void;
  manualError: string | null;
  gpsCoords: LocationCoordinates | null;
  isGpsLoading: boolean;
  gpsError: string | null;
  onRefreshGps: () => void;
  fallbackNodeLocation?: string;
}

export const LocationCard: React.FC<LocationCardProps> = ({
  activeLocation,
  manualInput,
  setManualInput,
  manualError,
  gpsCoords,
  isGpsLoading,
  gpsError,
  onRefreshGps,
  fallbackNodeLocation,
}) => {
  const getBadgeStyle = () => {
    switch (activeLocation.source) {
      case 'Manual':
        return styles.manualBadge;
      case 'Phone GPS':
        return styles.gpsBadge;
      case 'Node fallback':
      default:
        return styles.fallbackBadge;
    }
  };

  const getBadgeTextStyle = () => {
    switch (activeLocation.source) {
      case 'Manual':
        return styles.manualBadgeText;
      case 'Phone GPS':
        return styles.gpsBadgeText;
      case 'Node fallback':
      default:
        return styles.fallbackBadgeText;
    }
  };

  return (
    <View style={styles.card}>
      {/* Top Header with Active Source Badge */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>INCIDENT LOCATION</Text>
        <View style={[styles.badge, getBadgeStyle()]}>
          <Text style={[styles.badgeText, getBadgeTextStyle()]}>
            {activeLocation.source}
          </Text>
        </View>
      </View>

      {/* Primary Coordinates Box */}
      <View style={styles.coordsBox}>
        <Text style={styles.coordsMainText}>{activeLocation.formattedText}</Text>
        {activeLocation.accuracyText && (
          <Text style={styles.coordsSubText}>Accuracy: {activeLocation.accuracyText}</Text>
        )}
        {activeLocation.source === 'Node fallback' && fallbackNodeLocation && (
          <Text style={styles.fallbackNodeText}>Node Default: {fallbackNodeLocation}</Text>
        )}
        {activeLocation.failureReason && (
          <View style={styles.failureRow}>
            <Text style={styles.failureAlertText}>Notice: </Text>
            <Text style={styles.failureReasonText}>{activeLocation.failureReason}</Text>
          </View>
        )}
      </View>

      {/* Live GPS Status & Refresh */}
      <View style={styles.gpsRow}>
        <View style={styles.gpsStatusContainer}>
          <View
            style={[
              styles.gpsDot,
              gpsCoords
                ? styles.gpsDotSuccess
                : isGpsLoading
                ? styles.gpsDotLoading
                : styles.gpsDotError,
            ]}
          />
          <Text style={styles.gpsStatusLabel}>
            {isGpsLoading
              ? 'Acquiring GPS fix...'
              : gpsCoords
              ? `GPS Fixed (±${gpsCoords.accuracy ? Math.round(gpsCoords.accuracy) : 0}m)`
              : gpsError
              ? `GPS Error: ${gpsError}`
              : 'GPS unavailable'}
          </Text>
        </View>

        <Pressable
          onPress={onRefreshGps}
          disabled={isGpsLoading}
          style={({ pressed }) => [
            styles.refreshButton,
            pressed && styles.buttonPressed,
            isGpsLoading && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Refresh GPS location fix"
        >
          {isGpsLoading ? (
            <ActivityIndicator size="small" color="#00E676" />
          ) : (
            <Text style={styles.refreshButtonText}>Refresh GPS</Text>
          )}
        </Pressable>
      </View>

      {/* Manual Input Fallback Override */}
      <View style={styles.manualSection}>
        <Text style={styles.inputLabel}>Location (optional, if GPS fails)</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, manualError ? styles.inputError : null]}
            placeholder="lat, lon (e.g. 16.494485, 80.499179)"
            placeholderTextColor="#616161"
            value={manualInput}
            onChangeText={setManualInput}
            keyboardType="default"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {manualInput.length > 0 && (
            <Pressable
              onPress={() => setManualInput('')}
              style={styles.clearInputButton}
              accessibilityRole="button"
              accessibilityLabel="Clear manual coordinates"
            >
              <Text style={styles.clearInputText}>✕</Text>
            </Pressable>
          )}
        </View>
        {manualError ? (
          <Text style={styles.errorText}>{manualError}</Text>
        ) : manualInput.trim() ? (
          <Text style={styles.successOverrideText}>
            ✓ Valid manual override active (priority 1)
          </Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#16191D',
    borderColor: '#262D35',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerTitle: {
    color: '#90A4AE',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  manualBadge: {
    backgroundColor: 'rgba(33, 150, 243, 0.15)',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  manualBadgeText: {
    color: '#64B5F6',
  },
  gpsBadge: {
    backgroundColor: 'rgba(0, 230, 118, 0.15)',
    borderWidth: 1,
    borderColor: '#00E676',
  },
  gpsBadgeText: {
    color: '#00E676',
  },
  fallbackBadge: {
    backgroundColor: 'rgba(255, 179, 0, 0.15)',
    borderWidth: 1,
    borderColor: '#FFB300',
  },
  fallbackBadgeText: {
    color: '#FFCA28',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  coordsBox: {
    backgroundColor: '#0D0F11',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2328',
    marginBottom: 12,
  },
  coordsMainText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  coordsSubText: {
    color: '#00E676',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  fallbackNodeText: {
    color: '#FFB300',
    fontSize: 12,
    marginTop: 4,
  },
  failureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
  },
  failureAlertText: {
    color: '#FF8A80',
    fontSize: 12,
    fontWeight: '700',
  },
  failureReasonText: {
    color: '#CFD8DC',
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  gpsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#222830',
  },
  gpsStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  gpsDotSuccess: {
    backgroundColor: '#00E676',
  },
  gpsDotLoading: {
    backgroundColor: '#FFEB3B',
  },
  gpsDotError: {
    backgroundColor: '#FF5252',
  },
  gpsStatusLabel: {
    color: '#B0BEC5',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  refreshButton: {
    backgroundColor: '#20262E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#37474F',
    minWidth: 85,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: '#81C784',
    fontSize: 12,
    fontWeight: '700',
  },
  manualSection: {
    marginTop: 4,
  },
  inputLabel: {
    color: '#B0BEC5',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: '#0D0F11',
    borderWidth: 1,
    borderColor: '#262D35',
    borderRadius: 8,
    color: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'monospace',
    paddingRight: 36,
  },
  inputError: {
    borderColor: '#FF5252',
  },
  clearInputButton: {
    position: 'absolute',
    right: 10,
    padding: 6,
  },
  clearInputText: {
    color: '#757575',
    fontSize: 14,
    fontWeight: '700',
  },
  errorText: {
    color: '#FF5252',
    fontSize: 11.5,
    marginTop: 4,
    lineHeight: 16,
  },
  successOverrideText: {
    color: '#64B5F6',
    fontSize: 11.5,
    marginTop: 4,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

