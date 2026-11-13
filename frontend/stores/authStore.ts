import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { API_URL } from "../constants/Config";

/* ================= TYPES ================= */

export type UserRole = "ADMIN" | "CASHIER" | "MANAGER" | "SUPERVISOR" | "KDS" | "WAITER" | "OWNER";

export type AuthUser = {
  userId: string;
  userCode: string;
  userName: string;
  fullName: string;
  role: UserRole;
  roleName: string;
  userGroupId?: string;
  licenseFromDate?: string;
  licenseToDate?: string;
  allowedLogins?: number;
};

export type FormPermission = {
  canAdd: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canRead: boolean;
};

// Map of FormCode → permissions
export type PermissionsMap = Record<string, FormPermission>;

/* ============================================================
   FormCode → POS Screen mapping (from [dbo].[UserPermission])
   ============================================================
   OPRORD  → Ordering / Tables (main POS flow)
   RPTSAL  → Sales Report
   OPRMBR  → Members
   OPRTEN  → Time Entry / Attendance
   MSTTBL  → Lock Tables / Table Management
   OPRSTK  → KDS (Kitchen Display System / Stock)
   OPROLS  → Held Orders / Online Orders
   VWORDR  → Void Order
   OPRDED  → Daily End / Deductions
   SECUSR  → Security: Users (admin only)
   SECUGR  → Security: User Groups (admin only)
   SECPRM  → Security: Permissions (admin only)
   ============================================================ */

export const FORM_CODES = {
  ORDERING:     "OPRORD",  // Tables and ordering
  SALES_REPORT: "RPTSAL",  // Sales Report
  MEMBERS:      "OPRMBR",  // Members
  STAFF_ATTENDANCE: "OPRTEN",  // Staff Attendance
  TABLES:       "MSTTBL",  // Lock Tables
  KDS:          "OPRSTK",  // Kitchen Display / Stock
  HELD_ORDERS:  "OPROLS",  // Held Orders
  VOID_ORDER:   "VWORDR",  // Void Orders
  DAILY_END:    "OPRDED",  // Daily End
} as const;

export type AuthState = {
  user: AuthUser | null;
  sessionId: string | null;
  isLoggedIn: boolean;
  loginDate: string | null;
  permissions: PermissionsMap;
  permissionsLoaded: boolean;
  token: string | null;

  setUser: (
    user: AuthUser,
    token?: string,
    loginDate?: string | null,
    sessionId?: string | null
  ) => void;
  setSessionId: (sessionId: string | null) => void;
  setPermissions: (permissions: PermissionsMap) => void;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
  logout: () => void;

  // Low-level permission check by FormCode
  can: (formCode: string) => boolean;
  canDelete: (formCode: string) => boolean;

  // High-level screen access checks (mapped to FormCodes)
  canAccessOrdering: () => boolean;
  canAccessSalesReport: () => boolean;
  canAccessMembers: () => boolean;
  canAccessStaffAttendance: () => boolean;
  canAccessLockTables: () => boolean;
  canAccessKDS: () => boolean;
  canAccessHeldOrders: () => boolean;
  canVoidOrder: () => boolean;
  canAccessDayEnd: () => boolean;
  canAccessStoreSettings: () => boolean;
  canAccessReceiptSettings: () => boolean;
  canAccessWaiters: () => boolean;

  // Role helpers
  isAdmin: () => boolean;
  isManager: () => boolean;
  isSupervisor: () => boolean;
  isCashier: () => boolean;
  isWaiter: () => boolean;
  isKDS: () => boolean;
};

/* ================= HEARTBEAT TIMER ================= */
let heartbeatTimer: any = null;

const clearHeartbeatTimer = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
};

const sendHeartbeatPing = async () => {
  const state = useAuthStore.getState();
  if (!state.isLoggedIn || !state.user?.userId || !state.sessionId) {
    clearHeartbeatTimer();
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/auth/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: JSON.stringify({
        userId: state.user.userId,
        sessionId: state.sessionId,
      }),
    });

    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      if (data.sessionRevoked) {
        console.warn("⚠️ [AUTH] Device session was revoked or expired on server. Logging out.");
        useAuthStore.getState().logout();
      }
    }
  } catch (err) {
    // Network or temporary local wifi hiccup — will retry on next tick
    console.warn("⚠️ [AUTH] Heartbeat ping failed:", err);
  }
};

/* ================= STORE ================= */

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      isLoggedIn: false,
      loginDate: null,
      permissions: {},
      permissionsLoaded: false,
      token: null,

      setUser: (user, token, loginDate, sessionId) => {
        const nextSessionId = sessionId || get().sessionId || null;
        set({
          user,
          token: token || null,
          sessionId: nextSessionId,
          isLoggedIn: true,
          loginDate: loginDate || new Date().toISOString().split("T")[0],
        });
        get().startHeartbeat();
      },

      setSessionId: (sessionId) => set({ sessionId }),

      setPermissions: (permissions) => set({ permissions, permissionsLoaded: true }),

      startHeartbeat: () => {
        clearHeartbeatTimer();
        const { isLoggedIn, user, sessionId } = get();
        if (!isLoggedIn || !user?.userId || !sessionId) return;

        // Initial heartbeat after 2s
        setTimeout(sendHeartbeatPing, 2000);
        // Then every 45 seconds (server timeout is 300s)
        heartbeatTimer = setInterval(sendHeartbeatPing, 45000);
      },

      stopHeartbeat: () => {
        clearHeartbeatTimer();
      },

      logout: () => {
        clearHeartbeatTimer();
        const { user, sessionId, token } = get();
        if (user?.userId) {
          fetch(`${API_URL}/api/auth/logout`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              userId: user.userId,
              sessionId: sessionId || undefined,
            }),
          }).catch((e) => console.warn("⚠️ [AUTH] Server logout error:", e));
        }

        set({
          user: null,
          token: null,
          sessionId: null,
          isLoggedIn: false,
          permissions: {},
          permissionsLoaded: false,
          loginDate: null,
        });
      },

      /* ─── Low-level: check if user can READ a given FormCode ─── */
      can: (formCode) => {
        const { permissions, user } = get();
        if (user?.role === "ADMIN" || user?.role === "MANAGER") return true;
        const perm = permissions[formCode];
        return perm?.canRead === true;
      },

      canDelete: (formCode) => {
        const { permissions, user } = get();
        if (user?.role === "ADMIN" || user?.role === "MANAGER") return true;
        const perm = permissions[formCode];
        return perm?.canDelete === true;
      },

      /* ─── High-level screen access helpers ─── */
      canAccessOrdering:    () => get().can(FORM_CODES.ORDERING),
      canAccessSalesReport: () => get().can(FORM_CODES.SALES_REPORT),
      canAccessMembers:     () => get().can(FORM_CODES.MEMBERS),
      canAccessStaffAttendance:   () => get().can(FORM_CODES.STAFF_ATTENDANCE),
      canAccessLockTables:  () => get().can(FORM_CODES.TABLES),
      canAccessKDS:         () => get().can(FORM_CODES.KDS),
      canAccessHeldOrders:  () => get().can(FORM_CODES.HELD_ORDERS),
      canVoidOrder:         () => get().can(FORM_CODES.VOID_ORDER),
      canAccessDayEnd:      () => get().can(FORM_CODES.DAILY_END),
      canAccessStoreSettings: () => {
        const role = get().user?.role;
        return role === "ADMIN" || role === "MANAGER" || role === "OWNER" || role === "WAITER";
      },
      canAccessReceiptSettings: () => {
        const role = get().user?.role;
        return role === "ADMIN" || role === "MANAGER" || role === "OWNER" || role === "WAITER";
      },
      canAccessWaiters: () => {
        const role = get().user?.role;
        return role === "ADMIN" || role === "MANAGER" || role === "OWNER" || role === "WAITER";
      },

      /* ─── Role helpers ─── */
      isAdmin:      () => (get().user?.role || "").toUpperCase() === "ADMIN",
      isManager:    () => (get().user?.role || "").toUpperCase() === "MANAGER",
      isSupervisor: () => (get().user?.role || "").toUpperCase() === "SUPERVISOR",
      isCashier:    () => (get().user?.role || "").toUpperCase() === "CASHIER",
      isWaiter:     () => {
        const role = (get().user?.role || "").toUpperCase();
        const roleName = (get().user?.roleName || "").toUpperCase();
        return role === "WAITER" || roleName.includes("WAITER");
      },
      isKDS:        () => (get().user?.role || "").toUpperCase() === "KDS",
    }),
    {
      name: "auth-storage",
      storage: createJSONStorage(() =>
        Platform.OS === "web" ? window.sessionStorage : AsyncStorage
      ),
      // Only persist what's needed — no function fields
      partialize: (state) => ({
        user: state.user,
        sessionId: state.sessionId,
        isLoggedIn: state.isLoggedIn,
        permissions: state.permissions,
        permissionsLoaded: state.permissionsLoaded,
        token: state.token,
        loginDate: state.loginDate,
      }),
    }
  )
);
