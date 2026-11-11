import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getStatus,
  ensureWifiBound,
  autoConnectToMeshWifi,
  NodeStatus,
} from '../api/node';
import { STATUS_POLL_INTERVAL_MS } from '../config';

export interface UseNodeConnectionReturn {
  isConnected: boolean;
  nodeId: string | null;
  waitingForAck: boolean;
  wifiClients: number;
  fallbackLocation: string;
  isChecking: boolean;
  isConnectingWifi: boolean;
  lastChecked: Date | null;
  errorReason: string | null;
  checkConnection: () => Promise<boolean>;
  connectWifi: () => Promise<boolean>;
}

export function useNodeConnection(): UseNodeConnectionReturn {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [waitingForAck, setWaitingForAck] = useState<boolean>(false);
  const [wifiClients, setWifiClients] = useState<number>(0);
  const [fallbackLocation, setFallbackLocation] = useState<string>('');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isConnectingWifi, setIsConnectingWifi] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [errorReason, setErrorReason] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  const hasAutoConnectedRef = useRef<boolean>(false);

  const checkConnection = useCallback(async (): Promise<boolean> => {
    setIsChecking(true);
    try {
      await ensureWifiBound();
      const status: NodeStatus = await getStatus();
      if (!isMountedRef.current) return true;

      setIsConnected(true);
      setNodeId(status.node);
      setWaitingForAck(status.waitingForAck);
      setWifiClients(status.wifiClients);
      setFallbackLocation(status.fallbackLocation);
      setErrorReason(null);
      setLastChecked(new Date());
      return true;
    } catch (err) {
      if (!isMountedRef.current) return false;

      setIsConnected(false);
      setNodeId(null);
      const message = err instanceof Error ? err.message : 'Node unreachable';
      setErrorReason(message);
      setLastChecked(new Date());
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsChecking(false);
      }
    }
  }, []);

  const connectWifi = useCallback(async (): Promise<boolean> => {
    setIsConnectingWifi(true);
    try {
      const result = await autoConnectToMeshWifi();
      if (!isMountedRef.current) return result.success;

      if (result.success) {
        // Allow brief moment for network binding, then check connection
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return await checkConnection();
      } else {
        setErrorReason(result.message);
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auto-connect failed';
      if (isMountedRef.current) {
        setErrorReason(msg);
      }
      return false;
    } finally {
      if (isMountedRef.current) {
        setIsConnectingWifi(false);
      }
    }
  }, [checkConnection]);

  useEffect(() => {
    isMountedRef.current = true;

    // Initial check on mount
    checkConnection().then((connected) => {
      // If not connected on startup, automatically attempt Wi-Fi connection once
      if (!connected && !hasAutoConnectedRef.current && isMountedRef.current) {
        hasAutoConnectedRef.current = true;
        connectWifi();
      }
    });

    // Heartbeat every 5 seconds
    const interval = setInterval(() => {
      checkConnection();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [checkConnection, connectWifi]);

  return {
    isConnected,
    nodeId,
    waitingForAck,
    wifiClients,
    fallbackLocation,
    isChecking,
    isConnectingWifi,
    lastChecked,
    errorReason,
    checkConnection,
    connectWifi,
  };
}
