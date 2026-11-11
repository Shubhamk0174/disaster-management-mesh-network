import { useState, useRef, useEffect, useCallback } from 'react';
import { sendSOS, getAckStatus, AckStatus, NodeApiError, ensureWifiBound } from '../api/node';
import { ActiveLocation } from './useLocation';
import {
  ACK_POLL_INTERVAL_MS,
  ACK_TOTAL_POLL_TIMEOUT_MS,
  SOS_COOLDOWN_MS,
} from '../config';

export type SOSStatus =
  | 'idle'
  | 'locating'
  | 'sending'
  | 'waitingAck'
  | 'confirmed'
  | 'failed'
  | 'cooldown';

export interface UseSOSReturn {
  status: SOSStatus;
  errorMessage: string | null;
  cooldownSecondsLeft: number;
  waitingSecondsElapsed: number;
  ackStatus: AckStatus | null;
  isBusySending: boolean;
  canSendSOS: boolean;
  triggerSOS: (location: ActiveLocation, mobile: string, msg: string) => Promise<void>;
  retrySOS: (location: ActiveLocation, mobile: string, msg: string) => Promise<void>;
  resetSOS: () => void;
}

export function useSOS(): UseSOSReturn {
  const [status, setStatus] = useState<SOSStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cooldownSecondsLeft, setCooldownSecondsLeft] = useState<number>(0);
  const [waitingSecondsElapsed, setWaitingSecondsElapsed] = useState<number>(0);
  const [ackStatus, setAckStatus] = useState<AckStatus | null>(null);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Clear all background polling & timers
  const clearTimers = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollCapTimerRef.current) {
      clearTimeout(pollCapTimerRef.current);
      pollCapTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  // Start the 10-second cooldown timer
  const startCooldown = useCallback((initialSeconds = SOS_COOLDOWN_MS / 1000) => {
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
    }

    setCooldownSecondsLeft(initialSeconds);

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownSecondsLeft((prev) => {
        if (prev <= 1) {
          if (cooldownIntervalRef.current) {
            clearInterval(cooldownIntervalRef.current);
            cooldownIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Poll /api/ack-status every 1.5s until confirmed, failed, or 30s timeout cap reached
  const startAckPolling = useCallback(() => {
    clearTimers();
    setWaitingSecondsElapsed(0);

    const startTime = Date.now();

    // Track elapsed seconds
    elapsedTimerRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setWaitingSecondsElapsed(elapsed);
    }, 1000);

    // 30-second total polling timeout cap
    pollCapTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      clearTimers();
      setStatus('failed');
      setErrorMessage(
        'No confirmation received after 30s. The SOS may still have reached rescue teams over LoRa. You can retry.'
      );
      startCooldown();
    }, ACK_TOTAL_POLL_TIMEOUT_MS);

    // Polling function
    const checkAck = async () => {
      try {
        const result = await getAckStatus();
        if (!isMountedRef.current) return;
        setAckStatus(result);

        // Case 1: ACK confirmed by rescue team
        if (result.ackReceived) {
          clearTimers();
          setStatus('confirmed');
          setErrorMessage(null);
          startCooldown();
          return;
        }

        // Case 2: Delivery failed after node LoRa retries
        if (result.sosWasSent && !result.waitingForAck && !result.ackReceived) {
          clearTimers();
          setStatus('failed');
          setErrorMessage(
            'SOS delivery failed: Node exhausted LoRa retries without receiving confirmation.'
          );
          startCooldown();
          return;
        }

        // Case 3: Node busy transmitting LoRa or still waiting -> continue polling
      } catch (err) {
        // Fetch failed or timed out: treat as ESP32 busy transmitting LoRa
        console.warn('ACK status poll busy/timeout:', err);
      }
    };

    // First check after interval
    pollIntervalRef.current = setInterval(checkAck, ACK_POLL_INTERVAL_MS);
  }, [clearTimers, startCooldown]);

  // Main trigger function
  const triggerSOS = useCallback(
    async (location: ActiveLocation, mobile: string, msg: string) => {
      if (status === 'sending' || status === 'waitingAck' || cooldownSecondsLeft > 0) {
        return;
      }

      clearTimers();
      setErrorMessage(null);
      setAckStatus(null);
      setStatus('sending');

      try {
        await ensureWifiBound();

        const payload = {
          latitude: location.latitude,
          longitude: location.longitude,
          mobile: mobile.trim(),
          msg: msg.trim(),
        };

        const response = await sendSOS(payload);

        if (!isMountedRef.current) return;

        if (response.status === 202) {
          // Accepted by ESP32 node -> wait for LoRa mesh ACK
          setStatus('waitingAck');
          startAckPolling();
        }
      } catch (err) {
        if (!isMountedRef.current) return;

        if (err instanceof NodeApiError) {
          if (err.status === 409) {
            // SOS already in progress on node
            setStatus('waitingAck');
            startAckPolling();
            return;
          }
          if (err.status === 429) {
            // Cooldown active
            setStatus('cooldown');
            setErrorMessage('Node cooldown active (10s between SOS requests). Please wait.');
            startCooldown();
            return;
          }
        }

        const msgStr = err instanceof Error ? err.message : 'Failed to reach node at 192.168.4.1';
        setStatus('failed');
        setErrorMessage(`${msgStr}. Check that you are connected to the RESCUE-MESH Wi-Fi network.`);
        startCooldown(5);
      }
    },
    [status, cooldownSecondsLeft, clearTimers, startAckPolling, startCooldown]
  );

  const retrySOS = useCallback(
    async (location: ActiveLocation, mobile: string, msg: string) => {
      await triggerSOS(location, mobile, msg);
    },
    [triggerSOS]
  );

  const resetSOS = useCallback(() => {
    clearTimers();
    setStatus('idle');
    setErrorMessage(null);
    setAckStatus(null);
  }, [clearTimers]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearTimers();
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
      }
    };
  }, [clearTimers]);

  const isBusySending = status === 'sending' || status === 'waitingAck';
  const canSendSOS = !isBusySending && cooldownSecondsLeft === 0;

  return {
    status,
    errorMessage,
    cooldownSecondsLeft,
    waitingSecondsElapsed,
    ackStatus,
    isBusySending,
    canSendSOS,
    triggerSOS,
    retrySOS,
    resetSOS,
  };
}
