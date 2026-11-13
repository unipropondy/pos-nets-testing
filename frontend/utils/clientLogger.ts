import { Platform } from "react-native";
import { API_URL } from "../constants/Config";

let queue: Array<{ level: string; message: string; details?: any }> = [];
let timer: any = null;
let isSending = false;

const flush = async () => {
  if (queue.length === 0 || isSending) return;
  // Cap at 20 logs per batch to prevent large payloads
  const batch = queue.splice(0, 20);
  isSending = true;

  try {
    // Send batch in a single HTTP request
    await fetch(`${API_URL}/api/logs/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    }).catch(() => {});
  } catch {
    // Ignore network errors when shipping logs
  } finally {
    isSending = false;
    if (queue.length > 0) {
      scheduleFlush();
    }
  }
};

const scheduleFlush = () => {
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 1500);
  }
};

export const logger = {
  info: (message: string, details?: any) => {
    if (queue.length < 100) {
      queue.push({ level: "INFO", message, details });
      scheduleFlush();
    }
  },
  warn: (message: string, details?: any) => {
    if (queue.length < 100) {
      queue.push({ level: "WARN", message, details });
      scheduleFlush();
    }
  },
  error: (message: string, details?: any) => {
    if (queue.length < 100) {
      queue.push({ level: "ERROR", message, details });
      scheduleFlush();
    }
  },
  debug: (message: string, details?: any) => {
    if (queue.length < 100) {
      queue.push({ level: "DEBUG", message, details });
      scheduleFlush();
    }
  },
};

// Intercepts browser console errors and sends them in batches to backend for writing to logs/frontend/frontend-YYYY-MM-DD.log
export function initClientLogger() {
  if (Platform.OS !== "web" || typeof window === "undefined") return;

  const originalLog = window.console.log;
  const originalWarn = window.console.warn;
  const originalError = window.console.error;

  const formatArgs = (args: any[]) => {
    return args
      .map((a) => {
        if (a instanceof Error) return `${a.message}\n${a.stack}`;
        if (typeof a === "object") {
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        }
        return String(a);
      })
      .join(" ");
  };

  // Routine console.log stays in browser DevTools — DO NOT flood HTTP connections
  window.console.log = (...args: any[]) => {
    originalLog(...args);
  };

  // Routine console.warn stays in browser DevTools
  window.console.warn = (...args: any[]) => {
    originalWarn(...args);
  };

  // Ship genuine console.error messages
  window.console.error = (...args: any[]) => {
    originalError(...args);
    const msg = formatArgs(args);
    // Ignore internal logger endpoints, retry pings, and transient network errors to avoid feedback loops
    if (
      msg.includes("/api/logs/client") ||
      msg.includes("/health") ||
      msg.includes("[Fetch ") ||
      msg.includes("Failed to fetch") ||
      msg.includes("AbortError") ||
      msg.includes("signal is aborted") ||
      msg.includes("[KeepAlive]")
    ) {
      return;
    }
    if (queue.length < 100) {
      queue.push({ level: "ERROR", message: msg });
      scheduleFlush();
    }
  };

  // Global uncaught errors
  window.addEventListener("error", (event) => {
    const msg = String(event.message || '');
    if (
      msg.includes("AbortError") ||
      msg.includes("signal is aborted") ||
      msg.includes("ResizeObserver loop") ||
      msg.includes("Failed to fetch")
    ) {
      return;
    }
    if (queue.length < 100) {
      queue.push({
        level: "FATAL",
        message: `Uncaught Error: ${event.message} at ${event.filename}:${event.lineno}`,
      });
      scheduleFlush();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reasonMsg = String(event.reason?.message || event.reason || '');
    if (
      reasonMsg.includes("AbortError") ||
      reasonMsg.includes("signal is aborted") ||
      reasonMsg.includes("Network request failed") ||
      reasonMsg.includes("Failed to fetch")
    ) {
      return;
    }
    if (queue.length < 100) {
      queue.push({
        level: "FATAL",
        message: `Unhandled Promise Rejection: ${event.reason}`,
      });
      scheduleFlush();
    }
  });

  // Flush remaining logs before page unload or visibility change
  if (typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", () => {
      if (queue.length > 0 && typeof navigator !== "undefined" && navigator.sendBeacon) {
        try {
          const blob = new Blob([JSON.stringify(queue)], { type: "application/json" });
          navigator.sendBeacon(`${API_URL}/api/logs/client`, blob);
        } catch { }
      }
    });
  }

  // Record initial frontend startup log
  logger.info("Smart POS Frontend Logging Initialized", {
    platform: Platform.OS,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    timestamp: new Date().toISOString()
  });
}
