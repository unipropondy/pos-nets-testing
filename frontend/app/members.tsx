import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  Platform,
  StatusBar,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useRouter } from "expo-router";
import { usePathname } from "expo-router";
import { API_URL } from "@/constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { formatToSingaporeDate, formatToSingaporeTime } from "../utils/timezoneHelper";
import SplitPaymentComponent from "../components/payment/SplitPaymentComponent";



// Low-balance threshold (must match backend utils/whatsappService.js)
const LOW_BALANCE_THRESHOLD_PCT = 0.10; // 10% of CreditLimit
const LOW_BALANCE_THRESHOLD_FIXED = 100; // fallback when CreditLimit = 0
const getLowBalanceThreshold = (creditLimit: number) =>
  creditLimit > 0 ? creditLimit * LOW_BALANCE_THRESHOLD_PCT : LOW_BALANCE_THRESHOLD_FIXED;

type MemberType = {
  MemberId: string;
  Name: string;
  Phone: string;
  Email?: string;
  Address?: string;
  IsActive?: boolean | number;
  CreditLimit?: number;
  CurrentBalance?: number;
  Balance?: number;
  LowBalanceAlertSent?: boolean | number;
  Promocode?: string;
  Promoamount?: number;
  AvailableCredit?: number;
};

const formatMoney = (amount: number) => {
  try {
    return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `$${(amount || 0).toFixed(2)}`;
  }
};

const COUNTRIES = [
  { code: "+65", label: "🇸🇬 +65", name: "Singapore" },
  { code: "+60", label: "🇲🇾 +60", name: "Malaysia" },
  { code: "+971", label: "🇦🇪 +971", name: "UAE" },
  { code: "+91", label: "🇮🇳 +91", name: "India" },
  { code: "+1", label: "🇺🇸 +1", name: "USA" },
  { code: "+44", label: "🇬🇧 +44", name: "UK" },
  { code: "+61", label: "🇦🇺 +61", name: "Australia" },
  { code: "+62", label: "🇮🇩 +62", name: "Indonesia" },
  { code: "+66", label: "🇹🇭 +66", name: "Thailand" },
];

function parsePhoneNumber(rawPhone: string) {
  const clean = String(rawPhone || "").trim();
  for (const country of COUNTRIES) {
    if (clean.startsWith(country.code)) {
      return {
        countryCode: country.code,
        localNumber: clean.slice(country.code.length)
      };
    }
    const codeNoPlus = country.code.slice(1);
    if (clean.startsWith(codeNoPlus)) {
      return {
        countryCode: country.code,
        localNumber: clean.slice(codeNoPlus.length)
      };
    }
  }
  return {
    countryCode: "+65",
    localNumber: clean.startsWith("+") ? clean.slice(1) : clean
  };
}

export default function MembersScreen() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const pathname = usePathname();
  const isFocused = pathname === "/members";
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;
  const [members, setMembers] = useState<MemberType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState<{
    totalOutstanding: number;
    totalOverdue: number;
    totalCustomersWithCredit: number;
    collectionsToday: number;
    collectionsThisMonth: number;
    totalCredit: number;
    totalPaid: number;
  } | null>(null);

  // Modal State
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | "NONE">("NONE");
  const [editingMember, setEditingMember] = useState<MemberType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Country Code Selector States
  const [selectedCountryCode, setSelectedCountryCode] = useState("+65");
  const [localPhone, setLocalPhone] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  // Recharge Modal State
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [rechargeMember, setRechargeMember] = useState<MemberType | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [isRecharging, setIsRecharging] = useState(false);

  // Usage Modal State
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [usageMember, setUsageMember] = useState<MemberType | null>(null);
  const [usageData, setUsageData] = useState<{
    summary: { TotalSpent: number; TotalOrders: number };
    items: { DishName: string; TotalQty: number; TotalAmount: number }[];
    transactions: { SettlementID: string; BillNo: string; LastSettlementDate: string; SysAmount: number }[];
  } | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Bill Details State
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [billDetails, setBillDetails] = useState<any[]>([]);
  const [loadingBillDetails, setLoadingBillDetails] = useState(false);
  const [showBillDetailsModal, setShowBillDetailsModal] = useState(false);

  const handleBillPress = async (tx: any) => {
    setSelectedBill(tx);
    setShowBillDetailsModal(true);
    setLoadingBillDetails(true);
    setBillDetails([]);
    try {
      const res = await fetch(`${API_URL}/api/sales/detail/${tx.SettlementID}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setBillDetails(data);
        }
      }
    } catch (err) {
      console.error("[BILL DETAIL FETCH ERROR]", err);
    } finally {
      setLoadingBillDetails(false);
    }
  };

  // ── Recharge handler ────────────────────────────────────────────────────
  const openRechargeModal = (member: MemberType) => {
    setRechargeMember(member);
    setRechargeAmount("");
    setShowRechargeModal(true);
  };

  const handleRecharge = async () => {
    const amt = parseFloat(rechargeAmount);
    if (!rechargeMember || isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid", "Please enter a valid positive amount.");
      return;
    }
    setIsRecharging(true);
    try {
      const res = await fetch(`${API_URL}/api/members/recharge`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ memberId: rechargeMember.MemberId, amount: amt }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMembers(prev =>
          prev.map(m =>
            m.MemberId === rechargeMember.MemberId
              ? {
                  ...m,
                  Balance: data.Balance,
                  CurrentBalance: data.CurrentBalance,
                  LowBalanceAlertSent: data.LowBalanceAlertSent,
                }
              : m
          )
        );
        setShowRechargeModal(false);
        Alert.alert("✅ Recharged", `RM ${amt.toFixed(2)} added to ${rechargeMember.Name}'s balance.`);
      } else {
        Alert.alert("Error", data.error || "Recharge failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsRecharging(false);
    }
  };

  // ── WhatsApp low-balance reminder (manual trigger) ───────────────────────
  const handleSendLowBalanceReminder = (member: MemberType) => {
    const outstanding = member.CurrentBalance || 0;
    const hasPlus = member.Phone.trim().startsWith("+");
    const cleanPhone = member.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    const message =
      `Dear ${member.Name}, your prepaid balance is low (RM ${outstanding.toFixed(2)}). ` +
      `Please recharge to continue ordering. Thank you! 🙏`;
    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Linking.openURL(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`);
      }
    }).catch(() => {
      Linking.openURL(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`);
    });
  };

  const handleViewUsage = async (member: MemberType) => {
    setUsageMember(member);
    setShowUsageModal(true);
    setLoadingUsage(true);
    setUsageData(null);
    try {
      const res = await fetch(`${API_URL}/api/members/usage/${member.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUsageData(data);
        }
      }
    } catch (err) {
      console.error("[USAGE FETCH ERROR]", err);
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleCollectPayment = (member: MemberType) => {
    router.push({
      pathname: "/payment" as any,
      params: {
        memberId: member.MemberId,
        collectAmount: String(Math.max(0, member.CurrentBalance || 0)),
        memberName: member.Name,
        memberPhone: member.Phone,
        isMember: "true"
      }
    });
  };

  const handleSendWhatsApp = (member: MemberType) => {
    // Clean phone number (remove spaces, symbols)
    const hasPlus = member.Phone.trim().startsWith("+");
    const cleanPhone = member.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    
    const creditLimit = member.CreditLimit || 0;
    const currentBalance = member.CurrentBalance || 0;
    const availableBalance = creditLimit > 0 ? (creditLimit - currentBalance) : currentBalance;

    const formattedAvailable = availableBalance.toFixed(2);
    const formattedCreditLimit = creditLimit.toFixed(2);
    const formattedConsumed = currentBalance.toFixed(2);

    let message = "";
    if (availableBalance < 50) {
      message = `Hi ${member.Name},\n\nYour available balance is $${formattedAvailable}, which is below the minimum threshold of $50.\n\nPlease top up your account to continue enjoying uninterrupted service.\n\nThank you.`;
    } else {
      message = `Hi ${member.Name},\n\nYour current available balance is $${formattedAvailable}.\n\nPrepaid Amount: $${formattedCreditLimit}\nConsumed Amount: $${formattedConsumed}\n\nThank you for being a valued member.`;
    }

    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        Linking.openURL(webUrl);
      }
    }).catch(() => {
      const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
      Linking.openURL(webUrl);
    });
  };

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    isActive: true,
    creditLimit: "1000",
    currentBalance: "0",
    balance: "0",
    promocode: "",
    promoamount: "",
  });

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/members`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);

      // Fetch dashboard stats
      const statsRes = await fetch(`${API_URL}/api/credit-customers/receivables/dashboard`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        if (statsJson.success && statsJson.stats) {
          setStats({
            totalOutstanding: Number(statsJson.stats.totalOutstanding || 0),
            totalOverdue: Number(statsJson.stats.totalOverdue || 0),
            totalCustomersWithCredit: Number(statsJson.stats.totalCustomersWithCredit || 0),
            collectionsToday: Number(statsJson.stats.collectionsToday || 0),
            collectionsThisMonth: Number(statsJson.stats.collectionsThisMonth || 0),
            totalCredit: Number(statsJson.stats.totalCredit || 0),
            totalPaid: Number(statsJson.stats.totalPaid || 0)
          });
        }
      }
    } catch (err) {
      console.error("[FETCH ERROR]", err);
    } finally {
      setLoading(false);
    }
  }, [token]);


  useEffect(() => {
    if (isFocused) {
      fetchMembers();
    }
  }, [isFocused, fetchMembers]);

  const openAddModal = () => {
    setFormData({ 
      name: "", 
      phone: "", 
      email: "", 
      address: "",
      isActive: true,
      creditLimit: "1000", 
      currentBalance: "0", 
      balance: "0",
      promocode: "",
      promoamount: ""
    });
    setSelectedCountryCode("+65");
    setLocalPhone("");
    setEditingMember(null);
    setModalMode("ADD");
  };

  const openEditModal = (member: MemberType) => {
    setEditingMember(member);
    const parsed = parsePhoneNumber(member.Phone);
    setSelectedCountryCode(parsed.countryCode);
    setLocalPhone(parsed.localNumber);
    setFormData({
      name: member.Name,
      phone: member.Phone,
      email: member.Email || "",
      address: member.Address || "",
      isActive: member.IsActive === true || member.IsActive === 1,
      creditLimit: String(member.CreditLimit ?? 0),
      currentBalance: String(member.CurrentBalance ?? 0),
      balance: String(member.Balance ?? 0),
      promocode: member.Promocode || "",
      promoamount: String(member.Promoamount ?? 0),
    });
    setModalMode("EDIT");
  };

  const handleSaveMember = async () => {
    if (!formData.name.trim() || !localPhone.trim()) {
      Alert.alert("Required", "Please fill Name and Phone.");
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = modalMode === "EDIT";
      const url = isEdit ? `${API_URL}/api/members/update` : `${API_URL}/api/members/add`;
      const fullPhone = `${selectedCountryCode}${localPhone.trim()}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          memberId: editingMember?.MemberId,
          name: formData.name.trim(),
          phone: fullPhone,
          email: formData.email.trim(),
          address: formData.address.trim(),
          isActive: formData.isActive,
          creditLimit: parseFloat(formData.creditLimit) || 0,
          currentBalance: parseFloat(formData.currentBalance) || 0,
          balance: editingMember ? (editingMember.Balance ?? 0) : 0,
          userId: user?.userId,
          promocode: formData.promocode.trim() || null,
          promoamount: parseFloat(formData.promoamount) || 0,
        }),
      });

      if (res.ok) {
        setModalMode("NONE");
        fetchMembers();
        Alert.alert("Success", isEdit ? "Member updated." : "Member added.");
      } else {
        Alert.alert("Error", "Save failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMember = (member: MemberType) => {
    setEditingMember(member);
    setShowDeleteModal(true);
  };

  const filteredMembers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return members.filter(m =>
      m.Name.toLowerCase().includes(query) ||
      m.Phone.includes(searchQuery)
    );
  }, [members, searchQuery]);

  const MemberCard = React.memo(({ item, onEdit, onDelete, onViewUsage, onCollectPayment, onSendWhatsApp, onRecharge, onSendLowBalanceReminder }: { item: MemberType; onEdit: (m: MemberType) => void; onDelete: (m: MemberType) => void; onViewUsage: (m: MemberType) => void; onCollectPayment: (m: MemberType) => void; onSendWhatsApp: (m: MemberType) => void; onRecharge: (m: MemberType) => void; onSendLowBalanceReminder: (m: MemberType) => void }) => {
    const creditLimit    = item.CreditLimit    || 0;
    const currentBalance = item.CurrentBalance || 0;
    const totalBalance   = item.Balance        || 0;
    const availableCredit = item.AvailableCredit !== undefined ? item.AvailableCredit : (creditLimit > 0 ? (creditLimit - currentBalance) : currentBalance);
    const isLowCredit    = availableCredit < 50;
    const alertSent      = item.LowBalanceAlertSent === true || item.LowBalanceAlertSent === 1;

    return (
      <View style={styles.memberCard}>
        {/* ── Card Header ── */}
        <View style={styles.cardHeader}>
          <View style={[styles.avatarCircle, isLowCredit && { backgroundColor: Theme.danger + '15' }]}>
            <Text style={[styles.avatarLetter, isLowCredit && { color: Theme.danger }]}>{item.Name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName}>{item.Name}</Text>
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={12} color={Theme.textSecondary} />
              <Text style={styles.memberPhone}>{item.Phone}</Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onSendWhatsApp(item)}
              style={[styles.actionBtn, { backgroundColor: "#25D366" + "15" }]}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onViewUsage(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.success + "15" }]}
            >
              <Ionicons name="stats-chart" size={18} color={Theme.success} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onEdit(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.primary + "15" }]}
            >
              <Ionicons name="create-outline" size={18} color={Theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onDelete(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.danger + "15" }]}
            >
              <Ionicons name="trash-outline" size={18} color={Theme.danger} />
            </TouchableOpacity>
          </View>
        </View>



        <View style={styles.cardDivider} />

        <View style={styles.contactDetailsRow}>
          <View style={styles.contactItem}>
            <Ionicons name="mail-outline" size={14} color={Theme.textSecondary} />
            <Text style={styles.contactText} numberOfLines={1}>{item.Email || "—"}</Text>
          </View>
          <View style={[styles.contactItem, { justifyContent: 'flex-end', flex: 0.6 }]}>
            <View style={[styles.badge, (item.IsActive === true || item.IsActive === 1) ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={[styles.badgeText, (item.IsActive === true || item.IsActive === 1) ? styles.textActive : styles.textInactive]}>
                {(item.IsActive === true || item.IsActive === 1) ? "ACTIVE" : "INACTIVE"}
              </Text>
            </View>
          </View>
        </View>

        {item.Address ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={14} color={Theme.textSecondary} style={{ marginTop: 2 }} />
            <Text style={styles.addressText} numberOfLines={2}>{item.Address}</Text>
          </View>
        ) : null}

        {item.Promocode ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, marginTop: 6 }}>
            <Ionicons name="gift-outline" size={14} color={Theme.primary} />
            <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
              Promo Code: <Text style={{ color: Theme.primary }}>{item.Promocode}</Text>
              {item.Promoamount ? ` (${formatMoney(item.Promoamount)})` : ''}
            </Text>
          </View>
        ) : null}

        {/* ── Low Credit Warning Badge ── */}
        {isLowCredit && (
          <View style={styles.lowCreditWarningBadge}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="alert-circle" size={16} color={Theme.danger} />
              <Text style={styles.lowCreditWarningTitle}>⚠ Low Credit Balance</Text>
            </View>
            <Text style={styles.lowCreditWarningStatus}>
              {alertSent ? "WhatsApp Alert Sent" : "Pending Alert"}
            </Text>
          </View>
        )}

        {/* ── Prepaid Balance Card ── */}
        <View style={styles.financialSummaryBlock}>
          <View style={styles.financialCol}>
            <Text style={styles.financialLabel}>PREPAID AMOUNT</Text>
            <Text style={[styles.financialVal, { color: Theme.success }]}>
              {formatMoney(creditLimit)}
            </Text>
          </View>
          <View style={[styles.financialCol, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Theme.border + '50' }]}>
            <Text style={styles.financialLabel}>CONSUMED</Text>
            <Text style={[styles.financialVal, { color: Theme.textPrimary }]}>
              {formatMoney(currentBalance)}
            </Text>
          </View>
          <View style={styles.financialCol}>
            <Text style={styles.financialLabel}>AVAILABLE BALANCE</Text>
            <Text style={[
              styles.financialVal,
              { color: isLowCredit ? Theme.danger : Theme.success }
            ]}>
              {formatMoney(availableCredit)}
            </Text>
          </View>
        </View>
      </View>
    );
  });

  const renderMember = useCallback(({ item }: { item: MemberType }) => {
    return (
      <MemberCard
        item={item}
        onEdit={openEditModal}
        onDelete={handleDeleteMember}
        onViewUsage={handleViewUsage}
        onCollectPayment={handleCollectPayment}
        onSendWhatsApp={handleSendWhatsApp}
        onRecharge={openRechargeModal}
        onSendLowBalanceReminder={handleSendLowBalanceReminder}
      />
    );
  }, [openEditModal, handleDeleteMember, handleViewUsage, handleCollectPayment, handleSendWhatsApp, openRechargeModal, handleSendLowBalanceReminder]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => {
              router.replace("/(tabs)/category" as any);
            }}
            style={styles.circularBack}
          >
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Member Management</Text>
          <TouchableOpacity onPress={openAddModal} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ Add Member</Text>
          </TouchableOpacity>
        </View>


        <View style={styles.searchWrapper}>
          <View style={styles.searchInner}>
            <Ionicons name="search" size={20} color={Theme.textMuted} />
            <TextInput
              placeholder="Search members..."
              placeholderTextColor={Theme.textMuted}
              style={styles.searchField}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={Theme.primary} /></View>
        ) : (
          <FlatList
            data={filteredMembers}
            keyExtractor={(item) => item.MemberId}
            renderItem={renderMember}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchMembers} tintColor={Theme.primary} />}
          />
        )}

        {/* Form Modal */}
        <Modal visible={modalMode !== "NONE"} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{modalMode === "EDIT" ? "Edit Member" : "Add Member"}</Text>
                <TouchableOpacity onPress={() => setModalMode("NONE")} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>NAME</Text>
                  <TextInput style={styles.sheetInput} value={formData.name} onChangeText={v => setFormData({ ...formData, name: v })} placeholder="Full Name" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>PHONE</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      style={styles.countrySelector}
                      onPress={() => setShowCountryPicker(true)}
                    >
                      <Text style={styles.countrySelectorText}>
                        {selectedCountryCode}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color={Theme.textSecondary} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.sheetInput, { flex: 1 }]}
                      keyboardType="phone-pad"
                      value={localPhone}
                      onChangeText={v => setLocalPhone(v.replace(/[^0-9]/g, ""))}
                      placeholder="Contact Number"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>EMAIL</Text>
                  <TextInput style={styles.sheetInput} keyboardType="email-address" value={formData.email} onChangeText={v => setFormData({ ...formData, email: v })} placeholder="Email Address" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ADDRESS</Text>
                  <TextInput style={[styles.sheetInput, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={formData.address} onChangeText={v => setFormData({ ...formData, address: v })} placeholder="Member Address" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>STATUS</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity 
                      style={[styles.statusToggle, formData.isActive && styles.activeToggle]} 
                      onPress={() => setFormData({ ...formData, isActive: true })}
                    >
                      <Text style={[styles.statusText, formData.isActive && styles.activeStatusText]}>Active</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.statusToggle, !formData.isActive && styles.inactiveToggle]} 
                      onPress={() => setFormData({ ...formData, isActive: false })}
                    >
                      <Text style={[styles.statusText, !formData.isActive && styles.inactiveStatusText]}>Inactive</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.inputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PREPAID AMOUNT</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.creditLimit} onChangeText={v => setFormData({ ...formData, creditLimit: v })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CONSUMED</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.currentBalance} onChangeText={v => setFormData({ ...formData, currentBalance: v })} />
                  </View>
                </View>

                <View style={styles.inputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PROMO CODE</Text>
                    <TextInput style={styles.sheetInput} value={formData.promocode} onChangeText={v => setFormData({ ...formData, promocode: v })} placeholder="Promo Code" placeholderTextColor={Theme.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PROMO AMOUNT</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.promoamount} onChangeText={v => setFormData({ ...formData, promoamount: v })} placeholder="0.00" placeholderTextColor={Theme.textMuted} />
                  </View>
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleSaveMember} disabled={isSaving}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{modalMode === "EDIT" ? "Update Record" : "Add Member"}</Text>}
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Country Picker Modal */}
        <Modal
          visible={showCountryPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCountryPicker(false)}
        >
          <TouchableOpacity 
            style={styles.pickerOverlay} 
            activeOpacity={1} 
            onPress={() => setShowCountryPicker(false)}
          >
            <View style={[styles.formSheet, { maxHeight: '60%', width: '80%' }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Select Country Code</Text>
                <TouchableOpacity onPress={() => setShowCountryPicker(false)} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ padding: 25 }} showsVerticalScrollIndicator={false}>
                {COUNTRIES.map((c) => (
                  <TouchableOpacity
                    key={c.code}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 14,
                      borderBottomWidth: 0.5,
                      borderBottomColor: Theme.border
                    }}
                    onPress={() => {
                      setSelectedCountryCode(c.code);
                      setShowCountryPicker(false);
                    }}
                  >
                    <Text style={{ fontSize: 15, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                      {c.label}  {c.name}
                    </Text>
                    {selectedCountryCode === c.code && (
                      <Ionicons name="checkmark" size={20} color={Theme.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Delete Modal */}
        <Modal visible={showDeleteModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.alertCard}>
              <View style={styles.alertIconBg}>
                <Ionicons name="alert-circle" size={40} color={Theme.danger} />
              </View>
              <Text style={styles.alertTitle}>Delete Customer</Text>
              <Text style={styles.alertMessage}>
                Do you want to delete this customer?{"\n"}
                <Text style={{ color: Theme.primary, fontSize: 16, fontFamily: Fonts.black }}>{editingMember?.Name}</Text>
              </Text>
              
              <View style={styles.alertActions}>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.cancelBtn]} 
                  onPress={() => { setEditingMember(null); setShowDeleteModal(false); }}
                >
                  <Text style={styles.btnLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.confirmDeleteBtn]} 
                  onPress={async () => {
                    const member = editingMember;
                    if (!member) return;
                    setIsSaving(true);
                    try {
                      const res = await fetch(`${API_URL}/api/members/delete`, {
                        method: "POST",
                        headers: { 
                          "Content-Type": "application/json",
                          Authorization: token ? `Bearer ${token}` : ""
                        },
                        body: JSON.stringify({ memberId: member.MemberId }),
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setMembers(prev => prev.filter(m => m.MemberId !== member.MemberId));
                        setEditingMember(null);
                        setShowDeleteModal(false);
                      }
                    } catch (err) {
                      console.error(err);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  <Text style={[styles.btnLabel, { color: '#fff' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        {/* ── Recharge Modal ── */}
        <Modal visible={showRechargeModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.formSheet, { maxHeight: 'auto' as any }]}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>Recharge Balance</Text>
                  <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13, marginTop: 4 }}>
                    {rechargeMember?.Name}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setShowRechargeModal(false); setRechargeMember(null); setRechargeAmount(''); }} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={{ padding: 25 }}>
                {/* Current balance info */}
                {rechargeMember && (
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                    <View style={{ flex: 1, backgroundColor: Theme.bgInput, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Theme.border }}>
                      <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: Theme.textMuted, marginBottom: 4 }}>CURRENT BALANCE</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.primary }}>
                        {formatMoney(rechargeMember.CurrentBalance || 0)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: Theme.bgInput, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Theme.border }}>
                      <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: Theme.textMuted, marginBottom: 4 }}>TOTAL PREPAID</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        {formatMoney(rechargeMember.Balance || 0)}
                      </Text>
                    </View>
                  </View>
                )}

                <Text style={styles.inputLabel}>RECHARGE AMOUNT (RM)</Text>
                <TextInput
                  style={[styles.sheetInput, { marginBottom: 20 }]}
                  keyboardType="numeric"
                  placeholder="Enter amount..."
                  placeholderTextColor={Theme.textMuted}
                  value={rechargeAmount}
                  onChangeText={setRechargeAmount}
                />

                {/* Quick amount buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
                  {[50, 100, 200, 500].map(amt => (
                    <TouchableOpacity
                      key={amt}
                      style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: 'center', alignItems: 'center' }}
                      onPress={() => setRechargeAmount(String(amt))}
                    >
                      <Text style={{ fontFamily: Fonts.bold, color: Theme.textPrimary, fontSize: 13 }}>RM {amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: '#F59E0B' }]}
                  onPress={handleRecharge}
                  disabled={isRecharging}
                >
                  {isRecharging
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="add-circle" size={20} color="#fff" />
                        <Text style={styles.submitBtnText}>Confirm Recharge</Text>
                      </View>
                    )
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Usage/Monthly History Modal */}
        <Modal visible={showUsageModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>Order History & Details</Text>
                  <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13, marginTop: 4 }}>
                    {usageMember?.Name} • {usageMember?.Phone}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setShowUsageModal(false); setUsageMember(null); setUsageData(null); }} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingUsage ? (
                <View style={[styles.center, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                </View>
              ) : (
                <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                  {/* Summary Dashboard */}
                  <View style={{ flexDirection: 'row', gap: 15, marginBottom: 20 }}>
                    <View style={{ flex: 1, backgroundColor: Theme.primary + '10', padding: 15, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: Theme.primary }}>
                      <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.primary, marginBottom: 4 }}>TOTAL ORDERS</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        {usageData?.summary?.TotalOrders || 0}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: Theme.success + '10', padding: 15, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: Theme.success }}>
                      <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.success, marginBottom: 4 }}>TOTAL SPENT</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        ${(usageData?.summary?.TotalSpent || 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>

                  {/* Consumed Items Breakdown */}
                  <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary, marginBottom: 10, letterSpacing: 0.5 }}>
                    ITEMS CONSUMED THIS MONTH
                  </Text>
                  {usageData?.items && usageData.items.length > 0 ? (
                    <View style={{ backgroundColor: Theme.bgInput, borderRadius: 16, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: Theme.border }}>
                      {usageData.items.map((item, idx) => (
                        <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: idx < usageData.items.length - 1 ? 1 : 0, borderBottomColor: Theme.border }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>{item.DishName}</Text>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted }}>Qty: {item.TotalQty}</Text>
                          </View>
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.success }}>
                            ${(item.TotalAmount || 0).toFixed(2)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textMuted, marginBottom: 20, fontStyle: 'italic' }}>
                      No items consumed this month.
                    </Text>
                  )}

                  {/* Transaction History list */}
                  <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary, marginBottom: 10, letterSpacing: 0.5 }}>
                    RECENT BILLS
                  </Text>
                  {usageData?.transactions && usageData.transactions.length > 0 ? (
                    <View style={{ gap: 8, marginBottom: 30 }}>
                      {usageData.transactions.map((tx) => {
                        const dateObj = new Date(tx.LastSettlementDate);
                        return (
                          <TouchableOpacity 
                            key={tx.SettlementID} 
                            activeOpacity={0.7}
                            onPress={() => handleBillPress(tx)}
                            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Theme.bgInput, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Theme.border }}
                          >
                            <View>
                              <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>Bill #{tx.BillNo}</Text>
                              <Text style={{ fontFamily: Fonts.medium, fontSize: 10, color: Theme.textMuted }}>
                                {formatToSingaporeDate(tx.LastSettlementDate)} • {formatToSingaporeTime(tx.LastSettlementDate)}
                              </Text>
                            </View>
                            <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary }}>
                              ${(tx.SysAmount || 0).toFixed(2)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textMuted, marginBottom: 30, fontStyle: 'italic' }}>
                      No recent transaction records.
                    </Text>
                  )}

                  <TouchableOpacity style={styles.submitBtn} onPress={() => { setShowUsageModal(false); setUsageMember(null); setUsageData(null); }}>
                    <Text style={styles.submitBtnText}>Done</Text>
                  </TouchableOpacity>
                  <View style={{ height: 30 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Bill Details Modal */}
        <Modal visible={showBillDetailsModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.formSheet, { maxWidth: 450 }]}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>Bill Details</Text>
                  {selectedBill && (
                    <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13, marginTop: 4 }}>
                      Bill #{selectedBill.BillNo}
                    </Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => { setShowBillDetailsModal(false); setSelectedBill(null); setBillDetails([]); }} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingBillDetails ? (
                <View style={[styles.center, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                </View>
              ) : (
                <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                  {selectedBill && (
                    <View style={{ marginBottom: 20 }}>
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textMuted, marginBottom: 8 }}>
                        DATE & TIME
                      </Text>
                      <Text style={{ fontFamily: Fonts.black, fontSize: 15, color: Theme.textPrimary }}>
                        {`${formatToSingaporeDate(selectedBill.LastSettlementDate, { day: 'numeric', month: 'short', year: 'numeric' })} • ${formatToSingaporeTime(selectedBill.LastSettlementDate)}`}
                      </Text>
                    </View>
                  )}

                  <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary, marginBottom: 10, letterSpacing: 0.5 }}>
                    ITEMS ORDERED
                  </Text>
                  {billDetails && billDetails.length > 0 ? (
                    <View style={{ backgroundColor: Theme.bgInput, borderRadius: 16, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: Theme.border }}>
                      {billDetails.map((item, idx) => (
                        <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: idx < billDetails.length - 1 ? 1 : 0, borderBottomColor: Theme.border }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>{item.DishName}</Text>
                            {item.modifiers && item.modifiers.length > 0 && (
                              <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted, marginLeft: 8 }}>
                                + {item.modifiers.map((m: any) => m.ModifierName).join(", ")}
                              </Text>
                            )}
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted }}>Qty: {item.Qty} x {formatMoney(item.Price)}</Text>
                          </View>
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.success }}>
                            {formatMoney((item.Price || 0) * (item.Qty || 0))}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textMuted, marginBottom: 20, fontStyle: 'italic' }}>
                      No items recorded.
                    </Text>
                  )}

                  {selectedBill && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Theme.primary + '10', padding: 16, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: Theme.primary, marginBottom: 25 }}>
                      <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.primary }}>TOTAL AMOUNT</Text>
                      <Text style={{ fontFamily: Fonts.black, fontSize: 18, color: Theme.textPrimary }}>
                        {formatMoney(selectedBill.SysAmount)}
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity style={styles.submitBtn} onPress={() => { setShowBillDetailsModal(false); setSelectedBill(null); setBillDetails([]); }}>
                    <Text style={styles.submitBtnText}>Close</Text>
                  </TouchableOpacity>
                  <View style={{ height: 30 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>


      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiContainer: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 12, marginBottom: 15 },
  kpiCard: { flex: 1, minWidth: 150, padding: 15, borderRadius: 16, borderWidth: 1, ...Theme.shadowSm },
  kpiLabel: { fontSize: 9, fontFamily: Fonts.black, letterSpacing: 0.5 },
  kpiVal: { fontSize: 18, fontFamily: Fonts.black, marginTop: 4 },
  container: { flex: 1, backgroundColor: Theme.bgMain },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 15 },
  circularBack: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  screenTitle: { flex: 1, color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  addBtn: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Theme.primary, borderRadius: 12, ...Theme.shadowSm },
  addBtnText: { color: "#fff", fontFamily: Fonts.bold, fontSize: 13 },
  searchWrapper: { marginHorizontal: 20, marginBottom: 20 },
  searchInner: { 
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 56, 
    borderRadius: 16, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm 
  },
  searchField: { flex: 1, color: Theme.textPrimary, fontFamily: Fonts.medium, fontSize: 16, marginLeft: 12, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  listContainer: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  memberCard: { 
    backgroundColor: Theme.bgCard, borderRadius: 20, padding: 20, 
    borderLeftWidth: 5, borderLeftColor: Theme.primary, ...Theme.shadowMd,
    borderWidth: 1, borderColor: Theme.border
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center" },
  avatarLetter: { color: Theme.primary, fontSize: 18, fontFamily: Fonts.black },
  memberName: { color: Theme.textPrimary, fontSize: 18, fontFamily: Fonts.bold },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  memberPhone: { color: Theme.textSecondary, fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cardDivider: { height: 1, backgroundColor: Theme.border, marginVertical: 15 },
  contactDetailsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  contactText: { fontSize: 13, color: Theme.textPrimary, fontFamily: Fonts.medium },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  addressText: { fontSize: 13, color: Theme.textSecondary, fontFamily: Fonts.medium, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeActive: { backgroundColor: Theme.success + '15' },
  badgeInactive: { backgroundColor: Theme.danger + '15' },
  badgeText: { fontSize: 11, fontFamily: Fonts.bold },
  textActive: { color: Theme.success },
  textInactive: { color: Theme.danger },
  financialSummaryBlock: {
    flexDirection: 'row',
    backgroundColor: Theme.bgInput,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: 'space-between',
  },
  financialCol: { flex: 1, alignItems: 'center' },
  financialLabel: { fontSize: 9, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 4, letterSpacing: 0.5 },
  financialVal: { fontSize: 13, fontFamily: Fonts.black },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  formSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: '100%', maxWidth: 500, ...Theme.shadowLg, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, borderBottomWidth: 1, borderBottomColor: Theme.border },
  sheetTitle: { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black },
  sheetClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.bgMuted, justifyContent: 'center', alignItems: 'center' },
  sheetBody: { padding: 25 },
  inputGroup: { marginBottom: 20 },
  inputRow: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  inputLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, marginBottom: 8, letterSpacing: 0.5 },
  sheetInput: { 
    height: 56, backgroundColor: Theme.bgInput, borderRadius: 14, color: Theme.textPrimary, 
    paddingHorizontal: 16, fontSize: 15, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  statusToggle: { flex: 1, height: 50, borderRadius: 12, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: 'center', alignItems: 'center' },
  activeToggle: { backgroundColor: Theme.success + '15', borderColor: Theme.success },
  inactiveToggle: { backgroundColor: Theme.danger + '15', borderColor: Theme.danger },
  statusText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 14 },
  activeStatusText: { color: Theme.success },
  inactiveStatusText: { color: Theme.danger },
  submitBtn: { backgroundColor: Theme.primary, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 15, ...Theme.shadowMd },
  submitBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 16 },
  alertCard: { width: '100%', maxWidth: 360, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 30, alignItems: 'center', ...Theme.shadowLg, borderWidth: 1, borderColor: Theme.border },
  alertIconBg: { width: 80, height: 80, borderRadius: 40, backgroundColor: Theme.danger + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  alertTitle: { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black, marginBottom: 10 },
  alertMessage: { color: Theme.textSecondary, fontSize: 15, fontFamily: Fonts.medium, textAlign: 'center', lineHeight: 22, marginBottom: 30 },
  alertActions: { flexDirection: 'row', gap: 15, width: '100%' },
  alertBtn: { flex: 1, height: 56, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { backgroundColor: Theme.bgMuted, borderWidth: 1, borderColor: Theme.border },
  confirmDeleteBtn: { backgroundColor: Theme.danger },
  // Low-balance banner
  lowBalanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B' + '15',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#F59E0B' + '40',
    gap: 8,
  },
  lowBalanceText: { flex: 1, fontSize: 12, fontFamily: Fonts.bold, color: '#B45309' },
  lowBalanceWABtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25D366',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  lowBalanceWAText: { fontSize: 11, fontFamily: Fonts.bold, color: '#fff' },
  btnLabel: { color: Theme.textSecondary, fontSize: 15, fontFamily: Fonts.bold },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: Theme.bgInput,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 16,
    gap: 8,
  },
  countrySelectorText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lowCreditWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Theme.danger + '15',
    borderColor: Theme.danger + '40',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  lowCreditWarningTitle: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.danger,
  },
  lowCreditWarningStatus: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
});
