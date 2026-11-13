import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../constants/Config";

export interface SyncStatusData {
  isOnline: boolean;
  pendingCount: number;
  lastSyncStatus: string;
  lastSyncTime: string | null;
  totalSynced: number;
}

export function SyncStatusBadge() {
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchSyncStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/sync/status`);
      const data = await response.json();
      if (data.success) {
        setStatus(data.data);
      }
    } catch (err) {
      // Backend or network offline
      setStatus(prev => ({
        isOnline: false,
        pendingCount: prev ? prev.pendingCount : 0,
        lastSyncStatus: "OFFLINE",
        lastSyncTime: prev ? prev.lastSyncTime : null,
        totalSynced: prev ? prev.totalSynced : 0
      }));
    }
  };

  const handleManualSync = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/sync/trigger`, { method: "POST" });
      const data = await response.json();
      if (data.success) {
        setStatus(data.data);
      }
    } catch (err) {
      console.error("Sync trigger error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const isCloudOnline = status.isOnline;
  const pendingCount = status.pendingCount || 0;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        isCloudOnline
          ? pendingCount > 0
            ? styles.syncingBg
            : styles.onlineBg
          : styles.localModeBg
      ]}
      onPress={handleManualSync}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#FFFFFF" style={styles.icon} />
      ) : (
        <Ionicons
          name={isCloudOnline ? (pendingCount > 0 ? "cloud-upload-outline" : "cloud-done-outline") : "cloud-offline-outline"}
          size={16}
          color="#FFFFFF"
          style={styles.icon}
        />
      )}
      <Text style={styles.text}>
        {isCloudOnline
          ? pendingCount > 0
            ? `Syncing (${pendingCount})`
            : "Cloud Online"
          : pendingCount > 0
          ? `Local Mode (${pendingCount} pending)`
          : "Local Standalone"}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    marginHorizontal: 8,
  },
  onlineBg: {
    backgroundColor: "#10B981", // Emerald Green
  },
  syncingBg: {
    backgroundColor: "#3B82F6", // Blue
  },
  localModeBg: {
    backgroundColor: "#F59E0B", // Amber / Local Offline Mode
  },
  icon: {
    marginRight: 6,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  }
});
