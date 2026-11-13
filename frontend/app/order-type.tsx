import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  StatusBar,
  useWindowDimensions,
  Pressable,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "@/constants/Fonts";
import { useAuthStore } from "@/stores/authStore";
import { useOrderContextStore } from "@/stores/orderContextStore";
import { useToast } from "@/components/Toast";
import { API_URL } from "@/constants/Config";
import { useGeneralSettingsStore } from "@/stores/generalSettingsStore";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";
import { ServerConnectionModal } from "@/components/ServerConnectionModal";

// High-resolution photography
const DINE_IN_IMG = "https://images.unsplash.com/photo-1550966871-3ed3cdb5ed0c?q=80&w=1000&auto=format&fit=crop";
const TAKE_AWAY_IMG = "https://images.unsplash.com/photo-1526367790999-0150786686a2?q=80&w=1000&auto=format&fit=crop";
const QUICK_SERVE_IMG = "https://images.unsplash.com/photo-1550547660-d9450f859349?q=80&w=1000&auto=format&fit=crop";
const DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/4140/4140048.png";

export default function OrderTypeSelectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height; // True landscape detection based on orientation

  const { user, logout, isWaiter } = useAuthStore();
  const toast = useToast();
  const { settings, fetchSettings } = useGeneralSettingsStore();

  const isWaiterUser = Boolean(
    (user?.role || "").toUpperCase() === "WAITER" ||
    (user?.roleName || "").toUpperCase().includes("WAITER") ||
    (typeof isWaiter === "function" && isWaiter())
  );

  const [showQuickServeModal, setShowQuickServeModal] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [showServerModal, setShowServerModal] = useState<boolean>(false);

  // Dynamic company settings from Receipt/Company settings API
  const [companyInfo, setCompanyInfo] = useState<{
    CompanyName?: string;
    CompanyLogoUrl?: string;
  } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    router.replace("/(tabs)/category" as any);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/company-settings/1`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.settings) {
          setCompanyInfo(data.settings);
        }
      })
      .catch((err) => console.log("Error fetching company settings:", err));
  }, []);

  // Live clock and date update
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      };
      setCurrentDate(now.toLocaleDateString("en-US", dateOptions));

      const timeOptions: Intl.DateTimeFormatOptions = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      };
      setCurrentTime(now.toLocaleTimeString("en-US", timeOptions));
    };

    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (isWaiterUser || (settings && settings.enableQuickServe === false)) {
    return (
      <View style={{ flex: 1, backgroundColor: "#F8FAFC", justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#FF9500" />
      </View>
    );
  }

  // Handlers for Order Types
  const handleDineIn = () => {
    useOrderContextStore.getState().setOrderContext({
      orderType: "DINE_IN",
    });
    router.push({ pathname: "/(tabs)/category", params: { section: "SECTION_1" } } as any);
  };


  const handleQuickServe = () => {
    const token = `QS-${Math.floor(1000 + Math.random() * 9000)}`;
    useOrderContextStore.getState().setOrderContext({
      orderType: "TAKEAWAY",
      takeawayNo: token,
    });
    router.push("/quick-serve" as any);
  };

  const isMobile = width < 600;
  const isTablet = width >= 600 && width <= 1024;
  const isDesktop = width > 1024;
  // Portrait tablet: show cards in a nice single/wrapped column
  const isTabletPortrait = isTablet && !isLandscape;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* HEADER BAR */}
      <View style={[styles.header, isMobile && styles.headerMobile]}>
        {/* Left: Receipt Settings Logo & Name */}
        <View style={styles.headerLeft}>
          {companyInfo?.CompanyLogoUrl ? (
            <Image
              source={{ uri: companyInfo.CompanyLogoUrl }}
              style={[styles.headerCompanyLogo, isMobile && styles.headerCompanyLogoMobile]}
              resizeMode="contain"
            />
          ) : (
            <View style={[styles.logoBadge, isMobile && styles.logoBadgeMobile]}>
              <Ionicons name="restaurant" size={isMobile ? 16 : 20} color="#FFFFFF" />
            </View>
          )}

          <View style={styles.brandTitleContainer}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={[styles.brandTitle, isMobile && styles.brandTitleMobile]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {companyInfo?.CompanyName || "FOOD POS"}
              </Text>
            </View>
            <Text style={[styles.brandSubtitle, isMobile && styles.brandSubtitleMobile]}>RESTAURANT SYSTEM</Text>
          </View>
        </View>

        {/* Center: Date & Time Display - Hidden on Mobile to avoid collision */}
        {!isMobile && (
          <View style={styles.headerCenter}>
            <View style={styles.dateTimeBadge}>
              <View style={styles.badgeItem}>
                <Ionicons name="calendar-outline" size={13} color="#FF9500" />
                <Text style={styles.dateTimeText}>{currentDate}</Text>
              </View>
              <View style={styles.dateTimeDivider} />
              <View style={styles.badgeItem}>
                <Ionicons name="time-outline" size={13} color="#FF9500" />
                <Text style={styles.dateTimeText}>{currentTime}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Right: User Avatar */}
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerServerBtn}
            onPress={() => setShowServerModal(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="server-outline" size={16} color="#7C3AED" />
            <Text style={styles.headerServerBtnText}>Server</Text>
          </TouchableOpacity>
          <SyncStatusBadge />
          <View style={[styles.userInfo, isMobile && styles.userInfoMobile]}>
            <View style={[styles.avatarCircle, isMobile && styles.avatarCircleMobile]}>
              <Ionicons name="person" size={isMobile ? 13 : 15} color="#475569" />
              <View style={styles.onlineDot} />
            </View>
            <View style={styles.userTextContainer}>
              <Text style={[styles.userName, isMobile && styles.userNameMobile]} numberOfLines={1}>
                {user?.userName || "UNIPRO"}
              </Text>
              <Text style={[styles.userRole, isMobile && styles.userRoleMobile]}>{user?.role || "ADMIN"}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* MAIN CONTENT AREA */}
      {isDesktop ? (
        /* FIXED NON-SCROLL DESKTOP FIT */
        <View style={styles.mainFixedContainer}>
          <View style={styles.ambientBlob1} />
          <View style={styles.ambientBlob2} />

          <View style={styles.fixedContentInner}>
            {/* HERO TITLE SECTION */}
            <View style={styles.heroSection}>
              <View style={styles.welcomePill}>
                <Ionicons name="sparkles" size={13} color="#FF9500" />
                <Text style={styles.welcomePillText}>Select Service Mode</Text>
              </View>
              <Text style={styles.mainTitle}>
                Welcome to <Text style={{ color: "#FF9500" }}>{companyInfo?.CompanyName || "My Restaurant"}</Text>
              </Text>
              <Text style={styles.subTitle}>
                Choose your order fulfillment type below to start creating bills
              </Text>
            </View>

            {/* CARDS ROW */}
            <View style={styles.cardsRow}>
              {/* CARD 1: DINE IN */}
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  styles.cardDesktop,
                  hoveredCard === 1 && styles.cardHovered,
                  pressed ? styles.cardPressed : null,
                ]}
                onPress={handleDineIn}
                onHoverIn={() => setHoveredCard(1)}
                onHoverOut={() => setHoveredCard(null)}
              >
                <View style={styles.cardHeaderAccent} />
                <View style={styles.cardContentMinimal}>
                  <View style={[styles.minimalIconCircle, { borderColor: "#FF4D5E", backgroundColor: "#FFF1F2" }]}>
                    <Ionicons name="restaurant-outline" size={26} color="#FF4D5E" />
                  </View>
                  <Text style={styles.cardTitle}>DINE IN</Text>
                  <View style={[styles.titleUnderline, { backgroundColor: "#FF4D5E" }]} />
                  <Text style={styles.cardSubtitle}>Serve customers at designated tables with real-time status</Text>
                  <View style={styles.featureChipsRow}>
                    <View style={styles.chip}>
                      <Ionicons name="checkmark-circle" size={12} color="#FF4D5E" />
                      <Text style={styles.chipText}>Table Management</Text>
                    </View>
                    <View style={styles.chip}>
                      <Ionicons name="checkmark-circle" size={12} color="#FF4D5E" />
                      <Text style={styles.chipText}>KOT Printing</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: "#FF4D5E" }]}
                    onPress={handleDineIn}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.actionButtonText}>Start Dine In</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                </View>
              </Pressable>


              {/* CARD 3: QUICK SERVE */}
              {settings.enableQuickServe !== false && (
                <Pressable
                  style={({ pressed }) => [
                    styles.card,
                    styles.cardDesktop,
                    hoveredCard === 3 && styles.cardHovered,
                    pressed ? styles.cardPressed : null,
                  ]}
                  onPress={handleQuickServe}
                  onHoverIn={() => setHoveredCard(3)}
                  onHoverOut={() => setHoveredCard(null)}
                >
                  <View style={[styles.cardHeaderAccent, { backgroundColor: "#22C55E" }]} />
                  <View style={styles.cardContentMinimal}>
                    <View style={[styles.minimalIconCircle, { borderColor: "#22C55E", backgroundColor: "#F0FDF4" }]}>
                      <Ionicons name="flash-outline" size={26} color="#22C55E" />
                    </View>
                    <Text style={styles.cardTitle}>QUICK SERVE</Text>
                    <View style={[styles.titleUnderline, { backgroundColor: "#22C55E" }]} />
                    <Text style={styles.cardSubtitle}>Rapid billing for high-volume walk-in counters</Text>
                    <View style={styles.featureChipsRow}>
                      <View style={styles.chip}>
                        <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                        <Text style={styles.chipText}>Instant Pay</Text>
                      </View>
                      <View style={styles.chip}>
                        <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                        <Text style={styles.chipText}>Direct KOT</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: "#22C55E" }]}
                      onPress={handleQuickServe}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.actionButtonText}>Start Quick Serve</Text>
                      <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
                    </TouchableOpacity>
                  </View>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      ) : (
        /* SCROLLABLE RESPONSIVE LAYOUT FOR MOBILE & TABLET */
        <ScrollView
          style={styles.mobileScrollView}
          contentContainerStyle={[
            styles.mobileScrollContent,
            isTablet && styles.tabletScrollContent,
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.ambientBlob1} />
          <View style={styles.ambientBlob2} />

          {/* HERO TITLE SECTION */}
          <View style={[styles.heroSection, isMobile && styles.heroSectionMobile]}>
            <View style={styles.welcomePill}>
              <Ionicons name="sparkles" size={12} color="#FF9500" />
              <Text style={styles.welcomePillText}>Select Service Mode</Text>
            </View>
            <Text style={[styles.mainTitle, isMobile && styles.mainTitleMobile]}>
              Welcome to <Text style={{ color: "#FF9500" }}>{companyInfo?.CompanyName || "My Restaurant"}</Text>
            </Text>
            <Text style={[styles.subTitle, isMobile && styles.subTitleMobile]}>
              Choose your order fulfillment type below to start creating bills
            </Text>
          </View>

          {/* CARDS CONTAINER */}
          <View
            style={[
              styles.cardsRow,
              isMobile && styles.cardsColumnMobile,
              isTablet && !isTabletPortrait && styles.cardsRowTablet,
              isTabletPortrait && styles.cardsColumnTabletPortrait,
            ]}
          >
            {/* CARD 1: DINE IN */}
            <Pressable
              style={({ pressed }) => [
                styles.card,
                isMobile && styles.cardMobile,
                isTabletPortrait && styles.cardTabletPortrait,
                isTablet && !isTabletPortrait && styles.cardTablet,
                pressed ? styles.cardPressed : null,
              ]}
              onPress={handleDineIn}
            >
              <View style={styles.cardHeaderAccent} />
              <View style={[styles.cardContentMinimal, isMobile && styles.cardContentMinimalMobile]}>
                <View
                  style={[
                    styles.minimalIconCircle,
                    isMobile && styles.minimalIconCircleMobile,
                    { borderColor: "#FF4D5E", backgroundColor: "#FFF1F2" },
                  ]}
                >
                  <Ionicons name="restaurant-outline" size={isMobile ? 22 : 26} color="#FF4D5E" />
                </View>
                <Text style={[styles.cardTitle, isMobile && styles.cardTitleMobile]}>DINE IN</Text>
                <View style={[styles.titleUnderline, { backgroundColor: "#FF4D5E" }]} />
                <Text style={[styles.cardSubtitle, isMobile && styles.cardSubtitleMobile]}>
                  Serve customers at designated tables with real-time status
                </Text>
                <View style={styles.featureChipsRow}>
                  <View style={styles.chip}>
                    <Ionicons name="checkmark-circle" size={11} color="#FF4D5E" />
                    <Text style={styles.chipText}>Table Management</Text>
                  </View>
                  <View style={styles.chip}>
                    <Ionicons name="checkmark-circle" size={11} color="#FF4D5E" />
                    <Text style={styles.chipText}>KOT Printing</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.actionButton, styles.actionButtonMobile, { backgroundColor: "#FF4D5E" }]}
                  onPress={handleDineIn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.actionButtonText}>Start Dine In</Text>
                  <Ionicons name="arrow-forward" size={15} color="#FFFFFF" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              </View>
            </Pressable>


            {/* CARD 3: QUICK SERVE */}
            {settings.enableQuickServe !== false && (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  isMobile && styles.cardMobile,
                  isTabletPortrait && styles.cardTabletPortrait,
                  isTablet && !isTabletPortrait && styles.cardTablet,
                  pressed ? styles.cardPressed : null,
                ]}
                onPress={handleQuickServe}
              >
                <View style={[styles.cardHeaderAccent, { backgroundColor: "#22C55E" }]} />
                <View style={[styles.cardContentMinimal, isMobile && styles.cardContentMinimalMobile]}>
                  <View
                    style={[
                      styles.minimalIconCircle,
                      isMobile && styles.minimalIconCircleMobile,
                      { borderColor: "#22C55E", backgroundColor: "#F0FDF4" },
                    ]}
                  >
                    <Ionicons name="flash-outline" size={isMobile ? 22 : 26} color="#22C55E" />
                  </View>
                  <Text style={[styles.cardTitle, isMobile && styles.cardTitleMobile]}>QUICK SERVE</Text>
                  <View style={[styles.titleUnderline, { backgroundColor: "#22C55E" }]} />
                  <Text style={[styles.cardSubtitle, isMobile && styles.cardSubtitleMobile]}>
                    Rapid billing for high-volume walk-in counters
                  </Text>
                  <View style={styles.featureChipsRow}>
                    <View style={styles.chip}>
                      <Ionicons name="checkmark-circle" size={11} color="#22C55E" />
                      <Text style={styles.chipText}>Instant Pay</Text>
                    </View>
                    <View style={styles.chip}>
                      <Ionicons name="checkmark-circle" size={11} color="#22C55E" />
                      <Text style={styles.chipText}>Direct KOT</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.actionButton, styles.actionButtonMobile, { backgroundColor: "#22C55E" }]}
                    onPress={handleQuickServe}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.actionButtonText}>Start Quick Serve</Text>
                    <Ionicons name="arrow-forward" size={15} color="#FFFFFF" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                </View>
              </Pressable>
            )}
          </View>
        </ScrollView>
      )}

      {/* ULTRA-PREMIUM COMING SOON MODAL FOR QUICK SERVE */}
      <Modal
        visible={showQuickServeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQuickServeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.comingSoonModalCard}>
            {/* Top Gradient Header Banner */}
            <LinearGradient
              colors={["#047857", "#10B981", "#34D399"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.modalHeaderBanner}
            >
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setShowQuickServeModal(false)}
                activeOpacity={0.75}
              >
                <Ionicons name="close" size={18} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.bannerSparkleBg}>
                <Ionicons name="sparkles-outline" size={80} color="rgba(255, 255, 255, 0.15)" />
              </View>
            </LinearGradient>

            {/* Overlapping Hero Icon Circle */}
            <View style={styles.heroIconWrapper}>
              <View style={styles.comingSoonIconCircle}>
                <Ionicons name="flash" size={34} color="#059669" />
              </View>
            </View>

            {/* Modal Body Content */}
            <View style={styles.modalBodyContent}>
              <Text style={styles.comingSoonTitle}>Quick Serve POS ⚡</Text>

              <View style={styles.comingSoonBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.comingSoonBadgeText}>FEATURE IN DEVELOPMENT</Text>
              </View>

              <Text style={styles.comingSoonDesc}>
                High-speed walk-in counter billing, instant checkout, and direct kitchen dispatch are currently being crafted for maximum efficiency!
              </Text>

              {/* Feature Chips */}
              <View style={styles.modalFeatureGrid}>
                <View style={styles.modalFeatureChip}>
                  <Ionicons name="flash-outline" size={14} color="#059669" />
                  <Text style={styles.modalFeatureChipText}>Instant Pay</Text>
                </View>
                <View style={styles.modalFeatureChip}>
                  <Ionicons name="print-outline" size={14} color="#059669" />
                  <Text style={styles.modalFeatureChipText}>Direct KOT</Text>
                </View>
                <View style={styles.modalFeatureChip}>
                  <Ionicons name="speedometer-outline" size={14} color="#059669" />
                  <Text style={styles.modalFeatureChipText}>Fast Counter</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => setShowQuickServeModal(false)}
                activeOpacity={0.88}
                style={{ width: "100%", marginTop: 4 }}
              >
                <LinearGradient
                  colors={["#10B981", "#059669"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.comingSoonBtnGradient}
                >
                  <Text style={styles.comingSoonBtnText}>Got It, Close</Text>
                  <Ionicons name="arrow-forward" size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
          {/* 🌐 Server Connection Setup Modal */}
      <ServerConnectionModal
        visible={showServerModal}
        onClose={() => setShowServerModal(false)}
        onSaved={() => {
          toast.showToast({
            message: "Server connected successfully!",
            type: "success",
            duration: 3000,
          });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerServerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(124, 58, 237, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.2)",
    marginRight: 6,
  },
  headerServerBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#7C3AED",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  comingSoonModalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    overflow: "hidden",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.22,
        shadowRadius: 28,
      },
      android: {
        elevation: 16,
      },
      web: {
        boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
      },
    }),
  },
  modalHeaderBanner: {
    width: "100%",
    height: 110,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  bannerSparkleBg: {
    position: "absolute",
    right: -10,
    top: -10,
  },
  heroIconWrapper: {
    marginTop: -38,
    zIndex: 10,
  },
  comingSoonIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#FFFFFF",
    borderWidth: 4,
    borderColor: "#ECFDF5",
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#059669",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: "0 10px 25px rgba(5, 150, 105, 0.2)",
      },
    }),
  },
  modalBodyContent: {
    width: "100%",
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    alignItems: "center",
  },
  comingSoonTitle: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 23,
    color: "#0F172A",
    marginBottom: 6,
    textAlign: "center",
  },
  comingSoonBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    marginBottom: 14,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#10B981",
    marginRight: 6,
  },
  comingSoonBadgeText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 10.5,
    color: "#047857",
    letterSpacing: 0.6,
  },
  comingSoonDesc: {
    fontFamily: Fonts.medium || "System",
    fontSize: 13.5,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 18,
  },
  modalFeatureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginBottom: 22,
  },
  modalFeatureChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  modalFeatureChipText: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 11.5,
    color: "#334155",
  },
  comingSoonBtnGradient: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#059669",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
      web: {
        boxShadow: "0 8px 20px rgba(5, 150, 105, 0.3)",
      },
    }),
  },
  comingSoonBtnText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 15,
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  ambientBlob1: {
    position: "absolute",
    top: -100,
    left: -100,
    width: 350,
    height: 350,
    borderRadius: 175,
    backgroundColor: "rgba(255, 77, 94, 0.03)",
  },
  ambientBlob2: {
    position: "absolute",
    bottom: -100,
    right: -100,
    width: 400,
    height: 400,
    borderRadius: 200,
    backgroundColor: "rgba(255, 149, 0, 0.03)",
  },
  header: {
    height: 62,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    zIndex: 100,
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: "0 4px 20px rgba(15, 23, 42, 0.04)",
      },
    }),
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerCompanyLogo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    marginRight: 12,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FF4D5E",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  brandTitleContainer: {
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 18,
    color: "#0F172A",
    letterSpacing: 0.4,
  },
  proBadge: {
    backgroundColor: "rgba(255, 77, 94, 0.1)",
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  proBadgeText: {
    fontSize: 9.5,
    fontFamily: Fonts.bold || "System",
    color: "#FF4D5E",
    letterSpacing: 0.5,
  },
  brandSubtitle: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 9,
    color: "#64748B",
    letterSpacing: 1.6,
    marginTop: 0,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dateTimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  badgeItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  dateTimeText: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 12.5,
    color: "#334155",
    marginLeft: 5,
  },
  dateTimeDivider: {
    width: 1,
    height: 12,
    backgroundColor: "#CBD5E1",
    marginHorizontal: 10,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    position: "relative",
  },
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22C55E",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  userTextContainer: {
    justifyContent: "center",
    paddingRight: 2,
  },
  userName: {
    fontFamily: Fonts.bold || "System",
    fontSize: 12.5,
    color: "#1E293B",
  },
  userRole: {
    fontFamily: Fonts.medium || "System",
    fontSize: 10,
    color: "#64748B",
    marginTop: -1,
  },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF9500",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 11,
    gap: 6,
    ...Platform.select({
      ios: {
        shadowColor: "#FF9500",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: "0 4px 12px rgba(255, 149, 0, 0.25)",
      },
    }),
  },
  menuButtonActive: {
    backgroundColor: "#D97706",
  },
  menuButtonText: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 13.5,
    color: "#FFFFFF",
  },
  menuOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
  menuModalContainer: {
    position: "absolute",
    right: 24,
    width: 310,
    maxHeight: 520,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
      },
      android: {
        elevation: 14,
      },
      web: {
        boxShadow: "0 12px 36px rgba(15, 23, 42, 0.16)",
      },
    }),
  },
  menuModalHeaderOrange: {
    backgroundColor: "#E95709",
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerAvatarContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "#FFFFFF",
    padding: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  headerAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  headerUserTextCol: {
    justifyContent: "center",
  },
  headerUserNameTextOrange: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 17,
    color: "#FFFFFF",
    letterSpacing: 0.4,
  },
  headerUserRoleTextOrange: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 11,
    color: "rgba(255, 255, 255, 0.9)",
    letterSpacing: 0.4,
    marginTop: 1,
  },
  menuListScrollView: {
    maxHeight: 440,
  },
  menuListBody: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  menuRowItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  menuRowItemExpanded: {
    backgroundColor: "#F8FAFC",
  },
  menuRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
    justifyContent: "center",
    alignItems: "center",
  },
  menuRowText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 15,
    color: "#1E293B",
  },
  subMenuContainer: {
    borderLeftWidth: 2,
    borderLeftColor: "#F1F5F9",
    marginLeft: 28,
    marginVertical: 4,
    paddingLeft: 6,
    gap: 2,
  },
  subMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 10,
  },
  subIconBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: "#FFF7ED",
    justifyContent: "center",
    alignItems: "center",
  },
  subMenuItemText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 13.5,
    color: "#334155",
  },
  menuDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 4,
    marginHorizontal: 10,
  },
  mainFixedContainer: {
    flex: 1,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  fixedContentInner: {
    width: "100%",
    maxWidth: 1120,
    alignItems: "center",
    justifyContent: "center",
  },
  heroSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  welcomePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FFEDD5",
    marginBottom: 8,
  },
  welcomePillText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 11,
    color: "#FF9500",
    letterSpacing: 0.4,
  },
  mainTitle: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 32,
    color: "#0F172A",
    letterSpacing: 0.4,
    textAlign: "center",
    marginBottom: 4,
  },
  subTitle: {
    fontFamily: Fonts.medium || "System",
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    maxWidth: 460,
  },
  cardsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 24,
    width: "100%",
    maxWidth: 1120,
    flexWrap: "wrap",
  },
  cardsColumn: {
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    position: "relative",
    ...Platform.select({
      ios: {
        shadowColor: "#0F172A",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.07,
        shadowRadius: 14,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
      },
    }),
  },
  cardDesktop: {
    flex: 1,
    minWidth: 280,
    maxWidth: 380,
  },
  cardHovered: {
    ...Platform.select({
      web: {
        boxShadow: "0 16px 36px rgba(15, 23, 42, 0.10)",
        transform: "translateY(-4px)",
      },
    }),
  },
  cardPressed: {
    opacity: 0.95,
  },
  cardHeaderAccent: {
    height: 4,
    backgroundColor: "#FF4D5E",
    width: "100%",
  },
  cardImageContainer: {
    height: 135,
    width: "100%",
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  imageGradientOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.25)",
  },
  cardHeaderBadgeRow: {
    position: "absolute",
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardTag: {
    backgroundColor: "rgba(255, 77, 94, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  cardTagText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 9.5,
    color: "#FF4D5E",
    letterSpacing: 0.7,
  },
  iconCircleBadge: {
    position: "absolute",
    bottom: -20,
    alignSelf: "center",
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3.5,
    borderColor: "#FFFFFF",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.14,
        shadowRadius: 6,
      },
      android: {
        elevation: 5,
      },
      web: {
        boxShadow: "0 3px 10px rgba(0, 0, 0, 0.14)",
      },
    }),
  },
  cardContent: {
    paddingTop: 26,
    paddingBottom: 18,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  cardContentMinimal: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
  },
  minimalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  titleUnderline: {
    width: 28,
    height: 3,
    borderRadius: 2,
    marginTop: 4,
    marginBottom: 10,
  },
  cardTitle: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 19,
    color: "#0F172A",
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontFamily: Fonts.regular || "System",
    fontSize: 12.5,
    color: "#64748B",
    marginBottom: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  featureChipsRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 16,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  chipText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 11,
    color: "#475569",
  },
  actionButton: {
    width: "100%",
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 6,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
      },
    }),
  },
  actionButtonText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 14,
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  actionButtonMobile: {
    height: 42,
    borderRadius: 10,
  },
  // Responsive styles for Mobile & Tablet
  headerMobile: {
    height: 54,
    paddingHorizontal: 14,
  },
  headerCompanyLogoMobile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 8,
  },
  logoBadgeMobile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    marginRight: 8,
  },
  brandTitleMobile: {
    fontSize: 15,
  },
  brandSubtitleMobile: {
    fontSize: 8,
    letterSpacing: 1.2,
  },
  userInfoMobile: {
    marginRight: 0,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 14,
  },
  avatarCircleMobile: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 6,
  },
  userNameMobile: {
    fontSize: 11,
  },
  userRoleMobile: {
    fontSize: 9,
  },
  mobileScrollView: {
    flex: 1,
    width: "100%",
  },
  mobileScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
    alignItems: "center",
  },
  tabletScrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
  heroSectionMobile: {
    marginBottom: 12,
  },
  mainTitleMobile: {
    fontSize: 22,
    lineHeight: 28,
  },
  subTitleMobile: {
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 320,
    marginBottom: 2,
  },
  cardsColumnMobile: {
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    gap: 12,
  },
  cardsRowTablet: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "stretch",
    gap: 16,
    width: "100%",
  },
  cardsColumnTabletPortrait: {
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    gap: 14,
  },
  cardMobile: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
  },
  cardTablet: {
    width: "46%",
    minWidth: 280,
    maxWidth: 420,
    borderRadius: 18,
  },
  cardTabletPortrait: {
    width: "100%",
    maxWidth: 480,
    borderRadius: 18,
  },
  cardContentMinimalMobile: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  minimalIconCircleMobile: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginBottom: 6,
  },
  cardTitleMobile: {
    fontSize: 16,
    marginBottom: 2,
  },
  cardSubtitleMobile: {
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 15,
  },
});
