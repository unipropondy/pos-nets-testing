import { create } from "zustand";

export type OrderContext = {
  orderType: "DINE_IN" | "TAKEAWAY" | "MANUAL";
  section?: string;
  tableId?: string;
  tableNo?: string;
  tableName?: string;
  takeawayNo?: string;
  serverId?: number;
  serverName?: string;
};

type OrderContextState = {
  currentOrder: OrderContext | null;
  setOrderContext: (data: OrderContext) => void;
  clearOrderContext: () => void;
};

import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const useOrderContextStore = create<OrderContextState>()(
  persist(
    (set) => ({
      currentOrder: null,
      setOrderContext: (data) => set({ currentOrder: data }),
      clearOrderContext: () => set({ currentOrder: null }),
    }),
    {
      name: "order-context-storage",
      storage: createJSONStorage(() => 
        Platform.OS === 'web' ? window.localStorage : AsyncStorage
      ),
    }
  )
);

// Backwards compatibility for existing code that hasn't been migrated yet
export const getOrderContext = () => useOrderContextStore.getState().currentOrder;
export const setOrderContext = (data: OrderContext) => useOrderContextStore.getState().setOrderContext(data);
export const clearOrderContext = () => useOrderContextStore.getState().clearOrderContext();
