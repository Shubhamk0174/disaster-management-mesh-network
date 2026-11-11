import { useState, useEffect, useCallback, useMemo } from 'react';
import * as Location from 'expo-location';
import { GPS_TIMEOUT_MS, COORDINATE_DECIMALS } from '../config';

export type LocationSource = 'Manual' | 'Phone GPS' | 'Node fallback';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface ActiveLocation {
  source: LocationSource;
  latitude?: number;
  longitude?: number;
  formattedText: string;
  accuracyText: string | null;
  failureReason: string | null;
}

export interface UseLocationReturn {
  activeLocation: ActiveLocation;
  manualInput: string;
  setManualInput: (text: string) => void;
  manualError: string | null;
  gpsCoords: LocationCoordinates | null;
  isGpsLoading: boolean;
  gpsError: string | null;
  refreshGps: () => Promise<void>;
}

export function useLocation(): UseLocationReturn {
  // Manual input state
  const [manualInput, setManualInput] = useState<string>('');
  const [manualCoords, setManualCoords] = useState<LocationCoordinates | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  // GPS state
  const [gpsCoords, setGpsCoords] = useState<LocationCoordinates | null>(null);
  const [isGpsLoading, setIsGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Parse and validate manual input whenever it changes
  useEffect(() => {
    const trimmed = manualInput.trim();
    if (!trimmed) {
      setManualCoords(null);
      setManualError(null);
      return;
    }

    const parts = trimmed.split(',');
    if (parts.length !== 2) {
      setManualCoords(null);
      setManualError('Enter coordinates as: lat, lon (e.g. 16.494485, 80.499179)');
      return;
    }

    const lat = parseFloat(parts[0].trim());
    const lon = parseFloat(parts[1].trim());

    if (isNaN(lat) || isNaN(lon) || !isFinite(lat) || !isFinite(lon)) {
      setManualCoords(null);
      setManualError('Latitude and longitude must be valid numbers');
      return;
    }

    if (lat < -90 || lat > 90) {
      setManualCoords(null);
      setManualError('Latitude must be between -90 and 90');
      return;
    }

    if (lon < -180 || lon > 180) {
      setManualCoords(null);
      setManualError('Longitude must be between -180 and 180');
      return;
    }

    setManualCoords({
      latitude: Number(lat.toFixed(COORDINATE_DECIMALS)),
      longitude: Number(lon.toFixed(COORDINATE_DECIMALS)),
    });
    setManualError(null);
  }, [manualInput]);

  // GPS Fetch with high accuracy and 15s timeout, falling back to last known position
  const refreshGps = useCallback(async () => {
    setIsGpsLoading(true);
    setGpsError(null);

    try {
      // 1. Request foreground permissions
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setGpsError('Permission denied: Enable location permission in app settings');
        setGpsCoords(null);
        return;
      }

      // 2. Check if location services are enabled on device
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setGpsError('GPS off: Turn on device location services in Android settings');
        setGpsCoords(null);
        return;
      }

      // 3. Attempt high-accuracy GPS with 15s timeout
      const highAccuracyPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('GPS timeout: Fix took longer than 15s')), GPS_TIMEOUT_MS);
      });

      let position: Location.LocationObject | null = null;
      try {
        position = await Promise.race([highAccuracyPromise, timeoutPromise]);
      } catch (timeoutErr) {
        // High accuracy timed out -> attempt fallback to last known position
        console.warn('High accuracy GPS timed out, falling back to last known position:', timeoutErr);
        position = await Location.getLastKnownPositionAsync();
        if (!position) {
          setGpsError('GPS timeout (15s): Could not acquire satellite fix and no cached position available');
          setGpsCoords(null);
          return;
        }
      }

      if (position && position.coords) {
        setGpsCoords({
          latitude: Number(position.coords.latitude.toFixed(COORDINATE_DECIMALS)),
          longitude: Number(position.coords.longitude.toFixed(COORDINATE_DECIMALS)),
          accuracy: position.coords.accuracy ?? undefined,
        });
        setGpsError(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to acquire location';
      setGpsError(message);
      setGpsCoords(null);
    } finally {
      setIsGpsLoading(false);
    }
  }, []);

  // Trigger GPS acquisition on mount so coordinates are ready when SOS is needed
  useEffect(() => {
    refreshGps();
  }, [refreshGps]);

  // Determine active location by strict priority:
  // 1. Manual coordinates (if valid)
  // 2. Phone GPS (if available)
  // 3. Node fixed fallback
  const activeLocation = useMemo<ActiveLocation>(() => {
    if (manualCoords) {
      return {
        source: 'Manual',
        latitude: manualCoords.latitude,
        longitude: manualCoords.longitude,
        formattedText: `${manualCoords.latitude.toFixed(6)}, ${manualCoords.longitude.toFixed(6)}`,
        accuracyText: 'User defined override',
        failureReason: null,
      };
    }

    if (gpsCoords) {
      const acc = gpsCoords.accuracy ? `±${Math.round(gpsCoords.accuracy)}m` : null;
      return {
        source: 'Phone GPS',
        latitude: gpsCoords.latitude,
        longitude: gpsCoords.longitude,
        formattedText: `${gpsCoords.latitude.toFixed(6)}, ${gpsCoords.longitude.toFixed(6)}`,
        accuracyText: acc,
        failureReason: null,
      };
    }

    // Node fallback
    let failureReason = 'Using node fixed location';
    if (manualInput.trim() && manualError) {
      failureReason = `Manual location invalid: ${manualError}`;
    } else if (gpsError) {
      failureReason = gpsError;
    } else if (isGpsLoading) {
      failureReason = 'Acquiring GPS fix...';
    }

    return {
      source: 'Node fallback',
      latitude: undefined,
      longitude: undefined,
      formattedText: "Using node's fixed location",
      accuracyText: null,
      failureReason,
    };
  }, [manualCoords, manualInput, manualError, gpsCoords, gpsError, isGpsLoading]);

  return {
    activeLocation,
    manualInput,
    setManualInput,
    manualError,
    gpsCoords,
    isGpsLoading,
    gpsError,
    refreshGps,
  };
}

