import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { useToast } from "../components/Toast";
import { API_URL } from "../constants/Config";

interface CommLog {
  id: string;
  timestamp: string;
  direction: "TX" | "RX" | "ERR" | "INFO";
  title: string;
  data: any;
}

export default function NetsAdminScreen() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // Terminal Configuration
  const [terminalIp, setTerminalIp] = useState("192.168.9.38");
  const [terminalPort, setTerminalPort] = useState("7500");
  const [financialTimeout, setFinancialTimeout] = useState("120");
  const [adminTimeout, setAdminTimeout] = useState("35");
  const [ecrRefFieldCode, setEcrRefFieldCode] = useState<"HD" | "HS">("HD");
  const [currentEcn, setCurrentEcn] = useState("1");

  // Status & Results
  const [lastResult, setLastResult] = useState<any>(null);
  const [commLogs, setCommLogs] = useState<CommLog[]>([]);

  // End of Day Progress
  const [eodProgress, setEodProgress] = useState<{
    running: boolean;
    step: number;
    stepName: string;
    status: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    fetchConfig();
    fetchLogs();
    const interval = setInterval(fetchLogs, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${API_URL}/api/nets/config`);
      const data = await res.json();
      if (data.success && data.config) {
        setTerminalIp(data.config.terminalIp || "192.168.9.38");
        setTerminalPort(String(data.config.terminalPort || 7500));
        setFinancialTimeout(String(Math.round((data.config.financialTimeoutMs || 120000) / 1000)));
        setAdminTimeout(String(Math.round((data.config.adminTimeoutMs || 35000) / 1000)));
        setEcrRefFieldCode((data.config.ecrRefFieldCode || "HD").toUpperCase() === "HS" ? "HS" : "HD");
        if (data.currentEcn) setCurrentEcn(data.currentEcn);
      }
    } catch (err: any) {
      console.warn("Failed to fetch NETS config:", err.message);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/nets/logs`);
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setCommLogs(data.logs);
      }
    } catch (err) {
      // Ignore poll error
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/nets/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminalIp: terminalIp.trim(),
          terminalPort: parseInt(terminalPort, 10),
          financialTimeoutMs: parseInt(financialTimeout, 10) * 1000,
          adminTimeoutMs: parseInt(adminTimeout, 10) * 1000,
          ecrRefFieldCode,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("NETS configuration saved successfully", "success");
      } else {
        showToast(data.error || "Failed to save configuration", "error");
      }
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const runNetsAction = async (endpoint: string, actionName: string, body = {}) => {
    setActiveAction(actionName);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/nets/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setLastResult({ action: actionName, timestamp: new Date().toLocaleTimeString(), data });
      fetchLogs();

      if (data.success) {
        showToast(`${actionName}: ${data.description || "Success"}`, "success");
      } else {
        showToast(`${actionName}: ${data.error || data.description || "Failed"}`, "error");
      }
    } catch (err: any) {
      setLastResult({ action: actionName, timestamp: new Date().toLocaleTimeString(), error: err.message });
      showToast(`${actionName} Error: ${err.message}`, "error");
    } finally {
      setActiveAction(null);
      setLoading(false);
    }
  };

  const triggerEndOfDay = () => {
    Alert.alert(
      "Run End-of-Day Settlement",
      "This will execute the mandatory NETS UAT sequence:\n\n1. Credit Card Settlement (I5 - DBS)\n2. NETS Settlement (81)\n3. NETS Logon (80)\n4. TMS / CTS Update (84)\n\nwith 20-second delays between each step. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start EOD",
          onPress: async () => {
            setEodProgress({
              running: true,
              step: 1,
              stepName: "Starting",
              status: "running",
              message: "Initiating End-of-Day sequence...",
            });
            await runNetsAction("end-of-day", "End of Day Settlement");
            setEodProgress(null);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>NETS ECR II Administration</Text>
          <Text style={styles.headerSubtitle}>Ingenico DESK/5000 (LAN TCP/IP)</Text>
        </View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => { fetchConfig(); fetchLogs(); }}>
          <Ionicons name="refresh" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        {/* Terminal Configuration Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="hardware-chip-outline" size={20} color={Theme.colors.primary} />
            <Text style={styles.cardTitle}>Terminal Network Connection</Text>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 2, marginRight: 8 }]}>
              <Text style={styles.inputLabel}>Terminal IP Address</Text>
              <TextInput
                style={styles.input}
                value={terminalIp}
                onChangeText={setTerminalIp}
                placeholder="192.168.9.38"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Port</Text>
              <TextInput
                style={styles.input}
                value={terminalPort}
                onChangeText={setTerminalPort}
                placeholder="7500"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
              <Text style={styles.inputLabel}>Financial Timeout (sec)</Text>
              <TextInput
                style={styles.input}
                value={financialTimeout}
                onChangeText={setFinancialTimeout}
                placeholder="120"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Admin Timeout (sec)</Text>
              <TextInput
                style={styles.input}
                value={adminTimeout}
                onChangeText={setAdminTimeout}
                placeholder="35"
                placeholderTextColor="#666"
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* ECR Reference Field Selection (HD vs HS) */}
          <View style={[styles.inputGroup, { marginTop: 4, marginBottom: 12 }]}>
            <Text style={styles.inputLabel}>ECR Reference Field Code (HD: V1.27 Spec / HS: UAT Requirement)</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <TouchableOpacity
                style={[styles.fieldToggleBtn, ecrRefFieldCode === "HD" && styles.fieldToggleBtnActive]}
                onPress={() => setEcrRefFieldCode("HD")}
              >
                <Text style={[styles.fieldToggleText, ecrRefFieldCode === "HD" && styles.fieldToggleTextActive]}>
                  Field HD (Spec V1.27)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.fieldToggleBtn, ecrRefFieldCode === "HS" && styles.fieldToggleBtnActive]}
                onPress={() => setEcrRefFieldCode("HS")}
              >
                <Text style={[styles.fieldToggleText, ecrRefFieldCode === "HS" && styles.fieldToggleTextActive]}>
                  Field HS (UAT Text)
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.ecnLabel}>Current ECN: {currentEcn}</Text>
            <TouchableOpacity style={styles.saveBtn} onPress={saveConfig} disabled={loading}>
              <Text style={styles.saveBtnText}>Save Settings</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Administrative Operations Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="construct-outline" size={20} color={Theme.colors.primary} />
            <Text style={styles.cardTitle}>ECR II Mandatory Functions</Text>
          </View>

          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "Terminal Status" && styles.actionBtnActive]}
              onPress={() => runNetsAction("status", "Terminal Status")}
              disabled={loading}
            >
              <Ionicons name="pulse-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC 55: Status</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "NETS Logon" && styles.actionBtnActive]}
              onPress={() => runNetsAction("logon", "NETS Logon")}
              disabled={loading}
            >
              <Ionicons name="log-in-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC 80: NETS Logon</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "NETS Settlement" && styles.actionBtnActive]}
              onPress={() => runNetsAction("settlement", "NETS Settlement")}
              disabled={loading}
            >
              <Ionicons name="receipt-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC 81: Settlement</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "Credit Settlement" && styles.actionBtnActive]}
              onPress={() => runNetsAction("credit-settlement", "Credit Settlement", { acquirer: "DBS" })}
              disabled={loading}
            >
              <Ionicons name="card-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC I5: Credit (DBS)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "TMS Update" && styles.actionBtnActive]}
              onPress={() => runNetsAction("tms-update", "TMS Update")}
              disabled={loading}
            >
              <Ionicons name="cloud-download-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC 84: TMS Update</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, activeAction === "Last Approved" && styles.actionBtnActive]}
              onPress={() => runNetsAction("last-approved", "Last Approved")}
              disabled={loading}
            >
              <Ionicons name="search-outline" size={20} color="#FFF" />
              <Text style={styles.actionBtnText}>FC 56: Last Txn</Text>
            </TouchableOpacity>
          </View>

          {/* Automated End of Day Sequence Button */}
          <TouchableOpacity
            style={[styles.eodBtn, eodProgress?.running && styles.eodBtnRunning]}
            onPress={triggerEndOfDay}
            disabled={loading || Boolean(eodProgress?.running)}
          >
            <Ionicons name="flash-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
            <View>
              <Text style={styles.eodBtnTitle}>Run End-of-Day Settlement Sequence</Text>
              <Text style={styles.eodBtnSubtitle}>Auto Credit (I5 DBS) → NETS (81) → Logon (80) → TMS (84) with 20s delays</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Live Result Output */}
        {lastResult && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="information-circle-outline" size={20} color="#10b981" />
              <Text style={styles.cardTitle}>Last Operation: {lastResult.action} ({lastResult.timestamp})</Text>
            </View>
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                {JSON.stringify(lastResult.data || lastResult.error, null, 2)}
              </Text>
            </View>
          </View>
        )}

        {/* Real-time LAN Communication Log (Sanitized & Masked) */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="terminal-outline" size={20} color="#f59e0b" />
            <Text style={styles.cardTitle}>Terminal Socket Frame Log (Masked & Sanitized)</Text>
          </View>

          {commLogs.length === 0 ? (
            <Text style={styles.emptyLogText}>No socket frames captured yet.</Text>
          ) : (
            commLogs.map((log) => (
              <View key={log.id} style={styles.logItem}>
                <View style={styles.logHeader}>
                  <View style={[styles.badge, log.direction === "TX" ? styles.badgeTx : log.direction === "RX" ? styles.badgeRx : styles.badgeErr]}>
                    <Text style={styles.badgeText}>{log.direction}</Text>
                  </View>
                  <Text style={styles.logTitle}>{log.title}</Text>
                  <Text style={styles.logTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                </View>
                <Text style={styles.logData} numberOfLines={4}>
                  {typeof log.data === "string" ? log.data : JSON.stringify(log.data)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0f172a" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    backgroundColor: "#1e293b",
  },
  backButton: { padding: 8, marginRight: 8 },
  headerTitleContainer: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: Fonts.bold, color: "#FFF" },
  headerSubtitle: { fontSize: 12, color: "#94a3b8" },
  refreshButton: { padding: 8 },
  container: { flex: 1 },
  contentContainer: { padding: 16 },
  card: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: Fonts.semiBold, color: "#FFF", marginLeft: 8 },
  row: { flexDirection: "row", marginBottom: 12 },
  inputGroup: { flex: 1 },
  inputLabel: { fontSize: 12, color: "#94a3b8", marginBottom: 6 },
  input: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    color: "#FFF",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  fieldToggleBtn: {
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  fieldToggleBtnActive: {
    backgroundColor: Theme.colors.primary,
    borderColor: Theme.colors.primary,
  },
  fieldToggleText: {
    color: "#94a3b8",
    fontSize: 12,
    fontFamily: Fonts.medium,
  },
  fieldToggleTextActive: {
    color: "#FFF",
    fontFamily: Fonts.bold,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  ecnLabel: { fontSize: 13, color: "#38bdf8", fontFamily: Fonts.medium },
  saveBtn: {
    backgroundColor: Theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  saveBtnText: { color: "#FFF", fontSize: 13, fontFamily: Fonts.bold },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  actionBtn: {
    backgroundColor: "#334155",
    width: "48%",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  actionBtnActive: { backgroundColor: Theme.colors.primary },
  actionBtnText: { color: "#FFF", fontSize: 13, fontFamily: Fonts.medium, marginLeft: 8 },
  eodBtn: {
    backgroundColor: "#d97706",
    borderRadius: 8,
    padding: 14,
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  eodBtnRunning: { backgroundColor: "#b45309" },
  eodBtnTitle: { color: "#FFF", fontSize: 14, fontFamily: Fonts.bold },
  eodBtnSubtitle: { color: "#fef3c7", fontSize: 11, marginTop: 2 },
  resultBox: {
    backgroundColor: "#0f172a",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  resultText: { color: "#a7f3d0", fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  emptyLogText: { color: "#64748b", fontStyle: "italic", textAlign: "center", paddingVertical: 12 },
  logItem: {
    backgroundColor: "#0f172a",
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  logHeader: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 8 },
  badgeTx: { backgroundColor: "#0284c7" },
  badgeRx: { backgroundColor: "#059669" },
  badgeErr: { backgroundColor: "#dc2626" },
  badgeText: { color: "#FFF", fontSize: 10, fontFamily: Fonts.bold },
  logTitle: { color: "#FFF", fontSize: 12, fontFamily: Fonts.medium, flex: 1 },
  logTime: { color: "#64748b", fontSize: 10 },
  logData: { color: "#94a3b8", fontSize: 11, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
});
