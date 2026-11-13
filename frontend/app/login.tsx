import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ServerConnectionModal } from "@/components/ServerConnectionModal";

/* ============ ROLE CONFIG ============ */

const ROLE_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  ADMIN:      { color: "#DC2626", icon: "shield-checkmark", label: "Administrator" },
  MANAGER:    { color: "#7C3AED", icon: "briefcase",        label: "Manager" },
  SUPERVISOR: { color: "#0891B2", icon: "eye",              label: "Supervisor" },
  CASHIER:    { color: Theme.primary, icon: "cash",         label: "Cashier" },
  KDS:        { color: "#10B981", icon: "restaurant",       label: "Kitchen" },
};

export default function LoginScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setPermissions = useAuthStore((s) => s.setPermissions);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isLockedError, setIsLockedError] = useState(false);
  const [canForceUnlock, setCanForceUnlock] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [serverModalVisible, setServerModalVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // ✅ Check if already logged in and redirect
      const { user, loginDate, logout } = useAuthStore.getState();
      if (user) {
        const currentDate = new Date().toISOString().split("T")[0];
        if (loginDate && currentDate !== loginDate) {
          logout();
        } else {
          const userName = (user.userName || "").trim().toUpperCase();
          const userRole = (user.role || "").trim().toUpperCase();
          const roleName = (user.roleName || "").trim().toUpperCase();
          const isWaiter = userRole === "WAITER" || roleName.includes("WAITER");

          if (user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
            router.replace("/sales-report");
          } else if (userName === "KDS" || userRole === "KDS") {
            router.replace("/kds" as any);
          } else if (isWaiter) {
            router.replace("/(tabs)/category" as any);
          } else {
            router.replace("/(tabs)/category" as any);
          }
          return;
        }
      }

      // Reset state on focus
      setError("");
      setLoading(false);

      // ✅ Load Remembered Credentials
      const loadRemembered = async () => {
        try {
          const saved = await AsyncStorage.getItem("remembered_creds");
          if (saved) {
            const { u, p } = JSON.parse(saved);
            setUserName(u || "");
            setPassword(p || "");
            setRememberMe(true);
          }
        } catch (e) {}
      };
      loadRemembered();

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start();
    }, [fadeAnim, slideAnim]),
  );

  const shakeError = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,   duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleForceUnlock = async () => {
    if (!userName.trim()) {
      setError("Please enter your User ID first to force unlock.");
      return;
    }
    setUnlocking(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/force-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: userName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setIsLockedError(false);
        setCanForceUnlock(false);
        setError("");
        Alert.alert("Sessions Cleared", "All active sessions have been unlocked. You may now sign in.");
      } else {
        setError(data.message || "Failed to unlock account sessions.");
      }
    } catch {
      setError("Could not reach server to unlock account.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleLogin = async () => {
    if (!userName.trim() || !password.trim()) {
      setError("Please enter both User ID and Password.");
      shakeError();
      return;
    }

    setLoading(true);
    setError("");
    setIsLockedError(false);
    setCanForceUnlock(false);

    try {
      const clientSessionId = useAuthStore.getState().sessionId;
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: userName.trim(),
          password,
          sessionId: clientSessionId || undefined,
        }),
      });
      const data = await response.json();

      if (data.success && data.user) {
        if (!data.user.userGroupId || String(data.user.userGroupId).trim() === "" || String(data.user.userGroupId).trim().toUpperCase() === "NULL") {
          setError("User has no valid group assigned.");
          shakeError();
          setLoading(false);
          return;
        }
        setUser(data.user, data.token, null, data.sessionId);

        // ✅ Handle Remember Me Persistence
        try {
          if (rememberMe) {
            await AsyncStorage.setItem("remembered_creds", JSON.stringify({ u: userName.trim(), p: password }));
          } else {
            await AsyncStorage.removeItem("remembered_creds");
          }
        } catch (e) {}

        // Fetch role-based permissions from DB immediately after login
        try {
          const permRes = await fetch(`${API_URL}/api/auth/permissions/${data.user.role}`);
          if (permRes.ok) {
            const permData = await permRes.json();
            setPermissions(permData);
          }
        } catch {
          setPermissions({});
        }

        // ✅ Role-Based Navigation
        const role = (data.user.role || "").trim().toUpperCase();
        const roleName = (data.user.roleName || "").trim().toUpperCase();
        const isWaiter = role === "WAITER" || roleName.includes("WAITER");

        if (data.user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
          router.replace("/sales-report");
        } else if (role === "KDS") {
          router.replace("/(tabs)/kds" as any);
        } else if (isWaiter) {
          router.replace("/(tabs)/category" as any);
        } else {
          router.replace("/(tabs)/category" as any); // Default for Admin, Manager, Cashier
        }
      } else {
        if (response.status === 409 || data.isLocked) {
          setIsLockedError(true);
          setCanForceUnlock(Boolean(data.canForceUnlock));
          setError(data.message || `User reached max allowed logins (${data.allowedLogins || 1} device(s)).`);
        } else {
          setCanForceUnlock(false);
          setError(data.message || "Login failed. Please try again.");
        }
        shakeError();
      }
    } catch (err: any) {
      console.error("❌ [Login Network Failure Details]:", {
        endpoint: `${API_URL}/api/auth/login`,
        message: err?.message || err,
        stack: err?.stack,
        errorObject: err,
        timestamp: new Date().toISOString()
      });
      setError("Cannot connect to server. Tap 'Server Setup' to verify IP.");
      shakeError();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Background */}
      <LinearGradient colors={[Theme.primary, "#1A1A1A"]} style={StyleSheet.absoluteFill}>
        <View style={[styles.bgCircle, styles.bgCircle1]} />
        <View style={[styles.bgCircle, styles.bgCircle2]} />
      </LinearGradient>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              isLandscape && { paddingVertical: 20 }
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.centeredContent}>
              <Animated.View
                style={[
                  styles.content,
                  { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
                  isLandscape && { maxWidth: 480 }
                ]}
              >
                {/* Logo */}
                <View style={[styles.logoWrap, isLandscape && { marginBottom: 15, flexDirection: 'row', gap: 15 }]}>
                  <View style={[styles.logoBadge, isLandscape && { width: 50, height: 50, borderRadius: 15, marginBottom: 0 }]}>
                    <Image 
                      source={require("../assets/images/logo_pos.png")} 
                      style={{ width: isLandscape ? 40 : 70, height: isLandscape ? 40 : 70, borderRadius: isLandscape ? 12 : 20 }}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={isLandscape && { alignItems: 'flex-start' }}>
                    <Text style={[styles.appName, isLandscape && { fontSize: 20 }]}>Smart POS</Text>
                    <Text style={[styles.appTagline, isLandscape && { fontSize: 11, marginTop: 0 }]}>Point of Sale System</Text>
                  </View>
                </View>


                {/* Card */}
                <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }, isLandscape && { padding: 20 }]}>
                  <View style={styles.cardHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>Sign In</Text>
                      <Text style={styles.cardSubtitle}>Enter your credentials to continue</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.serverSetupBadge}
                      onPress={() => setServerModalVisible(true)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="server-outline" size={15} color="#A855F7" />
                      <Text style={styles.serverSetupBadgeText}>Server Setup</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Error Banner */}
                  {error !== "" && (
                    <View style={{ marginBottom: 16 }}>
                      <TouchableOpacity
                        style={styles.errorBanner}
                        onPress={() => {
                          if (error.includes("Server Setup") || error.includes("connect")) {
                            setServerModalVisible(true);
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="alert-circle" size={16} color="#DC2626" />
                        <Text style={styles.errorText}>{error}</Text>
                      </TouchableOpacity>
                      {isLockedError && canForceUnlock && (
                        <TouchableOpacity
                          style={{
                            marginTop: 8,
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            backgroundColor: "#FEF2F2",
                            borderWidth: 1,
                            borderColor: "#FCA5A5",
                            borderRadius: 10,
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                          onPress={handleForceUnlock}
                          disabled={unlocking}
                          activeOpacity={0.8}
                        >
                          {unlocking ? (
                            <ActivityIndicator size="small" color="#DC2626" />
                          ) : (
                            <>
                              <Ionicons name="flash-outline" size={16} color="#DC2626" />
                              <Text style={{ color: "#DC2626", fontWeight: "bold", fontSize: 13 }}>
                                Force Unlock All Device Sessions
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  {/* User ID */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>User ID</Text>
                    <View style={styles.inputRow}>
                      <Ionicons name="person-outline" size={18} color={Theme.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Enter your User ID"
                        placeholderTextColor={Theme.textMuted}
                        value={userName}
                        onChangeText={(t) => { setUserName(t); setError(""); setIsLockedError(false); setCanForceUnlock(false); }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                    </View>
                  </View>

                  {/* Password */}
                  <View style={[styles.inputGroup, isLandscape && { marginBottom: 12 }]}>
                    <Text style={styles.inputLabel}>Password</Text>
                    <View style={styles.inputRow}>
                      <Ionicons name="lock-closed-outline" size={18} color={Theme.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { flex: 1 }]}
                        placeholder="Enter your Password"
                        placeholderTextColor={Theme.textMuted}
                        value={password}
                        onChangeText={(t) => { setPassword(t); setError(""); }}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                      />
                      <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                        <Ionicons
                          name={showPassword ? "eye-off-outline" : "eye-outline"}
                          size={20}
                          color={Theme.textMuted}
                        />
                      </Pressable>
                    </View>
                  </View>

                  {/* Remember Me */}
                  <TouchableOpacity 
                    style={styles.rememberRow}
                    onPress={() => setRememberMe(!rememberMe)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                      {rememberMe && <Ionicons name="checkmark" size={14} color="#FFF" />}
                    </View>
                    <Text style={styles.rememberText}>Remember Me</Text>
                  </TouchableOpacity>

                  {/* Login Button */}
                  <TouchableOpacity
                    style={[styles.button, loading && styles.buttonLoading, isLandscape && { height: 50, marginTop: 4 }]}
                    onPress={handleLogin}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <>
                        <Ionicons name="log-in-outline" size={22} color="#fff" />
                        <Text style={styles.buttonText}>Sign In</Text>
                      </>
                    )}
                  </TouchableOpacity>

                </Animated.View>

                {/* Footer */}
                <Text style={styles.footerText}>© 2026 Unipro Softwares SG Pte Ltd</Text>
              </Animated.View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* 🌐 Server Connection Setup Modal */}
      <ServerConnectionModal
        visible={serverModalVisible}
        onClose={() => setServerModalVisible(false)}
        onSaved={() => setError("")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: Theme.primary },
  safeArea:       { flex: 1 },
  keyboardView:   { flex: 1 },
  scrollContent:  { flexGrow: 1 },
  centeredContent: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20 },

  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  serverSetupBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(168, 85, 247, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.25)",
    marginTop: 2,
  },
  serverSetupBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7E22CE",
  },
  content:        { width: "100%", maxWidth: 440, alignItems: "center" },

  bgCircle:   { position: "absolute", borderRadius: 999 },
  bgCircle1:  { width: 300, height: 300, backgroundColor: "rgba(255,255,255,0.08)", top: -60, left: -60 },
  bgCircle2:  { width: 420, height: 420, backgroundColor: "rgba(0,0,0,0.08)", bottom: -100, right: -80 },

  logoWrap:   { alignItems: "center", marginBottom: 28 },
  logoBadge:  {
    width: 88, height: 88, borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center", alignItems: "center",
    marginBottom: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)",
  },
  appName:     { color: "#fff", fontSize: 28, fontFamily: Fonts.black, letterSpacing: -0.5 },
  appTagline:  { color: "rgba(255,255,255,0.6)", fontSize: 13, fontFamily: Fonts.medium, marginTop: 4 },

  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 28,
    padding: 28,
    ...Theme.shadowLg,
  },
  cardTitle:    { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black, marginBottom: 4 },
  cardSubtitle: { color: Theme.textMuted, fontSize: 13, fontFamily: Fonts.medium, marginBottom: 20 },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 16, borderWidth: 1, borderColor: "#FECACA",
  },
  errorText: { color: "#DC2626", fontSize: 13, fontFamily: Fonts.medium, flex: 1 },

  inputGroup:  { marginBottom: 16 },
  inputLabel:  { color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.bold, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Theme.bgMain, borderRadius: 14,
    borderWidth: 1.5, borderColor: Theme.border,
    paddingHorizontal: 14, height: 52,
  },
  inputIcon:   { marginRight: 10 },
  input:       { flex: 1, color: Theme.textPrimary, fontSize: 16, fontFamily: Fonts.medium, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  eyeBtn:      { padding: 4 },

  button: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 10, backgroundColor: Theme.primary, height: 58,
    borderRadius: 16, marginTop: 8, ...Theme.shadowMd, shadowColor: Theme.primary,
  },
  buttonLoading: { opacity: 0.75 },
  buttonText:    { color: "#fff", fontSize: 18, fontFamily: Fonts.black },

  rolesRow:   { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 20, justifyContent: "center" },
  roleChip:   { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  roleChipText: { fontSize: 10, fontFamily: Fonts.bold },

  footerText: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: Fonts.medium, marginTop: 24 },

  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
    paddingLeft: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  checkboxActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  rememberText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
});

