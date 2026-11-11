import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StatusPill } from '../components/StatusPill';
import { SOSButton } from '../components/SOSButton';
import { ResultBanner } from '../components/ResultBanner';
import { LocationCard } from '../components/LocationCard';
import { EmergencyInputs } from '../components/EmergencyInputs';
import { HintCard } from '../components/HintCard';
import { useNodeConnection } from '../hooks/useNodeConnection';
import { useLocation } from '../hooks/useLocation';
import { useSOS } from '../hooks/useSOS';

export const RescueMeshScreen: React.FC = () => {
  // Inputs state
  const [mobile, setMobile] = useState<string>('');
  const [msg, setMsg] = useState<string>('');

  // Node connection hook (checks /api/status every 5s, handles Wi-Fi auto-connect)
  const {
    isConnected,
    nodeId,
    wifiClients,
    fallbackLocation,
    isChecking,
    isConnectingWifi,
    checkConnection,
    connectWifi,
  } = useNodeConnection();

  // Location hook (handles GPS priority, 15s timeout, manual override, status)
  const {
    activeLocation,
    manualInput,
    setManualInput,
    manualError,
    gpsCoords,
    isGpsLoading,
    gpsError,
    refreshGps,
  } = useLocation();

  // SOS state machine hook (handles idle -> sending -> waitingAck -> confirmed/failed)
  const {
    status: sosStatus,
    errorMessage,
    cooldownSecondsLeft,
    waitingSecondsElapsed,
    triggerSOS,
    retrySOS,
    resetSOS,
    isBusySending,
  } = useSOS();

  const handleSOSTrigger = useCallback(() => {
    triggerSOS(activeLocation, mobile, msg);
  }, [triggerSOS, activeLocation, mobile, msg]);

  const handleRetry = useCallback(() => {
    retrySOS(activeLocation, mobile, msg);
  }, [retrySOS, activeLocation, mobile, msg]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Section */}
          <View style={styles.header}>
            <Text style={styles.appTitle}>RESCUE MESH</Text>
            <Text style={styles.appSubtitle}>Emergency Communication Node</Text>
            <View style={styles.statusPillWrapper}>
              <StatusPill
                isConnected={isConnected}
                nodeId={nodeId}
                wifiClients={wifiClients}
                isChecking={isChecking}
                isConnectingWifi={isConnectingWifi}
                onPress={isConnected ? checkConnection : connectWifi}
              />
            </View>
          </View>

          {/* Hint Card when Node is Unreachable */}
          {!isConnected && (
            <HintCard
              onRetryConnection={checkConnection}
              isRetrying={isChecking}
              onConnectWifi={connectWifi}
              isConnectingWifi={isConnectingWifi}
            />
          )}

          {/* Result / Confirmation Area */}
          <ResultBanner
            status={sosStatus}
            errorMessage={errorMessage}
            waitingSecondsElapsed={waitingSecondsElapsed}
            cooldownSecondsLeft={cooldownSecondsLeft}
            onRetry={handleRetry}
            onDismiss={resetSOS}
          />

          {/* Large SOS Button (230px, 1.5s press-and-hold progress ring) */}
          <View style={styles.sosSection}>
            <SOSButton
              onTrigger={handleSOSTrigger}
              disabled={isBusySending}
              isSending={sosStatus === 'sending'}
              isWaitingAck={sosStatus === 'waitingAck'}
              cooldownSecondsLeft={cooldownSecondsLeft}
            />
          </View>

          {/* Incident Location Card */}
          <LocationCard
            activeLocation={activeLocation}
            manualInput={manualInput}
            setManualInput={setManualInput}
            manualError={manualError}
            gpsCoords={gpsCoords}
            isGpsLoading={isGpsLoading}
            gpsError={gpsError}
            onRefreshGps={refreshGps}
            fallbackNodeLocation={fallbackLocation}
          />

          {/* Optional User Details (Mobile & Short Message) */}
          <EmergencyInputs
            mobile={mobile}
            setMobile={setMobile}
            msg={msg}
            setMsg={setMsg}
            disabled={isBusySending}
          />

          {/* Node Diagnostics Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerNote}>
              Direct Wi-Fi Link • LoRa 868/915 MHz Mesh • No Internet Required
            </Text>
            <Text style={styles.footerSubNote}>
              All payload cryptography and packet signing handled on node hardware.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#101214',
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  appTitle: {
    color: '#FF1744',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2.5,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-black' }),
  },
  appSubtitle: {
    color: '#90A4AE',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginTop: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  statusPillWrapper: {
    marginTop: 12,
  },
  sosSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    marginTop: 16,
    marginBottom: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  footerNote: {
    color: '#607D8B',
    fontSize: 11.5,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  footerSubNote: {
    color: '#455A64',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
});
