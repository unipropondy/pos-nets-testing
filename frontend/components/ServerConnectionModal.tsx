import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getServerConfig,
  saveServerConfig,
  testServerConnection,
} from "@/constants/Config";

interface ServerConnectionModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved?: (newUrl: string) => void;
}

export const ServerConnectionModal: React.FC<ServerConnectionModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (visible) {
      const config = getServerConfig();
      setHost(config.host || "192.168.0.229");
      setPort(config.port || "3000");
      setStatusMessage(null);
    }
  }, [visible]);

  const handleTestConnection = async () => {
    if (!host.trim()) {
      setStatusMessage({ type: "error", text: "Please enter a server host or IP address." });
      return;
    }

    setTesting(true);
    setStatusMessage({ type: "info", text: "Testing connection to server..." });

    try {
      const result = await testServerConnection(host.trim(), port.trim());
      if (result.success) {
        const serverName = result.serverInfo?.server || "Smart POS Server";
        const latency = result.latencyMs;
        setStatusMessage({
          type: "success",
          text: `Connected to ${serverName} successfully! (${latency}ms)`,
        });
      } else {
        setStatusMessage({
          type: "error",
          text: result.error || "Failed to connect. Check Wi-Fi and IP address.",
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Connection test failed.",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveAndApply = async () => {
    if (!host.trim()) {
      setStatusMessage({ type: "error", text: "Please enter a server host or IP address." });
      return;
    }

    setSaving(true);
    try {
      const { fullUrl } = await saveServerConfig(host.trim(), port.trim());
      setStatusMessage({
        type: "success",
        text: "Configuration saved! Reconnected successfully.",
      });

      if (onSaved) {
        onSaved(fullUrl);
      }

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      setStatusMessage({
        type: "error",
        text: err.message || "Failed to save configuration.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              style={styles.modalCard}
            >
              {/* Header */}
              <View style={styles.headerRow}>
                <View style={styles.headerTitleGroup}>
                  <View style={styles.serverIconBadge}>
                    <Ionicons name="server" size={20} color="#C084FC" />
                  </View>
                  <Text style={styles.title}>Server Connection Setup</Text>
                </View>

                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <Text style={styles.subtitle}>
                Connect to Railway Cloud Backend or Local Counter PC.
              </Text>

              {/* Server Host / Railway URL Field */}
              <View style={styles.fieldSection}>
                <Text style={styles.label}>SERVER HOST OR RAILWAY URL</Text>
                <View style={styles.inputContainer}>
                  <Ionicons
                    name="globe-outline"
                    size={20}
                    color="#64748B"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={host}
                    onChangeText={(val) => {
                      setHost(val);
                      setStatusMessage(null);
                    }}
                    placeholder="localhost or 192.168.0.229"
                    placeholderTextColor="#475569"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <Text style={styles.hint}>
                  Paste Railway URL or Counter PC IP (leave port empty for Railway)
                </Text>
              </View>

              {/* Port Field */}
              <View style={styles.fieldSection}>
                <Text style={styles.label}>PORT (LEAVE EMPTY FOR RAILWAY)</Text>
                <View style={styles.inputContainer}>
                  <Ionicons
                    name="hardware-chip-outline"
                    size={20}
                    color="#64748B"
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    value={port}
                    onChangeText={(val) => {
                      setPort(val);
                      setStatusMessage(null);
                    }}
                    placeholder="3000"
                    placeholderTextColor="#475569"
                    keyboardType="numeric"
                    autoCapitalize="none"
                  />
                </View>
                <Text style={styles.hint}>
                  Can leave empty for Railway or standard cloud domains
                </Text>
              </View>

              {/* Status Banner */}
              {statusMessage && (
                <View
                  style={[
                    styles.statusBox,
                    statusMessage.type === "success" && styles.statusBoxSuccess,
                    statusMessage.type === "error" && styles.statusBoxError,
                    statusMessage.type === "info" && styles.statusBoxInfo,
                  ]}
                >
                  <Ionicons
                    name={
                      statusMessage.type === "success"
                        ? "checkmark-circle"
                        : statusMessage.type === "error"
                        ? "alert-circle"
                        : "information-circle"
                    }
                    size={16}
                    color={
                      statusMessage.type === "success"
                        ? "#34D399"
                        : statusMessage.type === "error"
                        ? "#F87171"
                        : "#60A5FA"
                    }
                  />
                  <Text
                    style={[
                      styles.statusText,
                      statusMessage.type === "success" && styles.statusTextSuccess,
                      statusMessage.type === "error" && styles.statusTextError,
                      statusMessage.type === "info" && styles.statusTextInfo,
                    ]}
                  >
                    {statusMessage.text}
                  </Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={[styles.testButton, testing && styles.buttonDisabled]}
                  onPress={handleTestConnection}
                  disabled={testing || saving}
                >
                  {testing ? (
                    <ActivityIndicator size="small" color="#C084FC" />
                  ) : (
                    <Text style={styles.testButtonText}>Test Connection</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveButton, saving && styles.buttonDisabled]}
                  onPress={handleSaveAndApply}
                  disabled={testing || saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveButtonText}>Save & Apply</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#16162A",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.25)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  serverIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 13,
    color: "#94A3B8",
    marginBottom: 20,
    lineHeight: 18,
  },
  fieldSection: {
    marginBottom: 18,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    marginBottom: 8,
    letterSpacing: 0.8,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F0F1E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: "#F1F5F9",
    fontSize: 15,
    fontWeight: "500",
  },
  hint: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 6,
    paddingHorizontal: 2,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  statusBoxSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    borderColor: "rgba(16, 185, 129, 0.3)",
    borderWidth: 1,
  },
  statusBoxError: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "rgba(239, 68, 68, 0.3)",
    borderWidth: 1,
  },
  statusBoxInfo: {
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    borderColor: "rgba(59, 130, 246, 0.3)",
    borderWidth: 1,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  statusTextSuccess: {
    color: "#34D399",
  },
  statusTextError: {
    color: "#F87171",
  },
  statusTextInfo: {
    color: "#93C5FD",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6,
  },
  testButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  testButtonText: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "600",
  },
  saveButton: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#A855F7",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#A855F7",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});

export default ServerConnectionModal;
