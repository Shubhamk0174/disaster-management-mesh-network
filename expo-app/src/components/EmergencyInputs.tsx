import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { MAX_MOBILE_LENGTH, MAX_MSG_LENGTH } from '../config';

interface EmergencyInputsProps {
  mobile: string;
  setMobile: (value: string) => void;
  msg: string;
  setMsg: (value: string) => void;
  disabled?: boolean;
}

export const EmergencyInputs: React.FC<EmergencyInputsProps> = ({
  mobile,
  setMobile,
  msg,
  setMsg,
  disabled = false,
}) => {
  const handleMobileChange = (text: string) => {
    // Digits only, max 12 chars
    const digitsOnly = text.replace(/\D/g, '').slice(0, MAX_MOBILE_LENGTH);
    setMobile(digitsOnly);
  };

  const handleMsgChange = (text: string) => {
    // Strip quotes and backslashes to avoid breaking ESP32 naive JSON parser
    const cleanText = text.replace(/["\\]/g, '').slice(0, MAX_MSG_LENGTH);
    setMsg(cleanText);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>SITUATION DETAILS (OPTIONAL)</Text>

      {/* Mobile Number Input */}
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Mobile Number</Text>
          <Text style={styles.counter}>
            {mobile.length} / {MAX_MOBILE_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[styles.input, disabled && styles.inputDisabled]}
          placeholder="Digits only (e.g. 9876543210)"
          placeholderTextColor="#616161"
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={handleMobileChange}
          maxLength={MAX_MOBILE_LENGTH}
          editable={!disabled}
        />
      </View>

      {/* Short Emergency Message Input */}
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Short Message</Text>
          <Text style={styles.counter}>
            {msg.length} / {MAX_MSG_LENGTH}
          </Text>
        </View>
        <TextInput
          style={[styles.input, styles.multilineInput, disabled && styles.inputDisabled]}
          placeholder="e.g. Trapped on 2nd floor, water rising"
          placeholderTextColor="#616161"
          multiline
          numberOfLines={2}
          value={msg}
          onChangeText={handleMsgChange}
          maxLength={MAX_MSG_LENGTH}
          editable={!disabled}
        />
        <Text style={styles.helperText}>
          Quotes ( &quot; ) &amp; backslashes ( \ ) auto-stripped for LoRa packet transmission.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#16191D',
    borderColor: '#262D35',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  sectionTitle: {
    color: '#90A4AE',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
  },
  inputGroup: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: '#B0BEC5',
    fontSize: 13,
    fontWeight: '600',
  },
  counter: {
    color: '#78909C',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
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
  },
  multilineInput: {
    minHeight: 52,
    textAlignVertical: 'top',
  },
  inputDisabled: {
    opacity: 0.5,
  },
  helperText: {
    color: '#78909C',
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

