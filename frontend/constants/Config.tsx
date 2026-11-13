import Constants from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEYS = {
  SERVER_HOST: "@smartpos_server_host",
  SERVER_PORT: "@smartpos_server_port",
  SERVER_PROTOCOL: "@smartpos_server_protocol",
};

// Default fallback IP when running on router or local counter PC
const DEFAULT_FALLBACK_IP = "192.168.0.229";
const DEFAULT_FALLBACK_PORT = "3000";

const getInitialLocalBackendIP = (): string => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.hostname || "localhost";
  }

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost;
  if (hostUri) {
    return hostUri.split(":")[0];
  }

  return DEFAULT_FALLBACK_IP;
};

export interface ServerConfig {
  host: string;
  port: string;
  protocol: string;
  fullUrl: string;
}

let currentHost = getInitialLocalBackendIP();
let currentPort = DEFAULT_FALLBACK_PORT;
let currentProtocol = "http";

export const buildFullUrl = (host: string, port?: string, protocol = "http"): string => {
  let cleanHost = (host || "").trim();
  let cleanPort = (port !== undefined ? port : "").trim();
  let cleanProtocol = protocol;

  if (cleanHost.startsWith("http://")) {
    cleanProtocol = "http";
    cleanHost = cleanHost.replace("http://", "");
  } else if (cleanHost.startsWith("https://")) {
    cleanProtocol = "https";
    cleanHost = cleanHost.replace("https://", "");
  }

  // Remove trailing slashes or paths
  cleanHost = cleanHost.replace(/\/.*$/, "");

  // If host includes a colon e.g. 192.168.1.100:3000
  if (cleanHost.includes(":")) {
    const parts = cleanHost.split(":");
    cleanHost = parts[0];
    if (!cleanPort && parts[1]) {
      cleanPort = parts[1];
    }
  }

  // Cloud/Railway domains without port specified
  const isCloudOrRailway =
    cleanHost.includes("railway.app") ||
    cleanHost.includes(".onrender.com") ||
    cleanHost.includes(".herokuapp.com") ||
    cleanHost.includes(".vercel.app");

  if (isCloudOrRailway && !cleanPort) {
    return `https://${cleanHost}`;
  }

  const portSuffix = cleanPort ? `:${cleanPort}` : "";
  return `${cleanProtocol}://${cleanHost}${portSuffix}`;
};

// Initial API_URL
export let API_URL: string = (Platform.OS === "web" && typeof window !== "undefined")
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : (process.env.EXPO_PUBLIC_API_URL ?? buildFullUrl(currentHost, currentPort, currentProtocol));

console.log(`🌐 [Config] Initial Local Server API: ${API_URL} | Platform: ${Platform.OS}`);

type ServerUrlListener = (newUrl: string, config: ServerConfig) => void;
const listeners: Set<ServerUrlListener> = new Set();

export const onServerUrlChange = (callback: ServerUrlListener): (() => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

export const getServerConfig = (): ServerConfig => ({
  host: currentHost,
  port: currentPort,
  protocol: currentProtocol,
  fullUrl: API_URL,
});

/**
 * Initializes and restores the saved server router IP & port from AsyncStorage.
 */
export const initServerConfig = async (): Promise<ServerConfig> => {
  try {
    const [savedHost, savedPort, savedProtocol] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST),
      AsyncStorage.getItem(STORAGE_KEYS.SERVER_PORT),
      AsyncStorage.getItem(STORAGE_KEYS.SERVER_PROTOCOL),
    ]);

    if (savedHost) {
      currentHost = savedHost.trim();
      currentPort = savedPort !== null ? savedPort.trim() : DEFAULT_FALLBACK_PORT;
      currentProtocol = savedProtocol ? savedProtocol.trim() : "http";

      const newUrl = buildFullUrl(currentHost, currentPort, currentProtocol);
      API_URL = newUrl;
      console.log(`🚀 [Config] Restored Saved Router Server Target: ${API_URL}`);

      listeners.forEach((fn) => fn(API_URL, getServerConfig()));
    }
  } catch (err) {
    console.warn("⚠️ [Config] Failed to load server config from storage:", err);
  }

  return getServerConfig();
};

/**
 * Tests connection to the target server IP/Host and port.
 */
export const testServerConnection = async (
  targetHost: string,
  targetPort?: string
): Promise<{ success: boolean; latencyMs: number; error?: string; serverInfo?: any }> => {
  const url = buildFullUrl(targetHost, targetPort);
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${url}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeoutId);

    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: true, latencyMs, serverInfo: data };
    } else {
      return {
        success: false,
        latencyMs,
        error: `Server responded with HTTP status ${res.status}`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const msg =
      err.name === "AbortError"
        ? "Connection timed out (no response after 6s)"
        : err.message || "Failed to reach server";
    return { success: false, latencyMs, error: msg };
  }
};

/**
 * Saves and applies new server IP address and port configuration.
 */
export const saveServerConfig = async (
  host: string,
  port?: string
): Promise<{ success: boolean; fullUrl: string }> => {
  try {
    let cleanHost = (host || "").trim();
    let cleanPort = (port !== undefined ? port : DEFAULT_FALLBACK_PORT).trim();
    let cleanProtocol = "http";

    if (cleanHost.startsWith("https://")) {
      cleanProtocol = "https";
      cleanHost = cleanHost.replace("https://", "");
    } else if (cleanHost.startsWith("http://")) {
      cleanProtocol = "http";
      cleanHost = cleanHost.replace("http://", "");
    }

    if (cleanHost.includes(":")) {
      const parts = cleanHost.split(":");
      cleanHost = parts[0];
      if (!cleanPort && parts[1]) cleanPort = parts[1];
    }

    currentHost = cleanHost;
    currentPort = cleanPort;
    currentProtocol = cleanProtocol;

    const newUrl = buildFullUrl(cleanHost, cleanPort, cleanProtocol);
    API_URL = newUrl;

    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.SERVER_HOST, cleanHost),
      AsyncStorage.setItem(STORAGE_KEYS.SERVER_PORT, cleanPort),
      AsyncStorage.setItem(STORAGE_KEYS.SERVER_PROTOCOL, cleanProtocol),
    ]);

    console.log(`💾 [Config] Saved and applied new Router Server Target: ${API_URL}`);
    listeners.forEach((fn) => fn(API_URL, getServerConfig()));

    // Try registering this client device to the local server database
    registerClientToLocalServer(newUrl).catch((e) =>
      console.warn("⚠️ Client auto-registration note:", e.message)
    );

    return { success: true, fullUrl: newUrl };
  } catch (err: any) {
    console.error("❌ [Config] Failed to save server config:", err);
    throw err;
  }
};

/**
 * Registers this device into the Counter PC / Local Server Database (TerminalMaster).
 */
export const registerClientToLocalServer = async (serverUrl: string) => {
  try {
    const deviceType = Platform.OS === "android" ? "TABLET" : "CLIENT";
    const deviceName = `${Platform.OS.toUpperCase()}_CLIENT_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const res = await fetch(`${serverUrl}/api/terminal/register-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceName,
        deviceIp: "Router Wi-Fi Client",
        deviceType,
        platform: Platform.OS,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log("✅ [Client Registration] Successfully registered with local server DB:", data);
    }
  } catch (e: any) {
    // Non-fatal, registration will retry on next connect
  }
};
