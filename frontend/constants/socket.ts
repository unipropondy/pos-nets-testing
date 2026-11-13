import { io, Socket } from "socket.io-client";
import { API_URL, onServerUrlChange } from "./Config";

// Lazy-initialized singleton — the io() call is deferred until the socket is
// first accessed so it never blocks module evaluation (avoids the 6000ms
// React Native bridge timeout that fires when this module is imported at
// the top level during static rendering or on app startup).
const globalAny: any = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};
let _socket: Socket | null = globalAny._globalSocket || null;

function createSocketInstance(url: string): Socket {
  const s = io(url, {
    transports: ["websocket", "polling"],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 15000,
    autoConnect: true,
    forceNew: true,
  });

  s.on("connect", () => {
    console.log("🔌 [Socket] Connected successfully to:", url, "| id:", s?.id);
  });

  s.on("connect_error", (error) => {
    console.warn("🔌 [Socket] Connection error:", error.message);
  });

  return s;
}

function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = createSocketInstance(API_URL);
  globalAny._globalSocket = _socket;
  return _socket;
}

// Automatically reconnect socket when server IP/URL is reconfigured
onServerUrlChange((newUrl) => {
  console.log("🔄 [Socket] Reconnecting socket to new Server Target:", newUrl);
  if (_socket) {
    try {
      _socket.removeAllListeners();
      _socket.disconnect();
    } catch (e) {}
  }
  _socket = createSocketInstance(newUrl);
  globalAny._globalSocket = _socket;
});

export const socket: Socket = new Proxy({} as Socket, {
  get(_target, prop) {
    return (getSocket() as any)[prop];
  },
  set(_target, prop, value) {
    (getSocket() as any)[prop] = value;
    return true;
  },
});

