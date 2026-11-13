/**
 * useCustomerDisplay
 * Safe stub preventing native crashes on devices without external display
 */
export interface DisplayInfo {
  id: string;
  width: number;
  height: number;
}

export function useCustomerDisplay(): {
  displays: DisplayInfo[];
  isConnected: boolean;
} {
  return {
    displays: [],
    isConnected: false,
  };
}
