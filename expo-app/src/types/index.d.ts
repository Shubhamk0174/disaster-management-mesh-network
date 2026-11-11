declare module 'react-native-wifi-reborn' {
  export interface WifiEntry {
    SSID: string;
    BSSID: string;
    capabilities: string;
    frequency: number;
    level: number;
    timestamp: number;
  }

  export interface WifiSuggestionConfig {
    ssid: string;
    password?: string;
    isWpa3?: boolean;
    isAppInteractionRequired?: boolean;
  }

  const WifiManager: {
    forceWifiUsage(useWifi: boolean): Promise<void>;
    isEnabled(): Promise<boolean>;
    setEnabled(enabled: boolean): Promise<void>;
    getCurrentWifiSSID(): Promise<string>;
    connectToProtectedSSID(
      ssid: string,
      password: string,
      isWEP: boolean,
      isHidden?: boolean
    ): Promise<string>;
    disconnect(): Promise<boolean>;
    connectionStatus(): Promise<boolean>;
    suggestWifiNetwork(
      networkConfigs: WifiSuggestionConfig[]
    ): Promise<string>;
  };

  export default WifiManager;
}
