import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { PRESS_HOLD_DURATION_MS } from '../config';

interface SOSButtonProps {
  onTrigger: () => void;
  disabled?: boolean;
  isSending?: boolean;
  isWaitingAck?: boolean;
  cooldownSecondsLeft?: number;
}

const BUTTON_SIZE = 230;
const STROKE_WIDTH = 8;
const RADIUS = BUTTON_SIZE / 2; // 115
const INNER_SIZE = BUTTON_SIZE - STROKE_WIDTH * 2 - 10; // ~204

export const SOSButton: React.FC<SOSButtonProps> = ({
  onTrigger,
  disabled = false,
  isSending = false,
  isWaitingAck = false,
  cooldownSecondsLeft = 0,
}) => {
  const [progress, setProgress] = useState<number>(0);
  const [isPressing, setIsPressing] = useState<boolean>(false);

  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const isCooldown = cooldownSecondsLeft > 0;
  const isBusy = isSending || isWaitingAck;
  const isButtonDisabled = disabled || isBusy || isCooldown;

  // Pulse animation when idle and ready
  useEffect(() => {
    if (!isButtonDisabled) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.03,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isButtonDisabled, pulseAnim]);

  const clearHold = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setProgress(0);
    setIsPressing(false);
  }, []);

  const handlePressIn = useCallback(() => {
    if (isButtonDisabled) return;

    setIsPressing(true);
    startTimeRef.current = Date.now();

    // Light impact haptic when user starts pressing
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {
      // Haptics optional
    }

    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const currentProgress = Math.min(1, elapsed / PRESS_HOLD_DURATION_MS);
      setProgress(currentProgress);

      if (currentProgress >= 1) {
        clearHold();
        // Heavy success haptic notification on hold completion
        try {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        } catch {
          // ignore
        }
        onTrigger();
      }
    }, 16);
  }, [isButtonDisabled, clearHold, onTrigger]);

  const handlePressOut = useCallback(() => {
    clearHold();
  }, [clearHold]);

  useEffect(() => {
    return () => {
      if (holdIntervalRef.current) {
        clearInterval(holdIntervalRef.current);
      }
    };
  }, []);

  // Calculate rotation angles for pure React Native 360° circular progress ring
  // Right half sweeps from -135deg to +45deg (0% to 50%)
  // Left half sweeps from -135deg to +45deg (50% to 100%)
  const rightAngle =
    progress <= 0.5
      ? -135 + (progress / 0.5) * 180
      : 45;

  const leftAngle =
    progress > 0.5
      ? -135 + ((progress - 0.5) / 0.5) * 180
      : -135;

  // Determine button title & subtext
  let title = 'SOS';
  let subtitle = 'HOLD 1.5s';

  if (isCooldown) {
    title = `${cooldownSecondsLeft}s`;
    subtitle = 'COOLDOWN';
  } else if (isSending) {
    title = 'SENDING';
    subtitle = 'To Node...';
  } else if (isWaitingAck) {
    title = 'WAITING';
    subtitle = 'LoRa ACK';
  } else if (isPressing) {
    subtitle = `${Math.round(progress * 100)}%`;
  }

  return (
    <View style={styles.outerContainer}>
      <Animated.View
        style={[
          styles.animatedWrapper,
          {
            transform: [{ scale: pulseAnim }],
          },
        ]}
      >
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={isButtonDisabled}
          style={({ pressed }) => [
            styles.touchableArea,
            isButtonDisabled && styles.touchableDisabled,
            pressed && !isButtonDisabled && styles.touchablePressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="SOS Emergency Button. Press and hold for 1.5 seconds to send emergency alert."
          accessibilityState={{ disabled: isButtonDisabled }}
        >
          {/* Background Track Ring */}
          <View style={styles.trackRing} />

          {/* Pure React Native Circular Progress Ring (Zero external dependencies) */}
          {progress > 0 && (
            <View style={styles.progressContainer}>
              {/* Right Half Ring (0% - 50%) */}
              <View style={styles.halfContainerRight}>
                <View
                  style={[
                    styles.progressHalfCircle,
                    styles.progressRightCircle,
                    { transform: [{ rotate: `${rightAngle}deg` }] },
                  ]}
                />
              </View>

              {/* Left Half Ring (50% - 100%) */}
              <View style={styles.halfContainerLeft}>
                <View
                  style={[
                    styles.progressHalfCircle,
                    styles.progressLeftCircle,
                    { transform: [{ rotate: `${leftAngle}deg` }] },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Inner Circular Button Core */}
          <View
            style={[
              styles.innerCircle,
              isButtonDisabled ? styles.innerCircleDisabled : styles.innerCircleActive,
              isPressing && styles.innerCirclePressing,
            ]}
          >
            <Text style={[styles.mainText, isButtonDisabled && styles.textDisabled]}>
              {title}
            </Text>
            <Text style={[styles.subText, isButtonDisabled && styles.textDisabled]}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 18,
  },
  animatedWrapper: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchableArea: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  touchableDisabled: {
    opacity: 0.65,
  },
  touchablePressed: {
    transform: [{ scale: 0.98 }],
  },
  trackRing: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: RADIUS,
    borderWidth: STROKE_WIDTH,
    borderColor: '#3B1212',
  },
  progressContainer: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
  },
  halfContainerRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: RADIUS,
    height: BUTTON_SIZE,
    overflow: 'hidden',
  },
  halfContainerLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RADIUS,
    height: BUTTON_SIZE,
    overflow: 'hidden',
  },
  progressHalfCircle: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: RADIUS,
    borderWidth: STROKE_WIDTH,
  },
  progressRightCircle: {
    right: 0,
    top: 0,
    borderTopColor: '#FFEB3B',
    borderRightColor: '#FFEB3B',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  progressLeftCircle: {
    left: 0,
    top: 0,
    borderTopColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFEB3B',
    borderLeftColor: '#FFEB3B',
  },
  innerCircle: {
    width: INNER_SIZE,
    height: INNER_SIZE,
    borderRadius: INNER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  innerCircleActive: {
    backgroundColor: '#D32F2F',
    borderWidth: 2,
    borderColor: '#FF5252',
  },
  innerCircleDisabled: {
    backgroundColor: '#421616',
    borderWidth: 2,
    borderColor: '#5C2222',
    shadowOpacity: 0.1,
  },
  innerCirclePressing: {
    backgroundColor: '#B71C1C',
    borderColor: '#FFD600',
  },
  mainText: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-black' }),
  },
  subText: {
    color: '#FFEAEA',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  textDisabled: {
    color: '#8A6868',
  },
});
