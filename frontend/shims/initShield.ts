// 🛡️ Bulletproof Global Crash Shield for Android Release APK
// Must be evaluated BEFORE any other imports to protect the React Native JS runtime.

if (typeof global !== "undefined") {
  const g = global as any;

  // Intercept unhandled JS exceptions so Android never invokes NativeExceptionsManager.reportFatalException() and killProcess()
  if (g.ErrorUtils && typeof g.ErrorUtils.setGlobalHandler === "function") {
    const defaultHandler = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      try {
        console.warn("🛡️ [GlobalShield] Neutralized unhandled JS error:", error?.message || String(error));
      } catch {}
      // In production release builds on native Android, NEVER pass isFatal: true to defaultHandler!
      // Passing isFatal causes React Native to terminate the OS process with "Smart POS keeps stopping".
      if (__DEV__ && defaultHandler) {
        try {
          defaultHandler(error, false);
        } catch {}
      }
    });
  }

  // Intercept unhandled Promise rejections
  if (typeof g.onunhandledrejection === "undefined" || g.onunhandledrejection === null) {
    g.onunhandledrejection = (event: any) => {
      try {
        console.warn("🛡️ [GlobalShield] Neutralized unhandled promise rejection:", event?.reason?.message || String(event?.reason));
      } catch {}
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
    };
  }
}

export {};
