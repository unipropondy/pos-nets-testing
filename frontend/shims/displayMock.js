const reactNative = require("react-native");

// 🛡️ ONLY apply mocks on Web / Electron!
// On native Android / iOS, real native modules exist. Modifying NativeModules or
// TurboModuleRegistry on Android breaks JSI native bindings and crashes the APK on startup.
if (reactNative && reactNative.Platform && reactNative.Platform.OS === "web") {
  const mockDisplayModule = {
    init: () => {},
    getInitialScreens: () => ({ SCREEN_INFO: {} }),
    SCREEN_INFO: {},
    requestScene: () => false,
    closeScene: () => false,
    isMainSceneActive: () => true,
    resumeMainScene: () => true,
    addListener: () => {},
    removeListeners: () => {},
  };

  if (reactNative.NativeModules) {
    try {
      const originalNativeModules = reactNative.NativeModules;
      
      const mockThermalPrinter = {
        printTcp: async () => {},
        printBluetooth: async () => {},
        printUsb: async () => {},
      };

      const nativeModulesProxy = new Proxy(originalNativeModules, {
        get(target, prop, receiver) {
          if (prop === "RNExternalDisplayEvent") {
            return mockDisplayModule;
          }
          if (prop === "ThermalPrinter") {
            return mockThermalPrinter;
          }
          return Reflect.get(target, prop, receiver);
        }
      });

      const descriptor = Object.getOwnPropertyDescriptor(reactNative, "NativeModules");
      if (!descriptor || descriptor.configurable) {
        Object.defineProperty(reactNative, "NativeModules", {
          value: nativeModulesProxy,
          configurable: true,
          writable: true,
        });
      } else {
        try {
          originalNativeModules.RNExternalDisplayEvent = mockDisplayModule;
          originalNativeModules.ThermalPrinter = mockThermalPrinter;
        } catch (mutateErr) {
          // Fallback silently if sealed
        }
      }
    } catch (e) {
      console.warn("⚠️ [DisplayMock] Failed to proxy NativeModules:", e.message);
    }
  }

  if (reactNative.TurboModuleRegistry && typeof reactNative.TurboModuleRegistry.get === "function") {
    try {
      const originalGet = reactNative.TurboModuleRegistry.get;
      reactNative.TurboModuleRegistry.get = (name) => {
        if (name === "RNExternalDisplayEvent") {
          return mockDisplayModule;
        }
        if (name === "ThermalPrinter") {
          return {
            printTcp: async () => {},
            printBluetooth: async () => {},
            printUsb: async () => {},
          };
        }
        return originalGet(name);
      };
    } catch (e) {
      console.warn("⚠️ [DisplayMock] Failed to patch TurboModuleRegistry:", e.message);
    }
  }
}
