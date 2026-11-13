import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
  useWindowDimensions,
  FlatList,
  Pressable,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import { useCartStore, CartItem, getContextId } from "@/stores/cartStore";
import { useOrderContextStore } from "@/stores/orderContextStore";
import { useCompanySettingsStore } from "@/stores/companySettingsStore";
import { useGeneralSettingsStore } from "@/stores/generalSettingsStore";
import { useMenuStore } from "@/stores/menuStore";
import { useToast } from "@/components/Toast";
import StoreSettingsModal from "@/components/payment/StoreSettingsModal";
import PayNowPaymentModal from "@/components/payment/PayNowPaymentModal";
import ComboCustomizer from "@/components/ComboCustomizer";
import UniversalPrinter from "@/components/UniversalPrinter";
import DiscountModal from "@/components/DiscountModal";
import ItemDiscountModal from "@/components/ItemDiscountModal";
import { socket } from "@/constants/socket";
import { CustomerDisplaySync } from "@/utils/CustomerDisplaySync";
import { useQuickCashStore } from "@/stores/quickCashStore";
import { SyncStatusBadge } from "@/components/SyncStatusBadge";

const getImageUrl = (imagePath: string | null | undefined) => {
  if (!imagePath) return null;
  const pathStr = String(imagePath).trim();
  if (!pathStr) return null;
  if (pathStr.startsWith("http://") || pathStr.startsWith("https://") || pathStr.startsWith("data:")) {
    return pathStr;
  }
  return `${API_URL}/api/menu/image/${pathStr}`;
};

const DEFAULT_DISH_IMAGES = [
  "https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=400&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&auto=format&fit=crop&q=80",
];

const ALL_ITEMS_IMAGE = "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=300&auto=format&fit=crop&q=80";

const QuickServeDishCard = React.memo(
  ({
    dish,
    idx,
    width,
    cartQty,
    onPress,
    isPhone,
    isTablet,
    isLandscape,
    currencySymbol,
  }: {
    dish: any;
    idx: number;
    width: number;
    cartQty: number;
    onPress: (dish: any) => void;
    isPhone: boolean;
    isTablet: boolean;
    isLandscape: boolean;
    currencySymbol: string;
  }) => {
    const isSC =
      (Number(dish.isServiceCharge) === 1 || dish.isServiceCharge === true) &&
      useGeneralSettingsStore.getState().settings?.SVCIdentification !== false;
    const isSoldOut =
      dish.IsSoldOut === true ||
      String(dish.IsSoldOut) === "1" ||
      dish.IsSoldOut === 1 ||
      dish.isSoldOut === true ||
      String(dish.isSoldOut) === "1" ||
      dish.isSoldOut === 1;

    const rawImg = dish.Image || dish.ImagePath || dish.image;
    const imgUri = getImageUrl(rawImg) || DEFAULT_DISH_IMAGES[idx % DEFAULT_DISH_IMAGES.length];
    const price = Number(dish.Price || dish.currentcost || 0);

    return (
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.dishCard,
          { width, paddingVertical: 5, paddingHorizontal: 4 },
          isSC && {
            borderWidth: 1.5,
            borderColor: Theme.dangerBorder,
            backgroundColor: Theme.dangerBg,
          },
          !isSC && {
            borderWidth: 1,
            borderColor: "#F1F5F9",
            backgroundColor: "#FFFFFF",
          },
          isSoldOut && { opacity: 0.5 },
          pressed && !isSoldOut && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => onPress(dish)}
        disabled={isSoldOut}
      >
        {cartQty > 0 && (
          <View
            style={[
              styles.qtyBadge,
              { width: 18, height: 18, borderRadius: 9 },
            ]}
          >
            <Text
              style={[
                styles.qtyBadgeText,
                { fontSize: 9.5 },
              ]}
            >
              {cartQty}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.dishImageWrap,
            {
              width: 38,
              height: 38,
              marginBottom: 3,
              borderRadius: 19,
            },
          ]}
        >
          {imgUri ? (
            <Image
              source={{ uri: imgUri }}
              style={styles.dishImg}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
              priority="high"
              recyclingKey={String(dish.DishId || rawImg || idx)}
            />
          ) : (
            <View
              style={[
                styles.dishImg,
                {
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: Theme.bgMuted,
                },
              ]}
            >
              <Ionicons
                name="restaurant-outline"
                size={20}
                color={Theme.textMuted}
              />
            </View>
          )}

          {isSoldOut && (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0,0,0,0.4)",
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 19,
              }}
            >
              <Text
                style={{
                  color: "#fff",
                  fontSize: 8,
                  fontFamily: Fonts.bold,
                  textAlign: "center",
                }}
              >
                SOLD OUT
              </Text>
            </View>
          )}
        </View>

        <Text
          style={[
            styles.dishName,
            { fontSize: 10.5, minHeight: 24, lineHeight: 12 },
          ]}
          numberOfLines={2}
        >
          {dish.Name}
        </Text>

        <Text
          style={[
            styles.dishPrice,
            { fontSize: 11.5, marginTop: 1 },
          ]}
        >
          {(() => {
            return Number(dish.IsOpenItem) === 1 ||
              dish.IsOpenItem === true ||
              dish.IsOpenItem === "true" ||
              dish.IsOpenItem === "1"
              ? "Open Price"
              : `${currencySymbol}${price.toFixed(2)}`;
          })()}
        </Text>

        {isSoldOut ? (
          <View
            style={{
              backgroundColor: "#EF444422",
              borderRadius: 4,
              paddingHorizontal: 5,
              paddingVertical: 1,
              marginTop: 2,
              borderWidth: 1,
              borderColor: "#EF444444",
              alignSelf: "center",
            }}
          >
            <Text style={{ fontSize: 9, color: "#EF4444", fontFamily: Fonts.bold }}>
              SOLD OUT
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  }
);

export default function QuickServePOSScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1100;
  const isLandscape = width > height;
  const isTabletDevice = Math.min(width, height) >= 500;
  const isPhoneDevice = !isTabletDevice;
  const [dishesPanelWidth, setDishesPanelWidth] = useState<number>(0);

  // Mobile navigation tab: "order" (Cart/Checkout) | "groups" (Categories/Groups) | "dishes" (Menu Items)
  const [mobileActiveTab, setMobileActiveTab] = useState<"order" | "groups" | "dishes">("dishes");
  const toast = useToast();
  const { user } = useAuthStore();

  // Quick Serve UI Mode Toggle (ON / OFF)
  const [quickServeModeEnabled, setQuickServeModeEnabled] = useState<boolean>(true);
  const [tablesList, setTablesList] = useState<any[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>("Section 1");
  const [loadingTables, setLoadingTables] = useState<boolean>(false);

  // Table Master State & Free Table Auto-Selection
  const [allMasterTables, setAllMasterTables] = useState<any[]>([]);
  const [selectedTable, setSelectedTable] = useState<any | null>(null);
  const [tableModalVisible, setTableModalVisible] = useState<boolean>(false);
  const [tableFilterTab, setTableFilterTab] = useState<"free" | "all">("free");
  const [tableSearchQuery, setTableSearchQuery] = useState<string>("");
  const [isTableSearchOpen, setIsTableSearchOpen] = useState<boolean>(false);

  // Modifiers Cache for Instant (0ms) Dish Adding
  const [modifiersCache, setModifiersCache] = useState<Record<string, any[]>>({});

  // Quick Serve Order Context (POS Order ID Format)
  const [quickServeToken, setQuickServeToken] = useState<string>("");

  const generatePosOrderId = async () => {
    try {
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const res = await fetch(`${API_URL}/api/sales/daily-order-count`).then((r) => r.json()).catch(() => null);
      const nextNum = res?.nextNumber || Math.floor(100 + Math.random() * 900);
      const formattedId = `${todayStr}-${String(nextNum).padStart(4, "0")}`;
      setQuickServeToken(formattedId);
      return formattedId;
    } catch {
      const fallbackNum = Math.floor(1000 + Math.random() * 9000);
      const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const formattedId = `${todayStr}-${fallbackNum}`;
      setQuickServeToken(formattedId);
      return formattedId;
    }
  };

  // General settings feature toggles
  const showLoyalty = useGeneralSettingsStore((s: any) => s.settings?.showLoyalty !== false);
  const showRewardPoints = useGeneralSettingsStore((s: any) => s.settings?.showRewardPoints !== false);
  const showPromoCode = useGeneralSettingsStore((s: any) => s.settings?.showPromoCode !== false);
  const quickServeEnableKOT = useGeneralSettingsStore((s: any) => s.settings?.quickServeEnableKOT !== false);
  const quickServeEnableKDSPrinter = useGeneralSettingsStore((s: any) => s.settings?.quickServeEnableKDSPrinter !== false);
  const enableReceiptPrint = useGeneralSettingsStore((s: any) => s.settings?.enableReceiptPrint !== false);
  const enableCheckoutBill = useGeneralSettingsStore((s: any) => s.settings?.enableCheckoutBill !== false);
  const fetchGeneralSettings = useGeneralSettingsStore((s: any) => s.fetchSettings);

  useEffect(() => {
    fetchGeneralSettings();
    generatePosOrderId();

    // Load tables from Table Master & auto-select first free table
    fetchMasterTablesAndAutoSelectFree();

    AsyncStorage.getItem("QUICK_SERVE_MODE_ENABLED").then((val) => {
      if (val !== null) {
        const isEnabled = val === "true";
        setQuickServeModeEnabled(isEnabled);
        if (!isEnabled) {
          fetchNormalPOSTables();
        }
      }
    });
  }, [fetchGeneralSettings]);

  useFocusEffect(
    useCallback(() => {
      fetchMasterTablesAndAutoSelectFree();
      fetchGeneralSettings();
    }, [fetchGeneralSettings])
  );

  const getSectionFromDiningSection = (ds?: any): string => {
    if (!ds) return "SECTION_1";
    const str = String(ds).trim();
    if (str.startsWith("SECTION_")) return str;
    const num = Number(str);
    if (num === 1) return "SECTION_1";
    if (num === 2) return "SECTION_2";
    if (num === 3) return "SECTION_3";
    if (num === 4) return "TAKEAWAY";
    return str || "SECTION_1";
  };

  const selectQuickServeTable = async (table: any, forceFetch: boolean = true) => {
    if (!table) return;

    const tId = String(table.id || table.TableId || "");
    const rawName = String(table.label || table.TableNumber || table.name || "01");
    const formattedName = rawName.toLowerCase().startsWith("table") ? rawName : `Table ${rawName}`;
    const sec = table.section || table.SectionName || table.sectionName || getSectionFromDiningSection(table.DiningSection);
    const isFree = table.Status === 0 || table.Status === null || table.Status === undefined || String(table.Status) === "0";

    setSelectedTable(table);

    const newContext = {
      orderType: "DINE_IN" as const,
      section: sec,
      tableId: tId,
      tableNo: formattedName,
      tableName: formattedName,
    };

    useOrderContextStore.getState().setOrderContext(newContext);

    const contextId = getContextId(newContext);
    if (contextId) {
      useCartStore.getState().setCurrentContext(contextId);
      if (isFree) {
        useCartStore.getState().setCartItems(contextId, [], true, "QUICK_SERVE_SELECT_FREE");
      }
    }

    if (tId) {
      try {
        await useCartStore.getState().fetchCartFromDB(tId, forceFetch);
      } catch (err) {
        console.error("Error fetching cart for quick serve table:", err);
      }
    }
  };

  // Helper to sort tables identically to Floor Plan:
  // 1. DiningSection ascending (1, 2, 3, 4...)
  // 2. SortCode ascending (if configured)
  // 3. Natural alphanumeric ordering on label / TableNumber (e.g., 1, 2, 10 or 1A, 1B, 2A)
  const sortTablesLikeFloorPlan = (a: any, b: any) => {
    const secA = Number(a.DiningSection || a.diningSection || 1);
    const secB = Number(b.DiningSection || b.diningSection || 1);
    if (secA !== secB) return secA - secB;

    const sortA = a.SortCode !== undefined && a.SortCode !== null ? Number(a.SortCode) : null;
    const sortB = b.SortCode !== undefined && b.SortCode !== null ? Number(b.SortCode) : null;
    if (sortA !== null && sortB !== null && !isNaN(sortA) && !isNaN(sortB) && sortA !== sortB) {
      return sortA - sortB;
    }

    const labelA = String(a.label || a.TableNumber || a.name || "");
    const labelB = String(b.label || b.TableNumber || b.name || "");
    return labelA.localeCompare(labelB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  };

  const fetchMasterTablesAndAutoSelectFree = async (keepCurrentIfFree = false) => {
    try {
      const res = await fetch(`${API_URL}/api/tables/all`).then((r) => r.json()).catch(() => []);
      if (Array.isArray(res) && res.length > 0) {
        const sorted = [...res].sort(sortTablesLikeFloorPlan);
        setAllMasterTables(sorted);
        const freeTables = sorted.filter(
          (t: any) => t.Status === 0 || t.Status === null || t.Status === undefined || String(t.Status) === "0"
        );

        const activeOrderObj = useOrderContextStore.getState().currentOrder;

        let tableToSelect = null;
        if (keepCurrentIfFree && selectedTable) {
          const currentId = String(selectedTable.id || selectedTable.TableId || "");
          const stillFree = freeTables.find((t: any) => String(t.id || t.TableId) === currentId);
          if (stillFree) tableToSelect = stillFree;
        }

        if (!tableToSelect && activeOrderObj?.tableId) {
          const activeId = String(activeOrderObj.tableId);
          const matched = sorted.find((t: any) => String(t.id || t.TableId) === activeId);
          if (matched) tableToSelect = matched;
        }

        if (!tableToSelect) {
          tableToSelect = freeTables.length > 0 ? freeTables[0] : sorted[0];
        }

        if (tableToSelect) {
          await selectQuickServeTable(tableToSelect, true);
        }
      }
    } catch (err) {
      console.error("Error fetching master tables:", err);
    }
  };

  const filteredMasterTables = useMemo(() => {
    let list = allMasterTables;
    if (tableFilterTab === "free") {
      list = list.filter((t: any) => t.Status === 0 || !t.Status || String(t.Status) === "0");
    }
    const q = tableSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t: any) => {
        const rawName = String(t.label || t.TableNumber || `Table ${t.id}`).toLowerCase();
        const numOnly = String(t.label || t.TableNumber || t.id || "").replace(/[^0-9]/g, "");
        const idStr = String(t.id || t.TableId || "").toLowerCase();
        return rawName.includes(q) || numOnly.includes(q) || idStr.includes(q);
      });
    }

    return [...list].sort(sortTablesLikeFloorPlan);
  }, [allMasterTables, tableFilterTab, tableSearchQuery]);

  const toggleQuickServeMode = (enabled?: boolean) => {
    const nextVal = enabled !== undefined ? enabled : !quickServeModeEnabled;
    setQuickServeModeEnabled(nextVal);
    AsyncStorage.setItem("QUICK_SERVE_MODE_ENABLED", String(nextVal));
    if (!nextVal) {
      fetchNormalPOSTables();
    }
  };

  const fetchNormalPOSTables = async () => {
    setLoadingTables(true);
    try {
      const res = await fetch(`${API_URL}/api/tables/all`).then((r) => r.json()).catch(() => []);
      if (Array.isArray(res)) {
        setTablesList(res);
      }
    } catch (err) {
      console.error("Error fetching tables:", err);
    } finally {
      setLoadingTables(false);
    }
  };

  // Cart Store State & Helpers
  const cartItems = useCartStore((state) => state.getCart());
  const addToCartGlobal = useCartStore((state) => state.addToCartGlobal);
  const updateCartItemQty = useCartStore((state) => state.updateCartItemQty);
  const removeFromCartGlobal = useCartStore((state) => state.removeFromCartGlobal);
  const clearCart = useCartStore((state) => state.clearCart);

  // Categories, Dish Groups, Dishes Data synced with useMenuStore
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedKitchenId, setSelectedKitchenId] = useState<string>("");
  const [groups, setGroups] = useState<any[]>([]);
  const [dishGroups, setDishGroups] = useState<any[]>([]);
  const [allDishGroups, setAllDishGroups] = useState<any[]>([]);
  const [dishes, setDishes] = useState<any[]>([]);

  // Left Panel View Toggle: "category" | "dishgroup" | "favorites" (Default: "favorites")
  const [leftPanelView, setLeftPanelView] = useState<"category" | "dishgroup" | "favorites">("favorites");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedDishGroupId, setSelectedDishGroupId] = useState<string | number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  // Menu Navigation Mode from General Settings: "scroll" | "prev_next"
  const menuNavigationMode =
    useGeneralSettingsStore((s: any) => s.settings?.menuNavigationMode) || "scroll";

  // Dish Group Pagination (when menuNavigationMode === 'prev_next')
  // 2 columns x 7 rows to display up to 14 dish groups per page
  const [groupPage, setGroupPage] = useState<number>(1);
  const GROUPS_PER_PAGE = 14;

  // Dish Group Vertical Scroll Navigation Ref and Measurements
  const dishGroupScrollRef = useRef<ScrollView>(null);
  const [dishGroupScrollOffset, setDishGroupScrollOffset] = useState<number>(0);
  const [dishGroupContentHeight, setDishGroupContentHeight] = useState<number>(0);
  const [dishGroupContainerHeight, setDishGroupContainerHeight] = useState<number>(0);

  const handleGroupPageChange = (newPage: number) => {
    setGroupPage(newPage);
    if (dishGroupScrollRef.current) {
      dishGroupScrollRef.current.scrollTo({ y: 0, animated: false });
      setDishGroupScrollOffset(0);
    }
  };

  // Filters & Views
  const [vegFilter, setVegFilter] = useState<"all" | "veg" | "non-veg">("all");
  const [sortBy, setSortBy] = useState<string>("NAME_ASC");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // Dish Grid Pagination State & Ref (16 dishes per page: 4 rows × 4 columns)
  const [dishPage, setDishPage] = useState<number>(1);
  const dishesScrollRef = useRef<any>(null);
  const DISHES_PER_PAGE = 16;

  const scrollDishesToTop = () => {
    if (!dishesScrollRef.current) return;
    if (typeof dishesScrollRef.current.scrollToOffset === "function") {
      dishesScrollRef.current.scrollToOffset({ offset: 0, animated: false });
    } else if (typeof dishesScrollRef.current.scrollTo === "function") {
      dishesScrollRef.current.scrollTo({ y: 0, animated: false });
    }
  };

  // Reset dish pagination to page 1 whenever dish group, category, search or filters change
  useEffect(() => {
    setDishPage(1);
    scrollDishesToTop();
  }, [selectedDishGroupId, selectedGroupId, selectedCategoryId, leftPanelView, searchQuery, vegFilter, sortBy]);

  // Reset group page to 1 when left panel view changes
  useEffect(() => {
    setGroupPage(1);
    if (dishGroupScrollRef.current) {
      dishGroupScrollRef.current.scrollTo({ y: 0, animated: false });
      setDishGroupScrollOffset(0);
    }
  }, [leftPanelView]);

  // Modals & Popups State for POS Flow
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [showModifier, setShowModifier] = useState<boolean>(false);
  const [selectedDish, setSelectedDish] = useState<any | null>(null);
  const [selectedModifierQuantities, setSelectedModifierQuantities] = useState<Record<string, number>>({});
  const [loadingModifiers, setLoadingModifiers] = useState<boolean>(false);

  // Open Modifier (Custom Item Modal - Image 2) State
  const [showCustomModModal, setShowCustomModModal] = useState<boolean>(false);
  const [customModName, setCustomModName] = useState<string>("");
  const [customModPrice, setCustomModPrice] = useState<string>("");
  const [activeOpenMod, setActiveOpenMod] = useState<any | null>(null);
  const [customMods, setCustomMods] = useState<any[]>([]);

  const [showOpenItemModal, setShowOpenItemModal] = useState<boolean>(false);
  const [openItemDish, setOpenItemDish] = useState<any | null>(null);
  const [openItemPrice, setOpenItemPrice] = useState<string>("");
  const [openItemError, setOpenItemError] = useState<string>("");

  const [showComboModal, setShowComboModal] = useState<boolean>(false);
  const [comboDish, setComboDish] = useState<any | null>(null);

  // Payment State
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("CASH");
  const [activePaymodes, setActivePaymodes] = useState<any[]>([]);
  const paymodeScrollRef = useRef<ScrollView>(null);
  const [scrollOffset, setScrollOffset] = useState<number>(0);

  const scrollPaymodesVertically = (direction: "up" | "down") => {
    if (paymodeScrollRef.current) {
      const delta = direction === "down" ? 52 : -52;
      const nextOffset = Math.max(0, scrollOffset + delta);
      paymodeScrollRef.current.scrollTo({
        y: nextOffset,
        animated: true,
      });
      setScrollOffset(nextOffset);
    }
  };

  const [customAmount, setCustomAmount] = useState<string>("");
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [discountModalVisible, setDiscountModalVisible] = useState<boolean>(false);
  const [tempDiscount, setTempDiscount] = useState<string>("");
  const [isProcessingPayment, setIsProcessingPayment] = useState<boolean>(false);
  const [showCashModal, setShowCashModal] = useState<boolean>(false);
  const [cashReceivedInput, setCashReceivedInput] = useState<string>("");
  const cashInputRef = useRef<TextInput>(null);
  const quickCashAmounts = useQuickCashStore((s) => s.amounts);

  // Keypad handler for Cash Received popup
  const handleCashKeypadPress = useCallback((val: string) => {
    if (val === "clear") {
      setCashReceivedInput("");
    } else if (val === "backspace") {
      setCashReceivedInput((prev) => (prev.length > 0 ? prev.slice(0, -1) : ""));
    } else if (val === ".") {
      setCashReceivedInput((prev) => {
        if (!prev) return "0.";
        if (prev.includes(".")) return prev;
        return prev + ".";
      });
    } else {
      setCashReceivedInput((prev) => {
        if (prev === "0") return val;
        if (prev.includes(".")) {
          const parts = prev.split(".");
          if (parts[1] && parts[1].length >= 2) return prev;
        }
        return prev + val;
      });
    }
    if (cashInputRef.current) {
      cashInputRef.current.focus();
    }
  }, []);


  const [storeSettingsVisible, setStoreSettingsVisible] = useState<boolean>(false);

  // Member & Credit Customer Modal State
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [showMemberModal, setShowMemberModal] = useState<boolean>(false);
  const [memberModalType, setMemberModalType] = useState<"MEMBER" | "CREDIT">("MEMBER");
  const [memberQuery, setMemberQuery] = useState<string>("");
  const [membersList, setMembersList] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState<boolean>(false);

  // Quick Add Customer State
  const [isQuickAddMode, setIsQuickAddMode] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newPhone, setNewPhone] = useState<string>("");
  const [newEmail, setNewEmail] = useState<string>("");
  const [newAddress, setNewAddress] = useState<string>("");
  const [newCreditLimit, setNewCreditLimit] = useState<string>("1000");
  const [newIsActive, setNewIsActive] = useState<boolean>(true);
  const [addingCustomer, setAddingCustomer] = useState<boolean>(false);

  // YeahPay Terminal Modal State
  const [terminalModalVisible, setTerminalModalVisible] = useState<boolean>(false);
  const [terminalStatus, setTerminalStatus] = useState<"idle" | "processing" | "success" | "cancelled" | "failed">("idle");
  const [terminalMessage, setTerminalMessage] = useState<string>("");

  // PayNow QR Modal State
  const [showPayNowModal, setShowPayNowModal] = useState<boolean>(false);

  // Discount, Promo, Reward, Loyalty Modals State
  const [showDiscountTypeModal, setShowDiscountTypeModal] = useState<boolean>(false);
  const [showDiscount, setShowDiscount] = useState<boolean>(false);
  const [showItemDiscount, setShowItemDiscount] = useState<boolean>(false);

  // Promo Code Modal State & Handler
  const [showPromoModal, setShowPromoModal] = useState<boolean>(false);
  const [promoCodeInput, setPromoCodeInput] = useState<string>("");
  const [isApplyingPromo, setIsApplyingPromo] = useState<boolean>(false);

  const handlePromoCode = async (code: string) => {
    if (!code || code.trim() === "") {
      toast.showToast({ message: "Enter Promo Code", type: "warning" });
      return;
    }
    try {
      setIsApplyingPromo(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(code.trim())}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let errMsg = "Invalid Promo Code";
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch (_) {}
        toast.showToast({ message: errMsg, type: "error" });
        return;
      }
      const data = await res.json();
      const promoAmount = parseFloat(data.Promoamount) || 0;
      if (promoAmount <= 0) {
        toast.showToast({ message: "Promo code has 0 amount", type: "warning" });
        return;
      }

      const discountData = {
        applied: true,
        type: "fixed" as const,
        value: promoAmount,
        label: `Promo: ${code.trim()}`,
      };
      useCartStore.getState().applyDiscount(discountData);

      toast.showToast({ message: `🎉 Applied Promo Code! ($${promoAmount.toFixed(2)})`, type: "success" });
      setShowPromoModal(false);
      setPromoCodeInput("");
    } catch (err) {
      console.error("Promo code apply error:", err);
      toast.showToast({ message: "Failed to apply promo code", type: "error" });
    } finally {
      setIsApplyingPromo(false);
    }
  };

  // Reward Points Modal State & Handler
  const [showRewardModal, setShowRewardModal] = useState<boolean>(false);
  const [rewardSearchText, setRewardSearchText] = useState<string>("");
  const [rewardSearchResults, setRewardSearchResults] = useState<any[]>([]);
  const [isSearchingRewards, setIsSearchingRewards] = useState<boolean>(false);
  const [rewardMember, setRewardMember] = useState<any | null>(null);

  const handleRewardSearch = async (text: string) => {
    setRewardSearchText(text);
    if (!text || text.trim().length < 2) {
      setRewardSearchResults([]);
      return;
    }
    setIsSearchingRewards(true);
    try {
      const res = await fetch(`${API_URL}/api/members/search?q=${encodeURIComponent(text.trim())}`).then((r) => r.json());
      if (Array.isArray(res)) {
        setRewardSearchResults(res);
      }
    } catch {
      setRewardSearchResults([]);
    } finally {
      setIsSearchingRewards(false);
    }
  };

  // Loyalty Modal State & Handler
  const [showLoyaltyModal, setShowLoyaltyModal] = useState<boolean>(false);
  const [loyaltySearchText, setLoyaltySearchText] = useState<string>("");
  const [loyaltySearchResults, setLoyaltySearchResults] = useState<any[]>([]);
  const [isSearchingLoyalty, setIsSearchingLoyalty] = useState<boolean>(false);
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<any | null>(null);

  const handleLoyaltySearch = async (text: string) => {
    setLoyaltySearchText(text);
    if (!text || text.trim().length < 2) {
      setLoyaltySearchResults([]);
      return;
    }
    setIsSearchingLoyalty(true);
    try {
      const res = await fetch(`${API_URL}/api/members/search?q=${encodeURIComponent(text.trim())}`).then((r) => r.json());
      if (Array.isArray(res)) {
        setLoyaltySearchResults(res);
      }
    } catch {
      setLoyaltySearchResults([]);
    } finally {
      setIsSearchingLoyalty(false);
    }
  };

  // Load Active Paymodes from Paymode Table
  useEffect(() => {
    fetch(`${API_URL}/api/sales/payment-methods`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const activeOnly = data.filter((pm: any) => pm.active === true || pm.active === 1 || String(pm.active) === "true" || String(pm.active) === "1");
          if (activeOnly.length > 0) {
            setActivePaymodes(activeOnly);
            const firstMode = activeOnly[0].payMode || activeOnly[0].description || "CASH";
            setSelectedPaymentMethod(String(firstMode).toUpperCase());
          }
        }
      })
      .catch((err) => console.log("Error fetching active paymodes:", err));
  }, []);

  const getPaymodeIconAndColor = (paymodeName: string) => {
    const name = (paymodeName || "").toUpperCase();
    if (name.includes("YEAHPAY") && (name.includes("PAYNOW") || name.includes("QR"))) {
      return { icon: "qr-code-outline", color: "#059669", bg: "#ECFDF5" };
    }
    if (name.includes("YEAHPAY")) {
      return { icon: "card-outline", color: "#059669", bg: "#ECFDF5" };
    }
    if (name.includes("CASH") || name.includes("CAS")) {
      return { icon: "cash-outline", color: "#10B981", bg: "#ECFDF5" };
    }
    if (name.includes("CARD") || name.includes("VISA") || name.includes("MASTER") || name.includes("AMEX")) {
      return { icon: "card-outline", color: "#FF5A16", bg: "#FFF7ED" };
    }
    if (name.includes("UPI") || name.includes("QR") || name.includes("PAYNOW") || name.includes("GPAY") || name.includes("PAYTM") || name.includes("PHONEPE")) {
      return { icon: "qr-code-outline", color: "#9333EA", bg: "#F3E8FF" };
    }
    if (name.includes("SPLIT")) {
      return { icon: "people-outline", color: "#2563EB", bg: "#EFF6FF" };
    }
    if (name.includes("NETS")) {
      return { icon: "card", color: "#0284C7", bg: "#E0F2FE" };
    }
    if (name.includes("MEMBER") || name.includes("REWARD")) {
      return { icon: "ribbon-outline", color: "#D97706", bg: "#FEF3C7" };
    }
    if (name.includes("CREDIT")) {
      return { icon: "wallet-outline", color: "#4F46E5", bg: "#EEF2FF" };
    }
    if (name.includes("FOC")) {
      return { icon: "gift-outline", color: "#E11D48", bg: "#FFE4E6" };
    }
    return { icon: "wallet-outline", color: "#475569", bg: "#F1F5F9" };
  };

  const searchMemberAccounts = async (q: string, type: "MEMBER" | "CREDIT") => {
    setSearchingMembers(true);
    const isCredit = type === "CREDIT";
    const endpoint = isCredit
      ? `${API_URL}/api/credit-customers/search?query=${encodeURIComponent(q || "")}`
      : `${API_URL}/api/members/search?query=${encodeURIComponent(q || "")}`;
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      const list = Array.isArray(data) ? data : (Array.isArray(data?.value) ? data.value : []);
      setMembersList(list);
    } catch (err) {
      console.error("Search members error:", err);
      setMembersList([]);
    } finally {
      setSearchingMembers(false);
    }
  };

  useEffect(() => {
    if (showMemberModal) {
      const timer = setTimeout(() => {
        searchMemberAccounts(memberQuery, memberModalType);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [memberQuery, showMemberModal, memberModalType]);

  const handleQuickAddCustomer = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      toast.showToast({ message: "Name and Phone are required", type: "warning" });
      return;
    }
    setAddingCustomer(true);
    const isCredit = memberModalType === "CREDIT";
    const endpoint = isCredit
      ? `${API_URL}/api/credit-customers/add`
      : `${API_URL}/api/members/add`;
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: newName.trim(),
          phone: newPhone.trim(),
          email: newEmail.trim() || null,
          address: newAddress.trim() || null,
          creditLimit: parseFloat(newCreditLimit) || 1000,
          currentBalance: 0,
          balance: 0,
          isActive: newIsActive ? 1 : 0,
          userId: user?.userId,
        }),
      });
      const data = await res.json();
      if (data.success && data.member) {
        setSelectedMember(data.member);
        setShowMemberModal(false);
        setIsQuickAddMode(false);
        setNewName("");
        setNewPhone("");
      } else {
        toast.showToast({
          message: data.error || "Could not add customer",
          type: "error",
        });
      }
    } catch (err) {
      toast.showToast({ message: "Could not connect to server", type: "error" });
    } finally {
      setAddingCustomer(false);
    }
  };

  const handleSelectPaymode = (modeKey: string) => {
    setSelectedPaymentMethod(modeKey);
    const upper = modeKey.toUpperCase().trim();
    if (upper === "CASH") {
      if (cartItems.length > 0) {
        openCashReceivedModal();
      }
    } else if (upper === "PAYNOW") {
      if (cartItems.length > 0) {
        setShowPayNowModal(true);
      }
    } else if (upper === "MEMBER") {
      setMemberModalType("MEMBER");
      if (!selectedMember) {
        setShowMemberModal(true);
      }
    } else if (upper === "CREDIT") {
      setMemberModalType("CREDIT");
      if (!selectedMember) {
        setShowMemberModal(true);
      }
    }
  };

  // Load Menu Data synced with useMenuStore
  useEffect(() => {
    initMenuData();
  }, []);

  const initMenuData = async () => {
    setLoading(true);
    try {
      await useMenuStore.getState().fetchMenu();
      const store = useMenuStore.getState();
      const currentKitchens = store.kitchens || [];
      setCategories(currentKitchens);
      setDishes(store.allDishes || []);

      // Aggregate all Dish Groups across all Kitchens in EXACT Menu Screen sequence
      const allMenuGroups: any[] = [];
      const seenGroupIds = new Set<string>();

      for (const k of currentKitchens) {
        const kIdStr = String(k.CategoryId || k.id);
        let kGroups = store.dishGroups[kIdStr];
        if (!kGroups || kGroups.length === 0) {
          kGroups = await store.fetchGroups(kIdStr);
        }
        if (Array.isArray(kGroups)) {
          for (const g of kGroups) {
            const gId = String(g.DishGroupId || g.id || "");
            if (gId && !seenGroupIds.has(gId)) {
              seenGroupIds.add(gId);
              allMenuGroups.push(g);
            }
          }
        }
      }

      setGroups(allMenuGroups);
      setDishGroups(allMenuGroups);
      setAllDishGroups(allMenuGroups);

      if (allMenuGroups.length > 0) {
        const firstGId = String(allMenuGroups[0].DishGroupId || allMenuGroups[0].id);
        setSelectedDishGroupId(firstGId);
        setSelectedGroupId(Number(firstGId) || null);
        await selectDishGroup(firstGId);
      }
    } catch (err) {
      console.error("Error fetching menu data:", err);
      toast.showToast({ message: "Failed to load menu", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  const selectKitchen = async (kitchenId: string | number) => {
    const kIdStr = String(kitchenId);
    setSelectedKitchenId(kIdStr);
    setSelectedCategoryId(Number(kIdStr) || null);
    setGroupPage(1);
    setDishPage(1);

    const store = useMenuStore.getState();
    let groupsData = store.dishGroups[kIdStr];
    if (!groupsData || groupsData.length === 0) {
      groupsData = await store.fetchGroups(kIdStr);
    }

    const currentGroups = Array.isArray(groupsData) ? groupsData : [];
    setGroups(currentGroups);
    setDishGroups(currentGroups);

    // Keep allDishGroups updated for legacy references
    const allGroupsMap = new Map();
    currentGroups.forEach((g: any) => allGroupsMap.set(g.DishGroupId, g));
    setAllDishGroups(currentGroups);

    if (currentGroups.length > 0) {
      const firstGId = String(currentGroups[0].DishGroupId);
      setSelectedDishGroupId(firstGId);
      setSelectedGroupId(Number(firstGId) || null);
      await selectDishGroup(firstGId);
    } else {
      setSelectedDishGroupId(null);
      setSelectedGroupId(null);
    }
  };

  const selectDishGroup = async (groupId: string | number) => {
    const gIdStr = String(groupId);
    setSelectedDishGroupId(gIdStr);
    setSelectedGroupId(Number(gIdStr) || null);
    setDishPage(1);

    const store = useMenuStore.getState();
    const cachedDishes = store.dishesByGroup[gIdStr];
    if (!cachedDishes || cachedDishes.length === 0) {
      await store.fetchDishes(gIdStr);
    }
  };

  const fetchMenuData = async () => {
    await initMenuData();
  };

  const handleSelectCategory = async (catId: number | null) => {
    if (catId !== null) {
      await selectKitchen(catId);
    }
  };

  const getDishGroupCount = useCallback(
    (group: any) => {
      const gIdStr = String(group?.DishGroupId || group?.GroupId || "");
      if (!gIdStr) return 0;
      const cached = useMenuStore.getState().dishesByGroup[gIdStr];
      if (Array.isArray(cached)) return cached.length;
      const allD = useMenuStore.getState().allDishes || dishes;
      return allD.filter((d: any) => {
        const dGroupId = String(d.DishGroupId || "");
        const dMapped = (d.MappedGroupIds || "").toLowerCase();
        return dGroupId === gIdStr || dMapped.includes(gIdStr.toLowerCase());
      }).length;
    },
    [dishes]
  );

  const toggleLeftPanelView = () => {
    setLeftPanelView((prev) => {
      const next = prev === "category" ? "dishgroup" : "category";
      if (next === "dishgroup" && selectedDishGroupId === null && allDishGroups.length > 0) {
        const firstWithDishes = allDishGroups.find((g) => getDishGroupCount(g) > 0) || allDishGroups[0];
        if (firstWithDishes) {
          setSelectedDishGroupId(firstWithDishes.DishGroupId);
        }
      }
      return next;
    });
  };

  const handleSelectDishGroupView = () => {
    setLeftPanelView("dishgroup");
    if (selectedDishGroupId === null && allDishGroups.length > 0) {
      const firstWithDishes = allDishGroups.find((g) => getDishGroupCount(g) > 0) || allDishGroups[0];
      if (firstWithDishes) {
        setSelectedDishGroupId(firstWithDishes.DishGroupId);
      }
    }
  };

  const isDishGroupAtTop = dishGroupScrollOffset <= 2;
  const isDishGroupAtBottom =
    dishGroupContentHeight > dishGroupContainerHeight &&
    dishGroupScrollOffset >= dishGroupContentHeight - dishGroupContainerHeight - 5;

  const scrollDishGroupsVertically = (direction: "up" | "down") => {
    if (!dishGroupScrollRef.current) return;
    const scrollStep = 160;
    const maxScroll = Math.max(0, dishGroupContentHeight - dishGroupContainerHeight);
    let nextOffset = dishGroupScrollOffset;

    if (direction === "up") {
      nextOffset = Math.max(0, dishGroupScrollOffset - scrollStep);
    } else {
      nextOffset = maxScroll > 0 ? Math.min(maxScroll, dishGroupScrollOffset + scrollStep) : dishGroupScrollOffset + scrollStep;
    }

    if (dishGroupScrollRef.current.scrollTo) {
      dishGroupScrollRef.current.scrollTo({
        y: nextOffset,
        animated: true,
      });
    }
    setDishGroupScrollOffset(nextOffset);
  };

  // Deduplicated Favorite Dishes (isFavourite = 1, unique by DishId)
  const favoriteDishes = useMemo(() => {
    const seenIds = new Set<string>();
    const list: any[] = [];

    dishes.forEach((d: any) => {
      const isFav =
        Boolean(d.isFavourite || d.IsFavourite || d.isFavorite || d.IsFavorite) ||
        d.isFavourite === true ||
        d.isFavourite === "1" ||
        d.IsFavourite === 1 ||
        d.IsFavourite === true ||
        d.IsFavourite === "1";

      if (isFav) {
        const idKey = String(d.DishId || "").toLowerCase().trim();
        if (idKey && !seenIds.has(idKey)) {
          seenIds.add(idKey);
          list.push(d);
        }
      }
    });

    let result = list;

    if (vegFilter === "veg") {
      result = result.filter((d) => d.IsVeg);
    } else if (vegFilter === "non-veg") {
      result = result.filter((d) => !d.IsVeg);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((d) => {
        const name = (d.Name || "").toLowerCase();
        const code = (d.DishCode || "").toLowerCase();
        return name.includes(q) || code.includes(q);
      });
    }

    return result;
  }, [dishes, searchQuery, vegFilter]);

  const filteredDishes = useMemo(() => {
    if (leftPanelView === "favorites") {
      return favoriteDishes;
    }

    if (searchQuery.trim() !== "") {
      const query = searchQuery.toLowerCase().trim();
      return dishes.filter((dish) => {
        if (vegFilter === "veg" && !dish.IsVeg) return false;
        if (vegFilter === "non-veg" && dish.IsVeg) return false;
        const matchesName = dish.Name?.toLowerCase().includes(query);
        const matchesCode = dish.DishCode?.toLowerCase().includes(query);
        return matchesName || matchesCode;
      });
    }

    const selGroupIdStr = selectedDishGroupId ? String(selectedDishGroupId).toLowerCase() : "";
    if (!selGroupIdStr) {
      return [];
    }

    // Try reading directly from useMenuStore cache for maximum consistency with Menu Screen
    const cached = useMenuStore.getState().dishesByGroup[String(selectedDishGroupId)];
    let sourceList = Array.isArray(cached) && cached.length > 0 ? cached : dishes;

    return sourceList.filter((dish) => {
      if (vegFilter === "veg" && !dish.IsVeg) return false;
      if (vegFilter === "non-veg" && dish.IsVeg) return false;

      const dishGroupIdStr = String(dish.DishGroupId || "").toLowerCase();
      const mappedGroupIds = (dish.MappedGroupIds || "").toLowerCase();
      return (
        dishGroupIdStr === selGroupIdStr ||
        mappedGroupIds.includes(selGroupIdStr)
      );
    });
  }, [dishes, leftPanelView, selectedDishGroupId, searchQuery, vegFilter, favoriteDishes]);

  const sortedDishes = useMemo(() => {
    const list = [...filteredDishes];
    if (sortBy === "NAME_ASC") {
      list.sort((a, b) => (a.Name || "").localeCompare(b.Name || ""));
    } else if (sortBy === "PRICE_LOW") {
      list.sort((a, b) => Number(a.Price || 0) - Number(b.Price || 0));
    } else if (sortBy === "PRICE_HIGH") {
      list.sort((a, b) => Number(b.Price || 0) - Number(a.Price || 0));
    }
    return list;
  }, [filteredDishes, sortBy]);

  // Derived Pagination Calculations
  const totalDishPages = Math.max(1, Math.ceil(sortedDishes.length / DISHES_PER_PAGE));
  const safeDishPage = Math.min(Math.max(1, dishPage), totalDishPages);

  // In Previous/Next mode, slice to 16 items per page. In Scroll mode, show all filtered items.
  const displayedDishes = useMemo(() => {
    if (menuNavigationMode === "prev_next") {
      const startIdx = (safeDishPage - 1) * DISHES_PER_PAGE;
      return sortedDishes.slice(startIdx, startIdx + DISHES_PER_PAGE);
    }
    return sortedDishes;
  }, [menuNavigationMode, sortedDishes, safeDishPage]);

  const handlePageChange = (newPage: number) => {
    setDishPage(newPage);
    scrollDishesToTop();
  };

  // Dish Group Pagination Calculations (2 cols x 7 rows = 14 groups per page)
  const currentKitchenGroups = allDishGroups.length > 0 ? allDishGroups : (dishGroups.length > 0 ? dishGroups : groups);
  const totalGroupPages = Math.max(1, Math.ceil(currentKitchenGroups.length / GROUPS_PER_PAGE));
  const safeGroupPage = Math.min(Math.max(1, groupPage), totalGroupPages);

  // In Previous/Next mode, slice groups to GROUPS_PER_PAGE. In Scroll mode, show all groups.
  const displayedDishGroups = useMemo(() => {
    if (menuNavigationMode === "prev_next") {
      const startIdx = (safeGroupPage - 1) * GROUPS_PER_PAGE;
      return currentKitchenGroups.slice(startIdx, startIdx + GROUPS_PER_PAGE);
    }
    return currentKitchenGroups;
  }, [menuNavigationMode, currentKitchenGroups, safeGroupPage]);

  // Company Settings & Dynamic Tax Calculations
  const companySettings = useCompanySettingsStore((state: any) => state.settings);
  const currencySymbol = companySettings?.currencySymbol || "$";

  const gap = isPhoneDevice ? (isLandscape ? 8 : 6) : 6;
  const paddingH = isPhoneDevice ? 6 : 8;

  const columns = useMemo(() => {
    if (isMobile) return isLandscape ? 3 : 2;
    return 4;
  }, [isMobile, isLandscape]);

  const cardWidth = useMemo(() => {
    if (dishesPanelWidth <= 0) return 155;
    const available = dishesPanelWidth - paddingH * 2;
    return Math.floor((available - gap * (columns - 1)) / columns);
  }, [dishesPanelWidth, columns, gap, paddingH]);

  const fetchCompanySettings = useCompanySettingsStore((state: any) => state.fetchSettings);
  const currentOrderContext = useOrderContextStore((state: any) => state.currentOrder);
  const isTakeawayOrder = currentOrderContext?.orderType === "TAKEAWAY";

  useEffect(() => {
    if (fetchCompanySettings && user?.userId) {
      fetchCompanySettings(String(user.userId));
    }
  }, [user?.userId, fetchCompanySettings]);

  // Rates from CompanySettings
  const applicableScPercentage = useMemo(() => {
    if (isTakeawayOrder) {
      return Number(companySettings?.twServiceChargePercentage ?? (companySettings as any)?.TWServiceChargePercentage ?? 0);
    }
    return Number(companySettings?.serviceChargePercentage ?? (companySettings as any)?.ServiceChargePercentage ?? 0);
  }, [isTakeawayOrder, companySettings]);

  const applicableGstPercentage = useMemo(() => {
    return Number(companySettings?.gstPercentage ?? (companySettings as any)?.GSTPercentage ?? 0);
  }, [companySettings]);

  const takeawayChargeRate = useMemo(() => {
    return Number(companySettings?.takeawayCharges ?? (companySettings as any)?.TakeawayCharges ?? 0);
  }, [companySettings]);

  // Cart Calculations
  const subtotal = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      const price = Number(item.price || 0);
      const qty = Number(item.qty || 1);
      return sum + price * qty;
    }, 0);
  }, [cartItems]);

  const cartQtyMap = useMemo(() => {
    const map: Record<string, number> = {};
    cartItems.forEach((item) => {
      if (item.id) {
        map[String(item.id)] = (map[String(item.id)] || 0) + (item.qty || 1);
      }
    });
    return map;
  }, [cartItems]);

  const appliedOrderDiscount = useCartStore((s) => {
    const ctx = s.currentContextId;
    return ctx ? s.discounts[ctx] : undefined;
  });

  const discountAmount = useMemo(() => {
    let sum = 0;
    cartItems.forEach((item: any) => {
      const dAmt = Number(item.discountAmount || item.discount || 0);
      const dType = item.discountType || "percentage";
      const itemPrice = Number(item.price || 0);
      const itemQty = Number(item.qty || 1);
      if (dAmt > 0) {
        if (dType === "percentage") {
          sum += (itemPrice * itemQty * dAmt) / 100;
        } else {
          sum += dAmt * itemQty;
        }
      }
    });

    if (appliedOrderDiscount?.applied && appliedOrderDiscount.value > 0) {
      if (appliedOrderDiscount.type === "percentage") {
        sum += (subtotal * appliedOrderDiscount.value) / 100;
      } else {
        sum += appliedOrderDiscount.value;
      }
    }

    if (!appliedOrderDiscount?.applied && discountPercent > 0) {
      sum += (subtotal * discountPercent) / 100;
    }

    return Math.min(subtotal, Math.max(0, sum));
  }, [subtotal, cartItems, appliedOrderDiscount, discountPercent]);

  // Calculate Subtotal of items eligible for Service Charge (where isServiceCharge !== false)
  const scEligibleSubtotal = useMemo(() => {
    return cartItems.reduce((sum, item: any) => {
      const isSC = item.isServiceCharge ?? item.IsServiceCharge ?? item.SVC;
      const isSCActive = isSC === true || Number(isSC) === 1 || String(isSC) === "true" || String(isSC) === "1" || isSC === undefined || isSC === null;
      if (isSCActive) {
        const price = Number(item.price || 0);
        const qty = Number(item.qty || 1);
        return sum + price * qty;
      }
      return sum;
    }, 0);
  }, [cartItems]);

  // Service Charge Amount (using applicable SC rate & proportional discount)
  const serviceChargeAmount = useMemo(() => {
    if (applicableScPercentage <= 0 || scEligibleSubtotal <= 0) return 0;
    const discountRatio = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
    const netEligibleSubtotal = scEligibleSubtotal * discountRatio;
    return netEligibleSubtotal > 0 ? netEligibleSubtotal * (applicableScPercentage / 100) : 0;
  }, [scEligibleSubtotal, subtotal, discountAmount, applicableScPercentage]);

  // Total Takeaway Charges Amount (if Takeaway Order)
  const totalTakeawayChargesAmount = useMemo(() => {
    if (!isTakeawayOrder) return 0;
    return cartItems.reduce((sum, item: any) => {
      const dishSpecificTW = Number(item.takeawayCharge ?? item.TakeawayCharge ?? 0);
      const effectiveTWRate = dishSpecificTW > 0 ? dishSpecificTW : (takeawayChargeRate || 0);
      return sum + Number(item.qty || 1) * effectiveTWRate;
    }, 0);
  }, [isTakeawayOrder, takeawayChargeRate, cartItems]);

  // GST Amount (Exclusive / Inclusive tax mode)
  const gstAmount = useMemo(() => {
    if (applicableGstPercentage <= 0) return 0;
    const netAfterDiscount = subtotal - discountAmount;
    if (netAfterDiscount <= 0 && serviceChargeAmount <= 0 && totalTakeawayChargesAmount <= 0) return 0;

    const taxableBase = netAfterDiscount + serviceChargeAmount + totalTakeawayChargesAmount;
    const taxMode = companySettings?.taxMode || "exclusive";

    if (taxMode === "inclusive") {
      return taxableBase - (taxableBase / (1 + applicableGstPercentage / 100));
    } else {
      return taxableBase * (applicableGstPercentage / 100);
    }
  }, [subtotal, discountAmount, serviceChargeAmount, totalTakeawayChargesAmount, applicableGstPercentage, companySettings]);

  // Final Total
  const finalTotal = useMemo(() => {
    const taxMode = companySettings?.taxMode || "exclusive";
    let tot = subtotal - discountAmount + serviceChargeAmount + totalTakeawayChargesAmount;
    if (taxMode === "exclusive") {
      tot += gstAmount;
    }
    return Math.max(0, tot);
  }, [subtotal, discountAmount, serviceChargeAmount, totalTakeawayChargesAmount, gstAmount, companySettings]);

  const openCashReceivedModal = useCallback(() => {
    setCashReceivedInput(finalTotal.toFixed(2));
    setShowCashModal(true);
    setTimeout(() => {
      if (cashInputRef.current) cashInputRef.current.focus();
    }, 150);
  }, [finalTotal]);

  // ═════════════════════════════════════════════════════════════════════════
  // 🖥️ QUICK SERVE CUSTOMER DISPLAY LIVE SCREEN MIRROR SYNC (VIA PRINT BRIDGE)
  // Mirrors active cart, dish groups, dishes & selected paymode on customer screen
  // ═════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const rawTableName = selectedTable
      ? String(selectedTable.label || selectedTable.TableNumber || selectedTable.name || "01")
      : "01";
    const formattedTableName = rawTableName.toLowerCase().startsWith("table")
      ? rawTableName
      : `Table ${rawTableName}`;

    const orderCtx = {
      orderType: (isTakeawayOrder ? "TAKEAWAY" : "DINE_IN") as "DINE_IN" | "TAKEAWAY",
      tableNo: isTakeawayOrder ? "Takeaway" : formattedTableName,
      tableId: selectedTable ? String(selectedTable.id || selectedTable.TableId || "") : "01",
      section: isTakeawayOrder ? "TAKEAWAY" : (selectedSection || "Section 1"),
      serverName: user?.userName || user?.userId || "Quick Serve",
    };

    // Prepare Dish Groups snapshot for middle panel mirroring
    const mirrorGroups = (allDishGroups.length > 0 ? allDishGroups : categories).slice(0, 10).map((g: any) => {
      const gId = g.DishGroupId || g.CategoryId || g.id;
      const gName = g.DishGroupName || g.KitchenTypeName || g.CategoryName || g.name || "Group";
      const isAct = leftPanelView === "dishgroup"
        ? String(selectedDishGroupId) === String(gId)
        : String(selectedCategoryId) === String(gId);
      return {
        id: gId,
        name: gName,
        count: getDishGroupCount ? getDishGroupCount(g) : undefined,
        isActive: isAct,
      };
    });

    // Prepare Dishes snapshot for right panel mirroring (up to 12 visible dishes)
    const mirrorDishes = (displayedDishes && displayedDishes.length > 0 ? displayedDishes : sortedDishes).slice(0, 12).map((d: any, idx: number) => {
      const rawImg = d.Image || d.ImagePath || d.image;
      const imgUri = getImageUrl(rawImg) || DEFAULT_DISH_IMAGES[idx % DEFAULT_DISH_IMAGES.length];
      return {
        id: d.DishId || idx,
        name: d.Name || "Dish",
        price: Number(d.Price || d.currentcost || 0),
        image: imgUri,
        qtyInCart: cartQtyMap[String(d.DishId)] || 0,
        isSoldOut: Boolean(d.IsSoldOut),
      };
    });

    // Prepare Paymodes list for payment footer mirroring
    const mirrorPaymodes = (activePaymodes.length > 0 ? activePaymodes : [
      { key: "CASH", label: "Cash" },
      { key: "CARD", label: "Card" },
      { key: "NETS", label: "NETS" },
      { key: "PAYNOW", label: "PayNow" },
      { key: "UPI", label: "UPI" },
    ]).map((pm: any) => {
      const modeKey = String(pm.payMode || pm.description || pm.key || "").toUpperCase();
      const modeLabel = pm.description || pm.payMode || pm.label || modeKey;
      return {
        key: modeKey,
        label: modeLabel,
        isSelected: selectedPaymentMethod.toUpperCase().trim() === modeKey,
      };
    });

    const activeCatTitle = leftPanelView === "favorites"
      ? "Favorite Dishes"
      : leftPanelView === "category"
      ? (selectedCategoryId !== null
          ? `${categories.find((c) => String(c.CategoryId) === String(selectedCategoryId))?.KitchenTypeName || "Category"} Dishes`
          : "All Category Dishes")
      : (selectedDishGroupId !== null
          ? `${allDishGroups.find((g) => String(g.DishGroupId) === String(selectedDishGroupId))?.DishGroupName || "Dish Group"} Dishes`
          : "All Menu Dishes");

    CustomerDisplaySync.syncCart({
      orderContext: orderCtx,
      cart: cartItems,
      discountInfo: appliedOrderDiscount?.applied
        ? {
            applied: true,
            type: appliedOrderDiscount.type || "percentage",
            value: appliedOrderDiscount.value || 0,
            label: appliedOrderDiscount.label,
          }
        : discountPercent > 0
        ? {
            applied: true,
            type: "percentage",
            value: discountPercent,
            label: `${discountPercent}%`,
          }
        : null,
      gstPercentage: applicableGstPercentage,
      roundOff: 0,
      active: true,
      orderId: quickServeToken,
      paymentMethod: selectedPaymentMethod,
      memberName: selectedMember?.Name || "",
      isSplit: false,
      splitPayments: [],
      takeawayCharge: totalTakeawayChargesAmount,
      // Quick Serve Mirror Attributes
      isQuickServe: true,
      quickServeGroups: mirrorGroups,
      quickServeDishes: mirrorDishes,
      quickServeCategoryTitle: activeCatTitle,
      quickServePaymodes: mirrorPaymodes,
    });
  }, [
    cartItems,
    selectedPaymentMethod,
    finalTotal,
    subtotal,
    discountAmount,
    gstAmount,
    serviceChargeAmount,
    totalTakeawayChargesAmount,
    selectedTable,
    isTakeawayOrder,
    quickServeToken,
    selectedMember,
    selectedDishGroupId,
    selectedCategoryId,
    leftPanelView,
    displayedDishes,
    allDishGroups,
    activePaymodes,
    cartQtyMap,
  ]);

  // When exiting or unmounting Quick Serve screen, transition Customer Display back to Idle
  useEffect(() => {
    return () => {
      CustomerDisplaySync.syncIdle();
    };
  }, []);

  // Modifiers helper
  const groupedModifiers = useMemo(() => {
    if (!modifiers || modifiers.length === 0) return [];
    const groupsMap: Record<string, any> = {};

    modifiers.forEach((m: any) => {
      const gId = m.ModifierGroupId || "general";
      const gName = m.ModifierGroupName || "General Modifiers";
      const minSel = Number(m.MinSelect ?? m.MinSelection ?? m.MinSelectionCount ?? 0);
      const maxSel = Number(m.MaxSelect ?? m.MaxSelection ?? m.MaxSelectionCount ?? 0);
      const multiselect = Boolean(
        m.IsMultiSelect ?? m.MultiSelect ?? (m.MultiselectAllow !== undefined ? Number(m.MultiselectAllow) === 1 : true)
      );

      if (!groupsMap[gId]) {
        groupsMap[gId] = {
          groupId: String(gId),
          groupName: gName,
          minSelect: minSel,
          maxSelect: maxSel,
          multiselect: multiselect,
          items: [],
        };
      }

      if (!groupsMap[gId].items.some((x: any) => String(x.ModifierID) === String(m.ModifierID))) {
        groupsMap[gId].items.push(m);
      }
    });

    return Object.values(groupsMap);
  }, [modifiers]);

  const handleConfirmCustomMod = () => {
    if (!activeOpenMod) return;
    const name = customModName.trim();
    if (!name) {
      toast.showToast({ message: "Please enter item name", type: "warning" });
      return;
    }
    const parsedPrice = parseFloat(customModPrice) || 0;
    if (parsedPrice < 0) {
      toast.showToast({ message: "Price cannot be negative", type: "error" });
      return;
    }

    const gId = String(activeOpenMod.ModifierGroupId || "general");
    const modId = String(activeOpenMod.ModifierID);
    const key = `${modId}_${gId}`;
    const group = groupedModifiers.find((g: any) => g.groupId === gId);
    const multiselect = group ? group.multiselect : true;

    // Update modifiers state so the card displays the customized name & price
    setModifiers((prev) =>
      prev.map((x) =>
        String(x.ModifierID) === modId ? { ...x, ModifierName: name, Price: parsedPrice } : x
      )
    );

    // Keep track in customMods as well
    setCustomMods((prev) => {
      const filtered = prev.filter((x) => String(x.ModifierID) !== modId);
      return [
        ...filtered,
        {
          ...activeOpenMod,
          ModifierName: name,
          Price: parsedPrice,
        },
      ];
    });

    // Mark as selected in selectedModifierQuantities
    setSelectedModifierQuantities((prev) => {
      const next = { ...prev };
      if (!multiselect) {
        Object.keys(next).forEach((k) => {
          if (k.endsWith(`_${gId}`)) delete next[k];
        });
      }
      next[key] = 1;
      return next;
    });

    setShowCustomModModal(false);
    setActiveOpenMod(null);
    setCustomModName("");
    setCustomModPrice("");
  };

  const handleCancelCustomMod = () => {
    setShowCustomModModal(false);
    setActiveOpenMod(null);
    setCustomModName("");
    setCustomModPrice("");
  };

  const adjustModifierQuantity = (mod: any, gId: string, delta: number) => {
    const key = `${mod.ModifierID}_${gId}`;
    const group = groupedModifiers.find((g: any) => g.groupId === gId);
    if (!group) return;

    const groupSelectedCount = Object.entries(selectedModifierQuantities)
      .filter(([k]) => k.endsWith(`_${gId}`))
      .reduce((sum, [, q]) => sum + q, 0);

    setSelectedModifierQuantities((prev) => {
      const currentQty = prev[key] || 0;
      const newQty = Math.max(0, currentQty + delta);
      if (delta > 0 && group.maxSelect > 0 && groupSelectedCount >= group.maxSelect) {
        return prev;
      }
      return { ...prev, [key]: newQty };
    });
  };

  const toggleModifier = (mod: any) => {
    const gId = mod.ModifierGroupId || "general";
    const key = `${mod.ModifierID}_${gId}`;
    const isSelected = !!selectedModifierQuantities[key];
    if (isSelected) {
      adjustModifierQuantity(mod, gId, -1);
    } else {
      const group = groupedModifiers.find((g: any) => g.groupId === String(gId));
      if (group && !group.multiselect) {
        setSelectedModifierQuantities((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((k) => {
            if (k.endsWith(`_${gId}`)) delete next[k];
          });
          next[key] = 1;
          return next;
        });
      } else {
        adjustModifierQuantity(mod, gId, 1);
      }
    }
  };

  const addSimpleToCart = (dish: any, overridePrice?: number) => {
    const itemPrice = overridePrice !== undefined ? overridePrice : Number(dish.Price || dish.currentcost || 0);
    const currentKitchen = categories.find((k) => k.CategoryId === selectedCategoryId);
    const kitchenName = dish.KitchenTypeName || currentKitchen?.KitchenTypeName || "KITCHEN";
    const kitchenCode = dish.KitchenTypeCode || currentKitchen?.KitchenTypeCode || "2";

    const cartItem: Omit<CartItem, "qty" | "lineItemId"> & { Image?: string; IsVeg?: boolean } = {
      id: String(dish.DishId),
      name: dish.Name,
      price: itemPrice,
      basePrice: itemPrice,
      isServiceCharge: dish.isServiceCharge !== undefined ? Boolean(dish.isServiceCharge) : dish.IsServiceCharge !== undefined ? Boolean(dish.IsServiceCharge) : dish.SVC !== undefined ? Boolean(dish.SVC) : true,
      isCombo: Boolean(dish.IsCombo),
      takeawayCharge: Number(dish.TakeawayCharge || 0),
      KitchenTypeCode: kitchenCode,
      KitchenTypeName: kitchenName,
      PrinterIP: dish.PrinterIP || "",
      Image: dish.Image || dish.ImagePath || dish.image,
      IsVeg: dish.IsVeg,
    };

    addToCartGlobal(cartItem as any);
    if (searchQuery) setSearchQuery("");
  };

  const addWithModifiers = () => {
    if (!selectedDish) return;

    for (const group of groupedModifiers) {
      if (group.minSelect > 0) {
        const groupSelectedCount = Object.entries(selectedModifierQuantities)
          .filter(([k]) => k.endsWith(`_${group.groupId}`))
          .reduce((sum, [, q]) => sum + q, 0);

        if (groupSelectedCount < group.minSelect) {
          toast.showToast({
            message: `Please select at least ${group.minSelect} option(s) for ${group.groupName}`,
            type: "warning",
          });
          return;
        }
      }
    }

    const chosenModifiers: any[] = [];
    const allAvailable = [...customMods, ...modifiers];
    Object.entries(selectedModifierQuantities).forEach(([key, qty]) => {
      if (qty <= 0) return;
      const [modId] = key.split("_");
      const m = allAvailable.find((x) => String(x.ModifierID) === String(modId));
      if (m) {
        chosenModifiers.push({
          ModifierId: String(m.ModifierID || m.ModifierId || ""),
          ModifierName: m.ModifierName,
          Price: Number(m.Price || 0),
          qty: qty,
        });
      }
    });

    const modifierPriceTotal = chosenModifiers.reduce(
      (sum, m) => sum + Number(m.Price || 0) * (m.qty || 1),
      0
    );

    const basePrice = Number(selectedDish.Price || selectedDish.currentcost || 0);
    const finalPrice = basePrice + modifierPriceTotal;

    const currentKitchen = categories.find((k) => k.CategoryId === selectedCategoryId);
    const kitchenName = selectedDish.KitchenTypeName || currentKitchen?.KitchenTypeName || "KITCHEN";
    const kitchenCode = selectedDish.KitchenTypeCode || currentKitchen?.KitchenTypeCode || "2";

    const cartItem: Omit<CartItem, "qty" | "lineItemId"> & { Image?: string; IsVeg?: boolean } = {
      id: String(selectedDish.DishId),
      name: selectedDish.Name,
      price: finalPrice,
      basePrice: basePrice,
      modifiers: chosenModifiers,
      isServiceCharge: selectedDish.isServiceCharge !== undefined ? Boolean(selectedDish.isServiceCharge) : selectedDish.IsServiceCharge !== undefined ? Boolean(selectedDish.IsServiceCharge) : selectedDish.SVC !== undefined ? Boolean(selectedDish.SVC) : true,
      isCombo: false,
      takeawayCharge: Number(selectedDish.TakeawayCharge || 0),
      KitchenTypeCode: kitchenCode,
      KitchenTypeName: kitchenName,
      PrinterIP: selectedDish.PrinterIP || "",
      Image: selectedDish.Image || selectedDish.ImagePath || selectedDish.image,
      IsVeg: selectedDish.IsVeg,
    };

    addToCartGlobal(cartItem as any);
    setShowModifier(false);
    setSelectedDish(null);
    setCustomMods([]);
    setSelectedModifierQuantities({});
    setShowCustomModModal(false);
    setActiveOpenMod(null);
    if (searchQuery) setSearchQuery("");
  };

  const confirmOpenItemPrice = () => {
    if (!openItemDish) return;
    const numPrice = parseFloat(openItemPrice);
    if (isNaN(numPrice) || numPrice < 0) {
      setOpenItemError("Please enter a valid price");
      return;
    }

    addSimpleToCart(openItemDish, numPrice);
    setShowOpenItemModal(false);
    setOpenItemDish(null);
    setOpenItemPrice("");
  };

  const handleDishClick = async (dish: any) => {
    if (dish.IsSoldOut) {
      toast.showToast({ message: "Dish is Sold Out", type: "warning" });
      return;
    }

    const isComboEnabled = useGeneralSettingsStore.getState().settings.enableCombo !== false;
    const isItCombo = isComboEnabled && (dish.IsCombo === true || String(dish.IsCombo) === "1" || String(dish.IsCombo) === "true");
    if (isItCombo) {
      setComboDish(dish);
      setShowComboModal(true);
      return;
    }

    const isItOpenItem = Number(dish.IsOpenItem) === 1 || dish.IsOpenItem === true || dish.IsOpenItem === 'true' || dish.IsOpenItem === '1';
    if (isItOpenItem) {
      setOpenItemDish(dish);
      setOpenItemPrice(dish.Price > 0 ? String(dish.Price) : "");
      setOpenItemError("");
      setShowOpenItemModal(true);
      return;
    }

    // 🚀 INSTANT 0ms ADDITION: Check if dish has modifiers (HasModifiers column from SQL)
    const hasMods = Number(dish.HasModifiers || 0) > 0;
    if (!hasMods) {
      // Dish HAS NO MODIFIERS — add to cart INSTANTLY in 0ms!
      addSimpleToCart(dish);
      return;
    }

    // Dish HAS MODIFIERS — check cache first for instant modal open!
    const dishIdStr = String(dish.DishId);
    if (modifiersCache[dishIdStr]) {
      setModifiers(modifiersCache[dishIdStr].map((x) => ({ ...x })));
      setSelectedDish(dish);
      setSelectedModifierQuantities({});
      setCustomMods([]);
      setShowCustomModModal(false);
      setActiveOpenMod(null);
      setCustomModName("");
      setCustomModPrice("");
      setShowModifier(true);
      return;
    }

    // Fetch modifiers from API if not cached yet
    setSelectedDish(dish);
    setSelectedModifierQuantities({});
    setCustomMods([]);
    setShowCustomModModal(false);
    setActiveOpenMod(null);
    setCustomModName("");
    setCustomModPrice("");
    setLoadingModifiers(true);

    try {
      const res = await fetch(`${API_URL}/api/menu/modifiers/${dish.DishId}`);
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        setModifiersCache((prev) => ({ ...prev, [dishIdStr]: data }));
        setModifiers(data.map((x) => ({ ...x })));
        setShowModifier(true);
      } else {
        addSimpleToCart(dish);
      }
    } catch (err) {
      addSimpleToCart(dish);
    } finally {
      setLoadingModifiers(false);
    }
  };

  const handleCompletePayment = async (skipPayNowCheck = false) => {
    if (cartItems.length === 0) {
      toast.showToast({ message: "Cart is empty!", type: "warning" });
      return;
    }

    const normMethod = (selectedPaymentMethod || "CASH").toUpperCase().trim();

    // 1. Validation for MEMBER and CREDIT Accounts
    if (normMethod === "MEMBER" || normMethod === "CREDIT") {
      if (!selectedMember) {
        setMemberModalType(normMethod === "CREDIT" ? "CREDIT" : "MEMBER");
        setShowMemberModal(true);
        toast.showToast({
          message: `Please select a ${normMethod === "CREDIT" ? "credit customer" : "member"} first`,
          type: "warning",
        });
        return;
      }

      if (normMethod === "CREDIT") {
        const avail =
          selectedMember.AvailableCredit !== undefined
            ? Number(selectedMember.AvailableCredit)
            : Number(selectedMember.CreditLimit || 0) - Number(selectedMember.CurrentBalance || 0);
        if (finalTotal > avail) {
          toast.showToast({
            message: `Credit limit exceeded! (Available: $${avail.toFixed(2)})`,
            type: "error",
          });
          return;
        }
      }
    }

    // 1a. Cash Received popup — display Cash Received modal for CASH payment
    if (normMethod === "CASH" && !showCashModal) {
      openCashReceivedModal();
      return;
    }

    // 1b. PayNow QR popup — show QR, wait for manual confirmation
    if (!skipPayNowCheck && normMethod === "PAYNOW") {
      setShowPayNowModal(true);
      return;
    }

    // 2. Terminal Payment Flow for YeahPay
    if (normMethod.includes("YEAHPAY")) {
      const pmObj = activePaymodes.find(
        (p) => String(p.payMode || p.description || "").toUpperCase().trim() === normMethod
      );
      const deviceSn = (pmObj?.DeviceSN || pmObj?.deviceSn || "").trim();
      const salt = (pmObj?.DeviceSalt || pmObj?.deviceSalt || "").trim();

      if (!deviceSn) {
        toast.showToast({
          message: "DeviceSN not configured for YeahPay terminal",
          type: "error",
        });
        return;
      }

      setTerminalModalVisible(true);
      setTerminalStatus("processing");
      setTerminalMessage(`Processing payment on terminal (${deviceSn})...\nWaiting for customer response...`);

      const isCard = normMethod.includes("CARD");
      const endpoint = isCard ? "/api/yeahpay/card-payment" : "/api/yeahpay/paynow-payment";
      const activeTableId = selectedTable ? String(selectedTable.id || selectedTable.TableId || "") : "";

      try {
        const token = useAuthStore.getState().token;
        const response = await fetch(`${API_URL}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            amount: finalTotal,
            deviceSn,
            salt: salt || "",
            tableId: activeTableId,
          }),
        });

        const result = await response.json();
        const responseCode = result.code;

        if (result.success || responseCode === 0) {
          setTerminalStatus("success");
          setTerminalMessage(`Paid successfully via ${selectedPaymentMethod}!`);
          setTimeout(() => {
            setTerminalModalVisible(false);
            executePaymentFinalize();
          }, 350);
          return;
        } else if (responseCode === -1027) {
          setTerminalStatus("cancelled");
          setTerminalMessage("Transaction cancelled on terminal");
          toast.showToast({ message: "Transaction cancelled on terminal", type: "warning" });
          setTimeout(() => setTerminalModalVisible(false), 1200);
          return;
        } else {
          setTerminalStatus("failed");
          const errMsg = result.msg || result.error || "Payment declined on terminal";
          setTerminalMessage(errMsg);
          toast.showToast({ message: errMsg, type: "error" });
          setTimeout(() => setTerminalModalVisible(false), 1500);
          return;
        }
      } catch (termErr: any) {
        setTerminalStatus("failed");
        setTerminalMessage(termErr.message || "Failed to communicate with terminal");
        toast.showToast({ message: "Failed to communicate with terminal", type: "error" });
        setTimeout(() => setTerminalModalVisible(false), 1500);
        return;
      }
    }

    // 3. Normal / Direct Checkout Finalization (Cash, Nets, PayNow, FOC, Member, Credit, etc.)
    await executePaymentFinalize();
  };

  const executePaymentFinalize = async (paidCashAmount?: number, changeReturnAmount?: number) => {
    setIsProcessingPayment(true);
    try {
      const activeTableId = selectedTable ? String(selectedTable.id || selectedTable.TableId || "") : "";
      const rawTableName = selectedTable ? String(selectedTable.label || selectedTable.TableNumber || selectedTable.name || "01") : "01";
      const formattedTableName = rawTableName.toLowerCase().startsWith("table") ? rawTableName : `Table ${rawTableName}`;

      const cashierIdent = user?.userName || user?.userId || user?.userCode || "123";

      // ⚡ SNAPSHOT CART BEFORE CLEARING (for printing)
      const currentCartSnapshot = [...cartItems];

      // ⚡ INSTANT OPTIMISTIC CLEAR — wipe cart immediately so UI feels instant with ZERO delay
      const targetCtx = useCartStore.getState().currentContextId || getContextId(useOrderContextStore.getState().currentOrder);
      if (targetCtx) {
        useCartStore.getState().setCartItems(targetCtx, [], true, "QUICK_SERVE_PAID_COMPLETE");
      }
      useCartStore.getState().clearTableSession(activeTableId);
      useCartStore.setState((state) => {
        const nextCarts = { ...state.carts };
        const nextCartQtyMap = { ...state.cartQtyMap };
        if (targetCtx) {
          nextCarts[targetCtx] = [];
          nextCartQtyMap[targetCtx] = {};
        }
        Object.keys(nextCarts).forEach((k) => {
          if (activeTableId && (k.includes(activeTableId) || k.toLowerCase().includes(activeTableId.toLowerCase()))) {
            nextCarts[k] = [];
            nextCartQtyMap[k] = {};
          }
        });
        return {
          carts: nextCarts,
          cartQtyMap: nextCartQtyMap,
          lastLocalUpdate: { ...state.lastLocalUpdate, ...(targetCtx ? { [targetCtx]: Date.now() + 15000 } : {}) },
        };
      });

      const isCash = (selectedPaymentMethod || "").toUpperCase().trim() === "CASH";
      const actualPaid = isCash ? (paidCashAmount !== undefined ? paidCashAmount : finalTotal) : finalTotal;
      const actualChange = isCash ? (changeReturnAmount !== undefined ? changeReturnAmount : Math.max(0, actualPaid - finalTotal)) : 0;

      const saleData: any = {
        totalAmount: finalTotal,
        subTotal: subtotal,
        discountAmount: discountAmount,
        orderDiscountAmount: discountAmount,
        serviceCharge: serviceChargeAmount,
        takeawayCharges: totalTakeawayChargesAmount,
        taxAmount: gstAmount,
        paymentMethod: selectedPaymentMethod,
        orderType: isTakeawayOrder ? "TAKEAWAY" : "DINE_IN",
        tableNo: formattedTableName,
        tableId: activeTableId,
        cashierId: user?.userId || cashierIdent,
        cashierName: cashierIdent,
        waiterName: cashierIdent,
        isQuickServe: true,
        memberId: selectedMember?.MemberId || null,
        customerName: selectedMember?.Name || null,
        mobileNo: selectedMember?.Phone || null,
        cashPaid: actualPaid,
        tenderedAmount: actualPaid,
        changeAmount: actualChange,
        items: currentCartSnapshot.map((item: any) => ({
          id: String(item.id || item.DishId),
          DishId: String(item.id || item.DishId),
          name: item.name || item.DishName,
          price: Number(item.price || 0),
          qty: Number(item.qty || 1),
          subtotal: Number(item.price || 0) * Number(item.qty || 1),
          modifiers: item.modifiers || [],
          isServiceCharge: item.isServiceCharge !== false,
        })),
        payments: [
          {
            payMode: selectedPaymentMethod,
            amount: finalTotal,
            tenderedAmount: actualPaid,
            changeAmount: actualChange,
          },
        ],
      };

      const res = await fetch(`${API_URL}/api/sales/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": quickServeToken || `QS-${Date.now()}`,
          ...(useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {}),
        },
        body: JSON.stringify(saleData),
      });

      const resJson = await res.json();
      if (!res.ok && !resJson.success) {
        throw new Error(resJson.error || resJson.message || "Failed to save transaction to sales report");
      }

      const generatedBillNo = resJson.billNo || resJson.orderId || quickServeToken;

      setIsProcessingPayment(false);
      setShowCashModal(false);
      setCashReceivedInput("");
      generatePosOrderId();
      setDiscountPercent(0);
      setCustomAmount("");
      setSelectedMember(null);

      toast.showToast({
        message: `🎉 Payment Successful! (${generatedBillNo})`,
        subtitle: `Bill Total: $${finalTotal.toFixed(2)} (${selectedPaymentMethod}) — ${formattedTableName}`,
        type: "success",
        duration: 3000,
      });

      // 🖥️ Notify Customer Display of Payment Success
      CustomerDisplaySync.syncPaymentSuccess({
        orderId: generatedBillNo,
        total: finalTotal,
        paid: actualPaid,
        change: actualChange,
        method: selectedPaymentMethod,
      });

      const effectiveTableNo = isTakeawayOrder ? "Takeaway" : formattedTableName;
      const effectiveTableId = isTakeawayOrder ? "takeaway" : activeTableId;
      const effectiveTakeawayNo = isTakeawayOrder ? (generatedBillNo ? String(generatedBillNo).slice(-4) : "1") : undefined;

      // Prepare order context & receipt data for background printing
      const orderContextObj = {
        orderType: isTakeawayOrder ? "TAKEAWAY" : "DINE_IN",
        tableNo: effectiveTableNo,
        tableId: effectiveTableId,
        section: isTakeawayOrder ? "TAKEAWAY" : (selectedSection || "Section 1"),
        takeawayNo: effectiveTakeawayNo,
        isQuickServe: true,
      };

      const receiptPrintData = {
        ...saleData,
        id: generatedBillNo,
        invoiceNumber: generatedBillNo,
        orderId: generatedBillNo,
        billNo: generatedBillNo,
        items: currentCartSnapshot,
        total: finalTotal,
        subtotal: subtotal,
        discountAmount: discountAmount,
        serviceCharge: serviceChargeAmount,
        taxAmount: gstAmount,
        tableNo: effectiveTableNo,
        takeawayNo: effectiveTakeawayNo,
        waiterName: cashierIdent,
        date: new Date(),
        isCheckout: false, // ✅ Completed Payment Receipt (NOT 'PAYMENT PENDING')
        isQuickServe: true,
      };

      // 🚀 ASYNCHRONOUS FIRE-AND-FORGET PRINTING & TABLE REFRESH
      (async () => {
        // 1. KDS Alert via Socket
        const liveSettings = useGeneralSettingsStore.getState().settings || {};
        const isKDSEnabled = liveSettings.enableKDS !== false;
        const isKOTEnabled = liveSettings.quickServeEnableKOT !== false;
        const isKDSPrintEnabled = liveSettings.quickServeEnableKDSPrinter !== false;
        const isReceiptPrintEnabled = liveSettings.enableReceiptPrint !== false;

        if (isKDSEnabled && socket) {
          try {
            socket.emit("new_order", {
              orderId: generatedBillNo,
              context: orderContextObj,
              items: currentCartSnapshot.map((i: any) => ({ ...i, status: "SENT" })),
              createdAt: Date.now(),
            });
          } catch (sErr) {
            console.error("[QuickServe] Socket KDS emit error:", sErr);
          }
        }

        // 2. Kitchen / KDS Order Printing (Prints KOT to kitchen printers AND/OR KDS printer)
        if (isKOTEnabled || isKDSPrintEnabled) {
          try {
            await UniversalPrinter.routeAndPrintOrderKOT(
              generatedBillNo,
              orderContextObj,
              currentCartSnapshot,
              false,
              cashierIdent,
              true // skipDuplicateGuard: cashier direct flow is authoritative
            );
          } catch (kotErr) {
            console.error("[QuickServe] Automatic KOT / KDS Print Error:", kotErr);
          }
        }

        // 3. Receipt Bill Printing (Complete Payment Receipt)
        if (isReceiptPrintEnabled) {
          try {
            await UniversalPrinter.smartPrint(
              receiptPrintData,
              user?.userId || "SYSTEM"
            );
          } catch (billErr) {
            console.error("[QuickServe] Automatic Receipt Print Error:", billErr);
          }
        }

        // 4. Background Table Auto-Advance (for Dine-In only)
        if (!isTakeawayOrder) {
          try {
            const updatedTables = await fetch(`${API_URL}/api/tables/all`).then((r) => r.json());
            if (Array.isArray(updatedTables) && updatedTables.length > 0) {
              setAllMasterTables(updatedTables);
              const freeTables = updatedTables.filter(
                (t: any) => t.Status === 0 || t.Status === null || t.Status === undefined || String(t.Status) === "0"
              );
              if (freeTables.length > 0) {
                const nextFree = freeTables.find((t: any) => String(t.id || t.TableId) !== activeTableId) || freeTables[0];
                selectQuickServeTable(nextFree, true);
              }
            }
          } catch (tErr) {
            console.error("[QuickServe] Table refresh error:", tErr);
          }
        }
      })().catch(console.error);

    } catch (err: any) {
      console.error("Payment error:", err);
      setIsProcessingPayment(false);
      toast.showToast({
        message: "Payment Failed",
        subtitle: err.message || "Failed to process sale transaction",
        type: "error",
      });
    }
  };

  const getCategoryCoverImage = (cat: any) => {
    if (!cat) return ALL_ITEMS_IMAGE;
    const raw = cat.Image || cat.ImagePath || cat.CategoryLogo;
    if (raw) return getImageUrl(raw) || ALL_ITEMS_IMAGE;
    const n = (cat.KitchenTypeName || cat.CategoryName || "").toLowerCase();
    if (n.includes("chinese")) return "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=200&auto=format&fit=crop&q=80";
    if (n.includes("south")) return "https://images.unsplash.com/photo-1630383249896-424e482df921?w=200&auto=format&fit=crop&q=80";
    if (n.includes("north") || n.includes("indian")) return "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=200&auto=format&fit=crop&q=80";
    if (n.includes("beverage") || n.includes("drink")) return "https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=200&auto=format&fit=crop&q=80";
    if (n.includes("kebab")) return "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=200&auto=format&fit=crop&q=80";
    if (n.includes("dessert") || n.includes("sweet")) return "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=200&auto=format&fit=crop&q=80";
    return "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=200&auto=format&fit=crop&q=80";
  };

  const getCategoryCount = (cat: any) => {
    if (!cat) return 0;
    const catIdStr = String(typeof cat === "object" ? cat.CategoryId || "" : cat);
    const foundCat = typeof cat === "object" ? cat : categories.find((c) => String(c.CategoryId) === catIdStr);
    const catName = (foundCat?.KitchenTypeName || foundCat?.CategoryName || "").toLowerCase();

    const count = dishes.filter((d) => {
      const dishCatId = String(d.CategoryId || "");
      const dishKitchenId = String(d.KitchenTypeId || "");
      const dishKitchenCode = String(d.KitchenTypeCode || "");
      const dishKitchenName = (d.KitchenTypeName || "").toLowerCase();

      if (catIdStr && (dishCatId === catIdStr || dishKitchenId === catIdStr || dishKitchenCode === catIdStr)) {
        return true;
      }
      if (catName && dishKitchenName && dishKitchenName === catName) {
        return true;
      }
      return false;
    }).length;

    return count;
  };

  const getTablesForSection = (sectionName: string, loadedTables: any[]) => {
    if (loadedTables && loadedTables.length > 0) {
      const secKey = sectionName.toLowerCase();
      const filtered = loadedTables.filter((t) => {
        const s = String(t.DiningSection || t.section || "").toLowerCase();
        if (secKey.includes("takeaway")) return s.includes("takeaway") || String(t.TableName || t.name || "").startsWith("PU");
        if (secKey.includes("1")) return s.includes("1");
        if (secKey.includes("2")) return s.includes("2");
        if (secKey.includes("3")) return s.includes("3");
        return true;
      });
      if (filtered.length > 0) return filtered;
    }

    if (sectionName === "Takeaway") {
      return Array.from({ length: 10 }).map((_, i) => ({ id: `pu_${i+1}`, name: `PU${i + 1}` }));
    }
    return [
      { id: "36", name: "36", isOvertime: true },
      { id: "37", name: "37" },
      { id: "38", name: "38" },
      { id: "39", name: "39" },
      { id: "40", name: "40" },
      { id: "41", name: "41" },
      { id: "42", name: "42" },
      { id: "43", name: "43" },
      { id: "44", name: "44" },
      { id: "45", name: "45" },
    ];
  };

  const toggleOrderType = () => {
    const currentOrder = useOrderContextStore.getState().currentOrder;
    const isCurrentlyTW = currentOrder?.orderType === "TAKEAWAY";
    const newOrderType = isCurrentlyTW ? "DINE_IN" : "TAKEAWAY";

    const rawTableLabel = selectedTable ? String(selectedTable.label || selectedTable.TableNumber || selectedTable.name || "01") : "01";
    const defaultDineInTable = rawTableLabel.toLowerCase().startsWith("table") ? rawTableLabel : `Table ${rawTableLabel}`;

    const updatedContext = {
      ...(currentOrder || {}),
      orderType: newOrderType as "DINE_IN" | "TAKEAWAY",
      section: isCurrentlyTW ? (selectedSection || "SECTION_1") : "TAKEAWAY",
      tableNo: isCurrentlyTW ? defaultDineInTable : "Takeaway",
      tableId: isCurrentlyTW ? (selectedTable ? String(selectedTable.id || selectedTable.TableId || "1") : "1") : "takeaway",
      takeawayNo: isCurrentlyTW ? undefined : "1",
    };

    const cartStore = useCartStore.getState();
    const oldContextId = (currentOrder ? getContextId(currentOrder) : null) || cartStore.currentContextId;
    const currentItems = (oldContextId ? cartStore.carts[oldContextId] : null) || cartStore.getCart() || [];
    const newContextId = getContextId(updatedContext);

    useOrderContextStore.getState().setOrderContext(updatedContext);

    if (newContextId) {
      const updatedItems = currentItems.map((item: any) => ({
        ...item,
        isTakeaway: newOrderType === "TAKEAWAY",
      }));
      cartStore.setCartItems(newContextId, updatedItems, true, "SWITCH_ORDER_TYPE");
      if (oldContextId && oldContextId !== newContextId) {
        cartStore.setCartItems(oldContextId, [], true, "SWITCH_ORDER_TYPE_CLEANUP");
      }
      cartStore.setCurrentContext(newContextId);
    }

    toast.showToast({
      message: newOrderType === "TAKEAWAY" ? "🥡 Switched to Takeaway (TW)" : "🍽️ Switched to Dine In",
      type: "info",
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* TOP HEADER */}
      <View style={styles.topNavbar}>
        <View style={styles.navLeft}>
          <TouchableOpacity
            style={styles.logoWrap}
            onPress={() => {
              // Navigating from Quick Serve to Floor Plan (Dine In) must explicitly initialize Section 1
              router.replace("/(tabs)/category?section=SECTION_1");
            }}
            activeOpacity={0.8}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: "#FF5E1A",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 8,
                shadowColor: "#FF5E1A",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 3,
              }}
            >
              <Ionicons name="flash" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.logoTitle}>
              Quick Serve <Text style={{ color: "#FF5E1A" }}>POS</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* SEARCH BAR (Hidden on tiny mobile or compacted) */}
        {!isMobile && (
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={18} color="#94A3B8" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search dishes by name or code..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={18} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* TOP RIGHT CONTROLS */}
        <View style={styles.navRight}>
          <SyncStatusBadge />
          {showLoyalty && isMobile && (
            <TouchableOpacity
              style={[styles.summaryActionBtn, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}
              onPress={() => setShowLoyaltyModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="ribbon-outline" size={14} color="#10B981" />
              <Text style={[styles.summaryActionBtnText, { color: "#10B981" }]}>Loyalty</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.summaryActionBtn, { backgroundColor: "#FFF7ED", borderColor: "#FFEDD5" }]}
            onPress={() => setShowDiscountTypeModal(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="pricetag-outline" size={14} color="#FF5A16" />
            <Text style={[styles.summaryActionBtnText, { color: "#FF5A16" }]}>Discount</Text>
          </TouchableOpacity>

          {showRewardPoints && isMobile && (
            <TouchableOpacity
              style={[styles.summaryActionBtn, { backgroundColor: "#FEF3C7", borderColor: "#FDE68A" }]}
              onPress={() => setShowRewardModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="star-outline" size={14} color="#D97706" />
              <Text style={[styles.summaryActionBtnText, { color: "#D97706" }]}>Reward Points</Text>
            </TouchableOpacity>
          )}

          {showPromoCode && isMobile && (
            <TouchableOpacity
              style={[styles.summaryActionBtn, { backgroundColor: "#F3E8FF", borderColor: "#E9D5FF" }]}
              onPress={() => setShowPromoModal(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="barcode-outline" size={14} color="#9333EA" />
              <Text style={[styles.summaryActionBtnText, { color: "#9333EA" }]}>Promo Code</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.orderTypePill,
              isTakeawayOrder ? styles.orderTypePillTW : styles.orderTypePillDineIn,
            ]}
            onPress={toggleOrderType}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isTakeawayOrder ? "bag-handle-outline" : "cart-outline"}
              size={16}
              color="#FF5A16"
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.orderTypePillText, { color: isTakeawayOrder ? "#FF5A16" : "#0F172A" }]}>
              {isTakeawayOrder ? "Takeaway" : "Dine In"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tableNoPill}
            onPress={() => {
              setIsTableSearchOpen(false);
              setTableSearchQuery("");
              fetchMasterTablesAndAutoSelectFree(true);
              setTableModalVisible(true);
            }}
            activeOpacity={0.8}
          >
            <View style={styles.tableOrangeCircle}>
              <Text style={styles.tableOrangeCircleText}>
                {selectedTable
                  ? String(selectedTable.label || selectedTable.TableNumber || selectedTable.id || "1").replace(/[^0-9]/g, "") || "1"
                  : "1"}
              </Text>
            </View>
            <Text style={styles.tableNoPillText}>
              {selectedTable
                ? String(selectedTable.label || selectedTable.TableNumber || "").toLowerCase().startsWith("table")
                  ? String(selectedTable.label || selectedTable.TableNumber)
                  : `Table ${selectedTable.label || selectedTable.TableNumber || "01"}`
                : "Table 01"}
            </Text>
            <Ionicons name="chevron-down" size={13} color="#FF5A16" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>
      </View>

      {/* MOBILE COMPACT SEARCH BAR */}
      {isMobile && (
        <View style={styles.mobileSearchWrapper}>
          <View style={styles.mobileSearchContainer}>
            <Ionicons name="search-outline" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
            <TextInput
              style={styles.mobileSearchInput}
              placeholder="Search dishes..."
              placeholderTextColor="#94A3B8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={16} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* MOBILE TOP TAB SEGMENT (Order | Groups | Dishes) */}
      {isMobile && (
        <View style={styles.mobileTabBarContainer}>
          <TouchableOpacity
            style={[styles.mobileTabButton, mobileActiveTab === "dishes" && styles.mobileTabButtonActive]}
            onPress={() => setMobileActiveTab("dishes")}
          >
            <Ionicons
              name="fast-food-outline"
              size={15}
              color={mobileActiveTab === "dishes" ? "#FF5A16" : "#64748B"}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.mobileTabButtonText, mobileActiveTab === "dishes" && styles.mobileTabButtonTextActive]}>
              Menu Dishes
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mobileTabButton, mobileActiveTab === "groups" && styles.mobileTabButtonActive]}
            onPress={() => setMobileActiveTab("groups")}
          >
            <Ionicons
              name="restaurant-outline"
              size={15}
              color={mobileActiveTab === "groups" ? "#FF5A16" : "#64748B"}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.mobileTabButtonText, mobileActiveTab === "groups" && styles.mobileTabButtonTextActive]}>
              {leftPanelView === "category" ? "Categories" : "Groups"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mobileTabButton, mobileActiveTab === "order" && styles.mobileTabButtonActive]}
            onPress={() => setMobileActiveTab("order")}
          >
            <Ionicons
              name="cart-outline"
              size={15}
              color={mobileActiveTab === "order" ? "#FF5A16" : "#64748B"}
              style={{ marginRight: 5 }}
            />
            <Text style={[styles.mobileTabButtonText, mobileActiveTab === "order" && styles.mobileTabButtonTextActive]}>
              Cart ({cartItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 3-COLUMN MAIN BODY */}
      {quickServeModeEnabled ? (
        <View style={[styles.mainBody3Column, isMobile && styles.mainBodyMobile, isTablet && styles.mainBodyTablet]}>
            {/* ================= COLUMN 1: LEFT SIDE → CURRENT ORDER / CART ================= */}
            {(!isMobile || mobileActiveTab === "order") && (
            <View style={[styles.leftCartColumn, isMobile && styles.leftCartColumnMobile, isTablet && styles.leftCartColumnTablet]}>
            {/* CART HEADER BANNER */}
            <View style={styles.cartHeaderBanner}>
              <View style={styles.cartHeaderLeft}>
                <Ionicons name="cart" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.cartHeaderTitle}>Current Order</Text>
                <View style={styles.cartHeaderBadge}>
                  <Text style={styles.cartHeaderBadgeText}>{cartItems.length}</Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => clearCart()}
                style={styles.clearCartBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={13} color="#FFFFFF" style={{ marginRight: 3 }} />
                <Text style={styles.clearCartText}>Clear</Text>
              </TouchableOpacity>
            </View>

            {/* CART ITEMS LIST */}
            <ScrollView style={styles.cartItemsScroll} showsVerticalScrollIndicator={false}>
              {cartItems.length === 0 ? (
                <View style={styles.emptyCartBox}>
                  <Ionicons name="basket-outline" size={40} color="#CBD5E1" />
                  <Text style={styles.emptyCartTitle}>Order cart is empty</Text>
                  <Text style={styles.emptyCartSub}>Click + on dishes to add them to order</Text>
                </View>
              ) : (
                cartItems.map((item, idx) => {
                  const itemPrice = Number(item.price || 0);
                  const itemQty = Number(item.qty || 1);
                  const itemTotal = itemPrice * itemQty;

                  // Extract combo selections text list if present
                  const rawComboSelections = item.comboSelections || (item as any).ComboSelections || (item as any).comboItems;
                  const comboLines: string[] = [];
                  if (Array.isArray(rawComboSelections) && rawComboSelections.length > 0) {
                    rawComboSelections.forEach((group: any) => {
                      const groupName = group.groupName || group.GroupName || "";
                      const groupItems = group.items || group.options || group.Options || [];
                      if (Array.isArray(groupItems) && groupItems.length > 0) {
                        const names = groupItems.map((i: any) => (typeof i === "string" ? i : i.name || i.DishName || i.Name)).filter(Boolean).join(", ");
                        if (names) {
                          comboLines.push(groupName ? `${groupName}: ${names}` : names);
                        }
                      } else if (typeof group === "string") {
                        comboLines.push(group);
                      }
                    });
                  }

                  // Extract modifiers text list if present
                  const rawModifiers = item.modifiers || (item as any).Modifiers;
                  const modifierLines: string[] = [];
                  if (Array.isArray(rawModifiers) && rawModifiers.length > 0) {
                    rawModifiers.forEach((m: any) => {
                      const mName = typeof m === "string" ? m : m.ModifierName || m.modifierName || m.name || "";
                      const mPrice = typeof m === "object" && Number(m.Price || m.price || 0) > 0 ? ` (+$${Number(m.Price || m.price).toFixed(2)})` : "";
                      if (mName) modifierLines.push(`${mName}${mPrice}`);
                    });
                  }

                  return (
                    <View key={item.lineItemId || idx} style={styles.cartItemCard}>
                      <View style={styles.cartItemInfo}>
                        <Text style={styles.cartItemName} numberOfLines={1}>
                          {item.name}
                        </Text>

                        {/* COMBO SELECTIONS SUBTEXT */}
                        {comboLines.length > 0 && (
                          <View style={styles.cartSubDetailWrap}>
                            {comboLines.map((lineText, cIdx) => (
                              <Text key={cIdx} style={styles.cartSubDetailText} numberOfLines={1}>
                                • {lineText}
                              </Text>
                            ))}
                          </View>
                        )}

                        {/* MODIFIERS SUBTEXT */}
                        {modifierLines.length > 0 && (
                          <View style={styles.cartSubDetailWrap}>
                            {modifierLines.map((modText, mIdx) => (
                              <Text key={mIdx} style={styles.cartSubDetailText} numberOfLines={1}>
                                + {modText}
                              </Text>
                            ))}
                          </View>
                        )}
                      </View>

                      {/* QTY CONTROLS PILL */}
                      <View style={styles.qtyControlPill}>
                        <TouchableOpacity
                          style={styles.qtyBtnMinus}
                          onPress={() => {
                            if (itemQty > 1) {
                              updateCartItemQty(item.lineItemId, itemQty - 1);
                            } else {
                              removeFromCartGlobal(item.lineItemId);
                            }
                          }}
                        >
                          <Ionicons name="remove" size={12} color="#334155" />
                        </TouchableOpacity>

                        <Text style={styles.qtyNumText}>{itemQty}</Text>

                        <TouchableOpacity
                          style={styles.qtyBtnPlus}
                          onPress={() => updateCartItemQty(item.lineItemId, itemQty + 1)}
                        >
                          <Ionicons name="add" size={12} color="#334155" />
                        </TouchableOpacity>
                      </View>

                      <Text style={styles.cartItemTotalText}>${itemTotal.toFixed(2)}</Text>

                      <TouchableOpacity
                        onPress={() => removeFromCartGlobal(item.lineItemId)}
                        style={styles.deleteItemBtn}
                      >
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* CART TOTALS & PAYMENT FOOTER */}
            <View style={styles.cartFooterArea}>
              {cartItems.length > 0 && (
                <>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>${subtotal.toFixed(2)}</Text>
                  </View>

                  {discountAmount > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={[styles.summaryLabel, { color: "#FF5A16" }]}>
                        Discount {appliedOrderDiscount?.label ? `(${appliedOrderDiscount.label})` : discountPercent > 0 ? `(${discountPercent}%)` : ""}
                      </Text>
                      <Text style={[styles.summaryValue, { color: "#FF5A16", fontFamily: Fonts.bold }]}>
                        -${discountAmount.toFixed(2)}
                      </Text>
                    </View>
                  )}

                  {applicableScPercentage > 0 && (scEligibleSubtotal > 0 || serviceChargeAmount > 0) && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        {isTakeawayOrder ? "TW Service Charge" : "Service Charge"} ({applicableScPercentage}%)
                      </Text>
                      <Text style={styles.summaryValue}>${serviceChargeAmount.toFixed(2)}</Text>
                    </View>
                  )}

                  {totalTakeawayChargesAmount > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Takeaway Charge</Text>
                      <Text style={styles.summaryValue}>${totalTakeawayChargesAmount.toFixed(2)}</Text>
                    </View>
                  )}

                  {applicableGstPercentage > 0 && (gstAmount > 0 || subtotal > 0) && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>
                        GST ({applicableGstPercentage}%) {companySettings?.taxMode === "inclusive" ? "(Incl)" : ""}
                      </Text>
                      <Text style={styles.summaryValue}>${gstAmount.toFixed(2)}</Text>
                    </View>
                  )}

                  {/* FINAL TOTAL BEIGE CARD */}
                  <View style={styles.finalTotalCard}>
                    <Text style={styles.finalTotalLabel}>Final Total</Text>
                    <Text style={styles.finalTotalValue}>${finalTotal.toFixed(2)}</Text>
                  </View>
                </>
              )}

              {/* PAYMODE SECTION (FIRST WITH TOP-TO-DOWN SCROLL BUTTONS) */}
              <View style={styles.payMethodsWrapper}>
                <Text style={styles.paymodeHeaderTitle}>Paymode</Text>

                <View style={styles.paymodeVertRow}>
                  {/* VERTICAL GRID OF PAYMODES (5 PER ROW) */}
                  <View style={styles.paymodeGridScrollWrap}>
                    <ScrollView
                      ref={paymodeScrollRef}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      style={styles.paymodeVertScrollView}
                      onScroll={(e) => setScrollOffset(e.nativeEvent.contentOffset.y)}
                      scrollEventThrottle={16}
                    >
                      <View style={styles.paymodeGridInnerContent}>
                        {(activePaymodes.length > 0 ? activePaymodes : [
                          { key: "CASH", label: "Cash" },
                          { key: "CARD", label: "Card" },
                          { key: "UPI", label: "UPI / QR" },
                          { key: "NETS", label: "NETS" },
                          { key: "PAYNOW", label: "PayNow" },
                          { key: "SPLIT", label: "Split" },
                        ]).map((pm: any, pIdx: number) => {
                          const modeKey = String(pm.payMode || pm.description || pm.key || "").toUpperCase();
                          const modeLabel = pm.description || pm.payMode || pm.label || modeKey;
                          const isSelected = selectedPaymentMethod === modeKey;
                          const isYeahPay = pm.YeahPayEnabled === true || pm.yeahPayEnabled === true || modeKey.includes("YEAHPAY");
                          const { icon, color, bg } = getPaymodeIconAndColor(modeKey);

                          return (
                            <TouchableOpacity
                              key={pm.Position || modeKey || pIdx}
                              style={[
                                styles.payMethodGridItem,
                                isSelected && styles.payMethodBtnActive,
                                !isSelected && isYeahPay && styles.payMethodYeahPay,
                              ]}
                              onPress={() => handleSelectPaymode(modeKey)}
                              activeOpacity={0.8}
                            >
                              <View style={[styles.payMethodIconBg, { backgroundColor: isSelected ? "#FFEDD5" : (!isSelected && isYeahPay ? "#DCFCE7" : bg) }]}>
                                <Ionicons name={icon as any} size={15} color={isSelected ? "#FF5A16" : (!isSelected && isYeahPay ? "#059669" : color)} />
                              </View>
                              <Text
                                style={[
                                  styles.payMethodLabel,
                                  isSelected && styles.payMethodLabelActive,
                                  !isSelected && isYeahPay && styles.payMethodLabelYeahPay,
                                ]}
                                numberOfLines={2}
                              >
                                {modeLabel}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </ScrollView>
                  </View>

                  {/* SINGLE UNIFIED SCROLL BUTTON PILL ON THE RIGHT */}
                  <View style={styles.singleScrollPill}>
                    <TouchableOpacity
                      style={styles.singleScrollHalf}
                      onPress={() => scrollPaymodesVertically("up")}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chevron-up" size={14} color="#334155" />
                    </TouchableOpacity>

                    <View style={styles.singleScrollDivider} />

                    <TouchableOpacity
                      style={styles.singleScrollHalf}
                      onPress={() => scrollPaymodesVertically("down")}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chevron-down" size={14} color="#334155" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* SELECTED MEMBER / CREDIT CUSTOMER BADGE OR PROMPT */}
                {(selectedPaymentMethod.toUpperCase().trim() === "MEMBER" || selectedPaymentMethod.toUpperCase().trim() === "CREDIT") && (
                  <View style={styles.memberPaymodePromptWrap}>
                    {selectedMember ? (
                      <View style={styles.selectedMemberBadge}>
                        <View style={styles.selectedMemberBadgeLeft}>
                          <View style={styles.selectedMemberIconBox}>
                            <Ionicons
                              name={selectedPaymentMethod.toUpperCase().trim() === "CREDIT" ? "wallet" : "ribbon"}
                              size={14}
                              color="#FFFFFF"
                            />
                          </View>
                          <View style={{ flex: 1, marginRight: 6 }}>
                            <Text style={styles.selectedMemberNameText} numberOfLines={1}>
                              {selectedMember.Name}
                            </Text>
                            <Text style={styles.selectedMemberPhoneText} numberOfLines={1}>
                              {selectedMember.Phone} • Avail: ${Number(
                                selectedMember.AvailableCredit !== undefined
                                  ? selectedMember.AvailableCredit
                                  : (selectedMember.CreditLimit || 0) - (selectedMember.CurrentBalance || 0)
                              ).toFixed(2)}
                            </Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <TouchableOpacity
                            style={styles.memberChangeBtn}
                            onPress={() => {
                              setMemberModalType(selectedPaymentMethod.toUpperCase().trim() === "CREDIT" ? "CREDIT" : "MEMBER");
                              setShowMemberModal(true);
                            }}
                          >
                            <Text style={styles.memberChangeBtnText}>Change</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.memberRemoveBtn}
                            onPress={() => setSelectedMember(null)}
                          >
                            <Ionicons name="close" size={14} color="#64748B" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.memberSelectPromptBtn}
                        onPress={() => {
                          setMemberModalType(selectedPaymentMethod.toUpperCase().trim() === "CREDIT" ? "CREDIT" : "MEMBER");
                          setShowMemberModal(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="person-add" size={13} color="#FF5A16" />
                        <Text style={styles.memberSelectPromptText}>
                          {selectedPaymentMethod.toUpperCase().trim() === "CREDIT"
                            ? "Select Credit Customer Account *"
                            : "Select Member Account *"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>

              {/* COMPLETE PAYMENT BUTTON IN BOTTOM */}
              <TouchableOpacity
                style={[
                  styles.completePaymentBtn,
                  cartItems.length === 0 && styles.completePaymentBtnDisabled,
                ]}
                onPress={() => handleCompletePayment()}
                disabled={cartItems.length === 0 || isProcessingPayment}
                activeOpacity={0.88}
              >
                {isProcessingPayment ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons name="card-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                    <Text style={styles.completePaymentText}>Complete Payment</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
          )}

          {/* ================= COLUMN 2: CENTER → Category / Dish Groups / Favorites ================= */}
          {(!isMobile || mobileActiveTab === "groups") && (
          <View style={[styles.centerGroupsColumn, isMobile && styles.centerGroupsColumnMobile, isTablet && styles.centerGroupsColumnTablet]}>
            {/* DISH GROUPS HEADER */}
            <View style={styles.groupsHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons
                  name="restaurant-outline"
                  size={16}
                  color="#FF5A16"
                />
                <Text style={styles.groupsHeaderTitle}>
                  Dish Groups
                </Text>
              </View>
            </View>

            {/* SINGLE FAVORITES BUTTON ROW */}
            <View style={styles.favoritesButtonRow}>
              <TouchableOpacity
                style={[
                  styles.favoritesBigBtn,
                  leftPanelView === "favorites" && styles.favoritesBigBtnActive,
                ]}
                onPress={() => {
                  setLeftPanelView((prev) => (prev === "favorites" ? "dishgroup" : "favorites"));
                  if (isMobile) setMobileActiveTab("dishes");
                }}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.favoritesIconCircle,
                    leftPanelView === "favorites" && styles.favoritesIconCircleActive,
                  ]}
                >
                  <Ionicons
                    name="heart"
                    size={15}
                    color={leftPanelView === "favorites" ? "#FFFFFF" : "#E11D48"}
                  />
                </View>
                <Text
                  style={[
                    styles.favoritesBigBtnText,
                    leftPanelView === "favorites" && styles.favoritesBigBtnTextActive,
                  ]}
                >
                  Favorites
                </Text>
                {favoriteDishes.length > 0 && (
                  <View
                    style={[
                      styles.favoritesCountBadge,
                      leftPanelView === "favorites" && styles.favoritesCountBadgeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.favoritesCountBadgeText,
                        leftPanelView === "favorites" && styles.favoritesCountBadgeTextActive,
                      ]}
                    >
                      {favoriteDishes.length}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* DISH GROUPS VERTICAL LIST WITH UP/DOWN SCROLL BUTTONS */}
            <View style={styles.dishGroupPanelBody}>
              <ScrollView
                ref={dishGroupScrollRef}
                style={styles.dishGroupScroll}
                contentContainerStyle={styles.dishGroupScrollContent}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
                scrollEnabled={menuNavigationMode === "scroll"}
                onScroll={(e) => setDishGroupScrollOffset(e.nativeEvent.contentOffset.y)}
                scrollEventThrottle={16}
                onContentSizeChange={(_w, h) => setDishGroupContentHeight(h)}
                onLayout={(e) => setDishGroupContainerHeight(e.nativeEvent.layout.height)}
              >
                <View style={styles.dishGroupGrid}>
                  {displayedDishGroups.map((group) => {
                    const isGroupActive = leftPanelView === "dishgroup" && String(selectedDishGroupId) === String(group.DishGroupId);
                    const groupName = group.DishGroupName;
                    const count = getDishGroupCount(group);

                    return (
                      <TouchableOpacity
                        key={group.DishGroupId}
                        style={[
                          styles.dishGroupCard2Col,
                          isGroupActive && styles.dishGroupCard2ColActive,
                        ]}
                        onPress={() => {
                          setLeftPanelView("dishgroup");
                          setSelectedDishGroupId(group.DishGroupId);
                          selectDishGroup(group.DishGroupId);
                          if (isMobile) setMobileActiveTab("dishes");
                        }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[
                            styles.dishGroupName2Col,
                            isGroupActive && styles.dishGroupName2ColActive,
                          ]}
                          numberOfLines={2}
                        >
                          {groupName}
                        </Text>

                        <View
                          style={[
                            styles.dishGroupBadge2Col,
                            isGroupActive && styles.dishGroupBadge2ColActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dishGroupBadgeText2Col,
                              isGroupActive && styles.dishGroupBadgeText2ColActive,
                            ]}
                          >
                            {count}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              {/* SINGLE UNIFIED UP/DOWN SCROLL BUTTON PILL ON THE RIGHT (ONLY IN SCROLL MODE) */}
              {menuNavigationMode === "scroll" && (
                <View style={styles.dishGroupScrollPillContainer}>
                  <View style={styles.dishGroupScrollPill}>
                    <TouchableOpacity
                      style={[styles.singleScrollHalf, isDishGroupAtTop && styles.scrollBtnDisabled]}
                      onPress={() => scrollDishGroupsVertically("up")}
                      disabled={isDishGroupAtTop}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chevron-up" size={14} color={isDishGroupAtTop ? "#CBD5E1" : "#334155"} />
                    </TouchableOpacity>

                    <View style={styles.singleScrollDivider} />

                    <TouchableOpacity
                      style={[styles.singleScrollHalf, isDishGroupAtBottom && styles.scrollBtnDisabled]}
                      onPress={() => scrollDishGroupsVertically("down")}
                      disabled={isDishGroupAtBottom}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chevron-down" size={14} color={isDishGroupAtBottom ? "#CBD5E1" : "#334155"} />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* DISH GROUPS PAGINATION BAR (ONLY IN PREVIOUS / NEXT MODE) */}
            {menuNavigationMode === "prev_next" && displayedDishGroups.length > 0 && (
              <View style={styles.groupsPaginationBar}>
                <View style={styles.paginationLeft}>
                  <TouchableOpacity
                    style={[styles.paginationBtn, safeGroupPage <= 1 && styles.paginationBtnDisabled]}
                    onPress={() => {
                      if (safeGroupPage > 1) handleGroupPageChange(safeGroupPage - 1);
                    }}
                    disabled={safeGroupPage <= 1}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={14}
                      color={safeGroupPage <= 1 ? "#94A3B8" : "#FF5A16"}
                    />
                    <Text style={[styles.paginationBtnText, safeGroupPage <= 1 && styles.paginationBtnTextDisabled]}>
                      Previous
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.paginationCenter}>
                  <Text style={styles.paginationText}>
                    Page <Text style={styles.paginationCurrentText}>{safeGroupPage}</Text> of{" "}
                    <Text style={styles.paginationTotalText}>{totalGroupPages}</Text>
                  </Text>
                </View>

                <View style={styles.paginationRight}>
                  <TouchableOpacity
                    style={[styles.paginationBtn, safeGroupPage >= totalGroupPages && styles.paginationBtnDisabled]}
                    onPress={() => {
                      if (safeGroupPage < totalGroupPages) handleGroupPageChange(safeGroupPage + 1);
                    }}
                    disabled={safeGroupPage >= totalGroupPages}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.paginationBtnText, safeGroupPage >= totalGroupPages && styles.paginationBtnTextDisabled]}>
                      Next
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={safeGroupPage >= totalGroupPages ? "#94A3B8" : "#FF5A16"}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ================= COLUMN 3: RIGHT SIDE → DISHES ================= */}
        {(!isMobile || mobileActiveTab === "dishes") && (
        <View
          style={[styles.rightDishesColumn, isMobile && styles.rightDishesColumnMobile]}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - dishesPanelWidth) > 2) {
              setDishesPanelWidth(w);
            }
          }}
        >
            {/* DISHES PANEL HEADER & FILTERS */}
            <View style={styles.dishesHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name={leftPanelView === "favorites" ? "heart" : "restaurant"}
                  size={20}
                  color={leftPanelView === "favorites" ? "#E11D48" : "#FF5A16"}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.dishesHeaderTitle}>
                  {leftPanelView === "favorites"
                    ? "Favorite Dishes"
                    : (selectedDishGroupId !== null
                        ? `${groups.find((g) => String(g.DishGroupId) === String(selectedDishGroupId))?.DishGroupName || allDishGroups.find((g) => String(g.DishGroupId) === String(selectedDishGroupId))?.DishGroupName || "Dish Group"} Dishes`
                        : "Dishes")}
                </Text>
                {leftPanelView === "favorites" && (
                  <View style={[styles.categoryBadge, { backgroundColor: "#FFF1F2", borderWidth: 1, borderColor: "#FECDD3", marginLeft: 6 }]}>
                    <Text style={[styles.categoryBadgeText, { color: "#BE123C" }]}>
                      {favoriteDishes.length}
                    </Text>
                  </View>
                )}
              </View>

              {/* VIEW TOGGLES */}
              <View style={styles.viewToggleGroup}>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === "grid" && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode("grid")}
                >
                  <Ionicons name="grid" size={16} color={viewMode === "grid" ? "#FFFFFF" : "#64748B"} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.viewToggleBtn, viewMode === "list" && styles.viewToggleBtnActive]}
                  onPress={() => setViewMode("list")}
                >
                  <Ionicons name="list" size={16} color={viewMode === "list" ? "#FFFFFF" : "#64748B"} />
                </TouchableOpacity>
              </View>
            </View>

            {loading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="large" color="#FF5A16" />
                <Text style={styles.loadingStateText}>Loading Menu Dishes...</Text>
              </View>
            ) : leftPanelView !== "favorites" && selectedDishGroupId === null && searchQuery.trim() === "" ? (
              <View style={styles.emptyDishesState}>
                <Ionicons name="restaurant-outline" size={54} color="#CBD5E1" />
                <Text style={styles.emptyDishesTitle}>
                  Select a Dish Group to view dishes
                </Text>
                <Text style={styles.emptyDishesSub}>
                  Click on any group from the Dish Groups panel to browse items
                </Text>
              </View>
            ) : sortedDishes.length === 0 ? (
              <View style={styles.emptyDishesState}>
                <Ionicons
                  name={leftPanelView === "favorites" ? "heart-outline" : "fast-food-outline"}
                  size={54}
                  color={leftPanelView === "favorites" ? "#FECDD3" : "#CBD5E1"}
                />
                <Text style={styles.emptyDishesTitle}>
                  {leftPanelView === "favorites" ? "No favorite dishes found" : "No dishes found"}
                </Text>
                <Text style={styles.emptyDishesSub}>
                  {leftPanelView === "favorites"
                    ? (searchQuery.trim() ? "No favorite dishes match your search query" : "Dishes with isFavourite = 1 in DishMaster will appear here")
                    : "Try changing your filter or dish group"}
                </Text>
              </View>
            ) : viewMode === "grid" ? (
              <FlatList
                ref={dishesScrollRef as any}
                data={displayedDishes}
                keyExtractor={(dish, idx) => String(dish.DishId || idx)}
                numColumns={columns}
                key={`grid-${columns}`}
                scrollEnabled={menuNavigationMode === "scroll"}
                renderItem={({ item, index }) => {
                  const qtyInCart = cartQtyMap[String(item.DishId)] || 0;
                  return (
                    <QuickServeDishCard
                      dish={item}
                      idx={index}
                      width={cardWidth}
                      cartQty={qtyInCart}
                      onPress={handleDishClick}
                      isPhone={isPhoneDevice}
                      isTablet={isTabletDevice}
                      isLandscape={isLandscape}
                      currencySymbol={currencySymbol}
                    />
                  );
                }}
                columnWrapperStyle={columns > 1 ? { gap, marginBottom: 5 } : undefined}
                style={{ flex: 1 }}
                contentContainerStyle={styles.dishesGridContainer}
                showsVerticalScrollIndicator={menuNavigationMode === "scroll"}
                removeClippedSubviews={Platform.OS !== "web"}
                initialNumToRender={16}
                maxToRenderPerBatch={16}
              />
            ) : (
              <FlatList
                ref={dishesScrollRef as any}
                data={displayedDishes}
                keyExtractor={(dish, idx) => String(dish.DishId || idx)}
                key="list-1"
                scrollEnabled={menuNavigationMode === "scroll"}
                renderItem={({ item, index }) => {
                  const price = Number(item.Price || item.currentcost || 0);
                  const isSoldOut = Boolean(item.IsSoldOut);
                  const rawImg = item.Image || item.ImagePath || item.image;
                  const imgUri = getImageUrl(rawImg) || DEFAULT_DISH_IMAGES[index % DEFAULT_DISH_IMAGES.length];
                  const qtyInCart = cartQtyMap[String(item.DishId)] || 0;

                  return (
                    <TouchableOpacity
                      key={item.DishId || index}
                      style={[styles.dishListRow, isSoldOut && styles.dishCardSoldOut]}
                      onPress={() => handleDishClick(item)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.dishListThumbWrap}>
                        <Image source={{ uri: imgUri }} style={styles.dishListThumb} contentFit="cover" />
                      </View>

                      <View style={styles.dishListInfo}>
                        <Text style={styles.dishListName} numberOfLines={1}>
                          {item.Name}
                        </Text>
                      </View>

                      <Text style={styles.dishListPrice}>
                        {currencySymbol}{price.toFixed(2)}
                      </Text>

                      {qtyInCart > 0 ? (
                        <View style={styles.cartQtyBadgeRow}>
                          <Text style={styles.cartQtyBadgeRowText}>{qtyInCart} in cart</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.addPlusBtn, isSoldOut && styles.addPlusBtnDisabled]}
                          onPress={() => handleDishClick(item)}
                          disabled={isSoldOut}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="add" size={18} color="#FFFFFF" />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                }}
                contentContainerStyle={styles.dishesListContainer}
                showsVerticalScrollIndicator={menuNavigationMode === "scroll"}
              />
            )}

            {/* QUICK SERVE PAGINATION BAR (ONLY IN PREVIOUS / NEXT MODE) */}
            {menuNavigationMode === "prev_next" && sortedDishes.length > 0 && (
              <View style={styles.dishesPaginationBar}>
                <View style={styles.paginationLeft}>
                  <TouchableOpacity
                    style={[styles.paginationBtn, safeDishPage <= 1 && styles.paginationBtnDisabled]}
                    onPress={() => handlePageChange(safeDishPage - 1)}
                    disabled={safeDishPage <= 1}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="chevron-back" size={16} color={safeDishPage <= 1 ? "#94A3B8" : "#FF5A16"} />
                    <Text style={[styles.paginationBtnText, safeDishPage <= 1 && styles.paginationBtnTextDisabled]}>
                      Previous
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.paginationCenter}>
                  <Text style={styles.paginationText}>
                    Page <Text style={styles.paginationCurrentText}>{safeDishPage}</Text> of{" "}
                    <Text style={styles.paginationTotalText}>{totalDishPages}</Text>
                    {sortedDishes.length > 0 && (
                      <Text style={styles.paginationSubtext}>
                        {"  "}({Math.min(sortedDishes.length, (safeDishPage - 1) * DISHES_PER_PAGE + 1)}-
                        {Math.min(sortedDishes.length, safeDishPage * DISHES_PER_PAGE)} of {sortedDishes.length})
                      </Text>
                    )}
                  </Text>
                </View>

                <View style={styles.paginationRight}>
                  <TouchableOpacity
                    style={[styles.paginationBtn, safeDishPage >= totalDishPages && styles.paginationBtnDisabled]}
                    onPress={() => handlePageChange(safeDishPage + 1)}
                    disabled={safeDishPage >= totalDishPages}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.paginationBtnText, safeDishPage >= totalDishPages && styles.paginationBtnTextDisabled]}>
                      Next
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={safeDishPage >= totalDishPages ? "#94A3B8" : "#FF5A16"} />
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
          )}

        {/* MOBILE FLOATING CART BAR (Shown on 'dishes' and 'groups' tabs when cart has items) */}
        {isMobile && mobileActiveTab !== "order" && cartItems.length > 0 && (
          <TouchableOpacity
            style={styles.mobileFloatingCartBar}
            onPress={() => setMobileActiveTab("order")}
            activeOpacity={0.9}
          >
            <View style={styles.mobileFloatingCartLeft}>
              <View style={styles.mobileFloatingCartBadge}>
                <Text style={styles.mobileFloatingCartBadgeText}>
                  {cartItems.reduce((acc, it) => acc + (it.qty || 1), 0)}
                </Text>
              </View>
              <View>
                <Text style={styles.mobileFloatingCartTitle}>View Current Order</Text>
                <Text style={styles.mobileFloatingCartSub}>
                  {cartItems.length} item{cartItems.length > 1 ? "s" : ""}
                </Text>
              </View>
            </View>

            <View style={styles.mobileFloatingCartRight}>
              <Text style={styles.mobileFloatingCartTotal}>${finalTotal.toFixed(2)}</Text>
              <Ionicons name="arrow-forward-circle" size={24} color="#FFFFFF" style={{ marginLeft: 6 }} />
            </View>
          </TouchableOpacity>
        )}
        </View>
      ) : (
        /* NORMAL POS TABLE VIEW */
        <View style={styles.normalPosContainer}>
          <View style={styles.normalPosHeaderBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, alignItems: "center" }}>
              {["Section 1", "Section 2", "Section 3", "Takeaway"].map((sec, idx) => {
                const isActive = selectedSection === sec;
                const count = idx === 0 ? 2 : idx === 1 ? 1 : idx === 3 ? 1 : 0;
                return (
                  <TouchableOpacity
                    key={sec}
                    style={[styles.sectionTabPill, isActive && styles.sectionTabPillActive]}
                    onPress={() => setSelectedSection(sec)}
                  >
                    <Text style={[styles.sectionTabText, isActive && styles.sectionTabTextActive]}>
                      {sec}
                    </Text>
                    {count > 0 && (
                      <View style={[styles.sectionCountTag, isActive ? { backgroundColor: "rgba(255,255,255,0.25)" } : { backgroundColor: "#CBD5E1" }]}>
                        <Text style={[styles.sectionCountText, isActive && { color: "#FFFFFF" }]}>{count}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {loadingTables ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator size="large" color="#FF5A16" />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
              <View style={styles.normalTableGrid}>
                {getTablesForSection(selectedSection, tablesList).map((table: any) => (
                  <TouchableOpacity
                    key={table.id || table.TableId || table.name || table.TableNo}
                    style={styles.normalTableCard}
                    onPress={() => {
                      useOrderContextStore.getState().setOrderContext({
                        orderType: selectedSection === "Takeaway" ? "TAKEAWAY" : "DINE_IN",
                        tableId: String(table.TableId || table.id || ""),
                        tableNo: String(table.TableName || table.name || table.TableNo || ""),
                        section: selectedSection,
                      });
                      router.replace("/menu/thai_kitchen");
                    }}
                  >
                    <Text style={styles.tableNoTextBig}>{table.TableName || table.name || table.TableNo}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          <TouchableOpacity style={styles.normalPosFabBtn} onPress={() => toggleQuickServeMode(true)}>
            <Ionicons name="sparkles" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* TABLE MASTER SELECTION MODAL */}
      <Modal
        visible={tableModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setIsTableSearchOpen(false);
          setTableSearchQuery("");
          setTableModalVisible(false);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setIsTableSearchOpen(false);
            setTableSearchQuery("");
            setTableModalVisible(false);
          }}
        >
          <TouchableOpacity activeOpacity={1} style={styles.tableModalContent}>
            {isTableSearchOpen ? (
              <View style={styles.tableHeaderSearchContainer}>
                <Ionicons name="search" size={16} color="#FF5A16" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.tableHeaderSearchInput}
                  placeholder="Search table # or name..."
                  placeholderTextColor="#94A3B8"
                  value={tableSearchQuery}
                  onChangeText={setTableSearchQuery}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                {tableSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setTableSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.tableSearchHeaderCloseBtn}
                  onPress={() => {
                    setIsTableSearchOpen(false);
                    setTableSearchQuery("");
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={20} color="#64748B" />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.tableModalHeader}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Ionicons name="restaurant-outline" size={20} color="#FF5A16" style={{ marginRight: 8 }} />
                  <Text style={styles.tableModalTitle}>Select Table (Table Master)</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TouchableOpacity
                    style={styles.tableSearchSmallBtn}
                    onPress={() => setIsTableSearchOpen(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="search" size={15} color="#475569" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setIsTableSearchOpen(false);
                      setTableSearchQuery("");
                      setTableModalVisible(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={22} color="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.tableModalTabs}>
              <TouchableOpacity
                style={[styles.tableModalTab, tableFilterTab === "free" && styles.tableModalTabActive]}
                onPress={() => setTableFilterTab("free")}
              >
                <Text style={[styles.tableModalTabText, tableFilterTab === "free" && styles.tableModalTabTextActive]}>
                  Free Tables ({allMasterTables.filter((t: any) => t.Status === 0 || !t.Status || String(t.Status) === "0").length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tableModalTab, tableFilterTab === "all" && styles.tableModalTabActive]}
                onPress={() => setTableFilterTab("all")}
              >
                <Text style={[styles.tableModalTabText, tableFilterTab === "all" && styles.tableModalTabTextActive]}>
                  All Tables ({allMasterTables.length})
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360, marginVertical: 10 }} showsVerticalScrollIndicator={false}>
              {filteredMasterTables.length === 0 ? (
                <View style={styles.tableSearchEmptyState}>
                  <Ionicons name="search-outline" size={36} color="#CBD5E1" style={{ marginBottom: 8 }} />
                  <Text style={styles.tableSearchEmptyText}>
                    No tables found matching "{tableSearchQuery}"
                  </Text>
                  <TouchableOpacity
                    style={styles.tableSearchClearBtn}
                    onPress={() => {
                      setIsTableSearchOpen(false);
                      setTableSearchQuery("");
                    }}
                  >
                    <Text style={styles.tableSearchClearText}>Clear Search</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.tablePickerGrid}>
                  {filteredMasterTables.map((t: any) => {
                    const isFree = t.Status === 0 || t.Status === null || t.Status === undefined || String(t.Status) === "0";
                    const isSelected = selectedTable && String(selectedTable.id || selectedTable.TableId) === String(t.id || t.TableId);
                    const tableNum = String(t.label || t.TableNumber || t.id || "1").replace(/[^0-9]/g, "") || "1";
                    const rawName = String(t.label || t.TableNumber || `Table ${t.id}`);
                    const tableName = rawName.toLowerCase().startsWith("table") ? rawName : `Table ${rawName}`;

                    return (
                      <TouchableOpacity
                        key={t.id || t.TableId || tableName}
                        style={[
                          styles.tablePickerCard,
                          isSelected && styles.tablePickerCardSelected,
                          !isFree && styles.tablePickerCardOccupied,
                        ]}
                        onPress={async () => {
                          await selectQuickServeTable(t, true);
                          setIsTableSearchOpen(false);
                          setTableSearchQuery("");
                          setTableModalVisible(false);
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.tablePickerNumBadge, isSelected && { backgroundColor: "#FF5A16" }]}>
                          <Text style={[styles.tablePickerNumText, isSelected && { color: "#FFFFFF" }]}>{tableNum}</Text>
                        </View>
                        <Text style={[styles.tablePickerName, isSelected && { color: "#FF5A16" }]} numberOfLines={1}>
                          {tableName}
                        </Text>
                        <View style={[styles.tableStatusTag, isFree ? { backgroundColor: "#ECFDF5" } : { backgroundColor: "#FEF2F2" }]}>
                          <Text style={[styles.tableStatusText, isFree ? { color: "#10B981" } : { color: "#EF4444" }]}>
                            {isFree ? "FREE" : "BUSY"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>

            <View style={styles.tableModalFooter}>
              <TouchableOpacity
                style={styles.autoSelectFreeBtn}
                onPress={async () => {
                  await fetchMasterTablesAndAutoSelectFree();
                  setIsTableSearchOpen(false);
                  setTableSearchQuery("");
                  setTableModalVisible(false);
                }}
              >
                <Ionicons name="sparkles-outline" size={16} color="#FF5A16" style={{ marginRight: 6 }} />
                <Text style={styles.autoSelectFreeText}>Auto Select First Free Table</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* DISCOUNT MODAL */}
      <Modal visible={discountModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Apply Discount (%)</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="numeric"
              placeholder="Enter discount percentage (e.g. 10)"
              value={tempDiscount}
              onChangeText={setTempDiscount}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setDiscountModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => {
                  const val = parseFloat(tempDiscount) || 0;
                  const finalVal = Math.min(100, Math.max(0, val));
                  setDiscountPercent(finalVal);
                  setDiscountModalVisible(false);
                  if (finalVal > 0) {
                    toast.showToast({ message: `🎉 Discount Applied: ${finalVal}%`, type: "success" });
                  }
                }}
              >
                <Text style={styles.modalSaveText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* STORE SETTINGS MODAL */}
      <StoreSettingsModal
        visible={storeSettingsVisible}
        onClose={() => setStoreSettingsVisible(false)}
      />

      {/* PAYNOW QR MODAL */}
      <PayNowPaymentModal
        visible={showPayNowModal}
        amount={finalTotal}
        onSuccess={() => {
          setShowPayNowModal(false);
          handleCompletePayment(true);
        }}
        onFailed={() => {
          setShowPayNowModal(false);
        }}
        onClose={() => setShowPayNowModal(false)}
      />

      {/* MODIFIER MODAL */}
      {showModifier && selectedDish && (
        <Modal
          transparent
          visible={showModifier}
          animationType="fade"
          onRequestClose={() => setShowModifier(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowModifier(false)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.modifierModalContent}>
              <View style={styles.modifierModalHeader}>
                <Text style={styles.modifierModalTitle} numberOfLines={2}>
                  Modifiers: {selectedDish.Name}
                </Text>
                <TouchableOpacity onPress={() => setShowModifier(false)}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <View style={styles.modifierModalBody}>
                {loadingModifiers ? (
                  <ActivityIndicator color="#FF5A16" size="large" />
                ) : (
                  <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                    {groupedModifiers.map((group: any) => {
                      const gId = group.groupId;
                      const gName = group.groupName;
                      const maxSelect = group.maxSelect;
                      const minSelect = group.minSelect;
                      const multiselect = group.multiselect;
                      const groupSelectedCount = Object.entries(selectedModifierQuantities)
                        .filter(([k]) => k.endsWith(`_${gId}`))
                        .reduce((sum, [, q]) => sum + q, 0);

                      return (
                        <View key={gId} style={styles.modifierGroupContainer}>
                          <View style={styles.modifierGroupHeader}>
                            <Text style={styles.modifierGroupName}>{gName}</Text>
                            <Text style={styles.modifierGroupLimits}>
                              {`Selected: ${groupSelectedCount}`}
                            </Text>
                          </View>

                          <View style={styles.modifierGrid}>
                            {group.items.map((m: any) => {
                              const key = `${m.ModifierID}_${gId}`;
                              const qty = selectedModifierQuantities[key] || 0;
                              const isSelected = qty > 0;
                              const isDisabled = maxSelect > 0 && groupSelectedCount >= maxSelect && qty === 0;
                              const isOpenMod =
                                Number(m.isOpenModifier) === 1 ||
                                m.isOpenModifier === true ||
                                String(m.isOpenModifier) === "1" ||
                                String(m.isOpenModifier) === "true";

                              return (
                                <TouchableOpacity
                                  key={m.ModifierID}
                                  style={[
                                    styles.modifierCard,
                                    isSelected && styles.modifierCardSelected,
                                    isDisabled && { opacity: 0.5 }
                                  ]}
                                  onPress={() => {
                                    if (isOpenMod) {
                                      if (isSelected) {
                                        // Tap again to deselect
                                        setSelectedModifierQuantities((prev) => {
                                          const next = { ...prev };
                                          delete next[key];
                                          return next;
                                        });
                                      } else {
                                        // Open Custom Item Sub-modal (Image 2)
                                        setActiveOpenMod(m);
                                        setCustomModName(
                                          m.ModifierName &&
                                          m.ModifierName.toLowerCase() !== "open modifier" &&
                                          m.ModifierName.toLowerCase() !== "custom" &&
                                          m.ModifierName.toLowerCase() !== "custom modifier"
                                            ? m.ModifierName
                                            : ""
                                        );
                                        setCustomModPrice(Number(m.Price) > 0 ? String(m.Price) : "");
                                        setShowCustomModModal(true);
                                      }
                                      return;
                                    }

                                    if (isSelected || !isDisabled) {
                                      if (multiselect) {
                                        adjustModifierQuantity(m, gId, isSelected ? -1 : 1);
                                      } else {
                                        toggleModifier(m);
                                      }
                                    }
                                  }}
                                  disabled={isDisabled}
                                >
                                  <Text style={[styles.modifierCardName, isSelected && styles.modifierCardTextSelected]}>
                                    {m.ModifierName}
                                  </Text>
                                  {Number(m.Price) > 0 && (
                                    <Text style={[styles.modifierCardPrice, isSelected && styles.modifierCardTextSelected]}>
                                      +${Number(m.Price).toFixed(2)}
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              <View style={styles.modifierModalFooter}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={() => {
                  setShowModifier(false);
                  setCustomMods([]);
                  setSelectedModifierQuantities({});
                  setShowCustomModModal(false);
                  setActiveOpenMod(null);
                }}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalSaveBtn, { flexDirection: "row", alignItems: "center" }]} onPress={addWithModifiers}>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginRight: 4 }} />
                  <Text style={styles.modalSaveText}>Done</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>

            {/* ADD CUSTOM ITEM SUB-MODAL (Image 2 Style) */}
            {showCustomModModal && (
              <View
                style={[
                  styles.modalOverlay,
                  {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 9999,
                    backgroundColor: "rgba(0,0,0,0.7)",
                    justifyContent: "center",
                    alignItems: "center",
                  },
                ]}
              >
                <TouchableOpacity activeOpacity={1} style={styles.customItemModal}>
                  <Text style={styles.customModalTitle}>Add Custom Item</Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Item Name *</Text>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter item name"
                      placeholderTextColor="#94A3B8"
                      value={customModName}
                      onChangeText={setCustomModName}
                      autoFocus
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Price (Optional)</Text>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter price"
                      placeholderTextColor="#94A3B8"
                      keyboardType="numeric"
                      value={customModPrice}
                      onChangeText={setCustomModPrice}
                    />
                  </View>

                  <View style={styles.customModalActions}>
                    <TouchableOpacity
                      style={styles.customBtnCancel}
                      onPress={handleCancelCustomMod}
                    >
                      <Text style={styles.customBtnTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.customBtnAdd}
                      onPress={handleConfirmCustomMod}
                    >
                      <Text style={styles.customBtnTextAdd}>Add Item</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        </Modal>
      )}

      {/* COMBO CUSTOMIZER */}
      <ComboCustomizer
        visible={showComboModal}
        onClose={() => {
          setShowComboModal(false);
          setComboDish(null);
        }}
        onSuccess={() => {
          if (searchQuery) setSearchQuery("");
        }}
        dish={comboDish}
        kitchenName={comboDish?.KitchenTypeName || categories.find((k) => k.CategoryId === selectedCategoryId)?.KitchenTypeName || "KITCHEN"}
        kitchenCode={comboDish?.KitchenTypeCode || categories.find((k) => k.CategoryId === selectedCategoryId)?.KitchenTypeCode || String(selectedCategoryId || "0")}
      />

      {/* OPEN ITEM PRICE MODAL */}
      <Modal
        transparent
        visible={showOpenItemModal}
        animationType="fade"
        onRequestClose={() => setShowOpenItemModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowOpenItemModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.openItemModalContent}>
            <View style={styles.modifierModalHeader}>
              <Text style={styles.modifierModalTitle}>Enter Price</Text>
              <TouchableOpacity onPress={() => setShowOpenItemModal(false)}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 14, fontFamily: Fonts.medium, color: "#475569", marginBottom: 14 }}>
              {openItemDish?.Name}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder={openItemDish?.Price > 0 ? `Default: $${openItemDish.Price}` : "Enter custom price"}
              placeholderTextColor="#94A3B8"
              keyboardType="decimal-pad"
              value={openItemPrice}
              onChangeText={(t) => {
                setOpenItemPrice(t);
                setOpenItemError("");
              }}
              autoFocus
            />

            {openItemError ? (
              <Text style={{ color: "#EF4444", fontSize: 12, fontFamily: Fonts.medium, marginBottom: 10 }}>
                {openItemError}
              </Text>
            ) : null}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowOpenItemModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={confirmOpenItemPrice}>
                <Text style={styles.modalSaveText}>Add to Cart</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* DISCOUNT TYPE SELECTION MODAL */}
      <Modal
        visible={showDiscountTypeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDiscountTypeModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDiscountTypeModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              backgroundColor: "#FFFFFF",
              padding: 24,
              borderRadius: 20,
              width: "90%",
              maxWidth: 420,
              alignItems: "stretch",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ backgroundColor: "#FFF7ED", padding: 8, borderRadius: 10 }}>
                  <Ionicons name="pricetags" size={20} color="#FF5A16" />
                </View>
                <Text style={{ fontFamily: Fonts.bold, fontSize: 18, color: "#0F172A" }}>
                  Select Discount Type
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowDiscountTypeModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 12 }}>
              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: "#F8FAFC",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#E2E8F0",
                  gap: 12,
                }}
                activeOpacity={0.7}
                onPress={() => {
                  setShowDiscountTypeModal(false);
                  setShowDiscount(true);
                }}
              >
                <View style={{ backgroundColor: "#EFF6FF", padding: 10, borderRadius: 10 }}>
                  <Ionicons name="receipt-outline" size={22} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: "#0F172A" }}>
                    Order Discount (Whole Bill)
                  </Text>
                  <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: "#64748B", marginTop: 2 }}>
                    Apply discount to the entire bill
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: "#F8FAFC",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#E2E8F0",
                  gap: 12,
                }}
                activeOpacity={0.7}
                onPress={() => {
                  setShowDiscountTypeModal(false);
                  setShowItemDiscount(true);
                }}
              >
                <View style={{ backgroundColor: "#FDF2F8", padding: 10, borderRadius: 10 }}>
                  <Ionicons name="pricetag-outline" size={22} color="#EC4899" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: "#0F172A" }}>
                    Item Wise Discount
                  </Text>
                  <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: "#64748B", marginTop: 2 }}>
                    Apply discount to specific menu items
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <DiscountModal
        visible={showDiscount}
        onClose={() => setShowDiscount(false)}
        currentTotal={subtotal}
      />

      <ItemDiscountModal
        visible={showItemDiscount}
        onClose={() => setShowItemDiscount(false)}
      />

      {/* PROMO CODE MODAL */}
      <Modal
        visible={showPromoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPromoModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowPromoModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, width: "90%", maxWidth: 420 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontFamily: Fonts.bold, color: "#0F172A" }}>Promo Codes</Text>
              <TouchableOpacity onPress={() => setShowPromoModal(false)}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, fontFamily: Fonts.medium, color: "#64748B", marginBottom: 16 }}>
              Enter or select a promo code to apply to the order.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Enter promo code..."
              placeholderTextColor="#94A3B8"
              value={promoCodeInput}
              onChangeText={setPromoCodeInput}
              autoCapitalize="characters"
            />

            <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalCancelBtn, { flex: 1 }]}
                onPress={() => {
                  setShowPromoModal(false);
                  setPromoCodeInput("");
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSaveBtn, { flex: 1 }, (!promoCodeInput.trim() || isApplyingPromo) && { opacity: 0.6 }]}
                onPress={() => handlePromoCode(promoCodeInput)}
                disabled={!promoCodeInput.trim() || isApplyingPromo}
              >
                {isApplyingPromo ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalSaveText}>Apply Code</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* REWARD POINTS MEMBER LOOKUP MODAL */}
      <Modal
        visible={showRewardModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRewardModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowRewardModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, width: "90%", maxWidth: 440 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontFamily: Fonts.bold, color: "#0F172A" }}>Reward Member Lookup</Text>
              <TouchableOpacity onPress={() => setShowRewardModal(false)}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, fontFamily: Fonts.medium, color: "#64748B", marginBottom: 16 }}>
              Search member by phone or name to view and redeem reward points.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Enter phone or customer name..."
              placeholderTextColor="#94A3B8"
              value={rewardSearchText}
              onChangeText={handleRewardSearch}
            />

            {isSearchingRewards ? (
              <ActivityIndicator color="#FF5A16" size="small" style={{ marginVertical: 16 }} />
            ) : (
              <ScrollView style={{ maxHeight: 200, marginVertical: 12 }}>
                {rewardSearchResults.length === 0 ? (
                  <Text style={{ textAlign: "center", color: "#94A3B8", marginVertical: 12, fontSize: 13 }}>
                    {rewardSearchText ? "No matching members found" : "Type to search members"}
                  </Text>
                ) : (
                  rewardSearchResults.map((item: any) => (
                    <TouchableOpacity
                      key={item.MemberId}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: "#F8FAFC",
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: "#E2E8F0",
                      }}
                      onPress={() => {
                        setRewardMember(item);
                        setShowRewardModal(false);
                      }}
                    >
                      <View>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: "#0F172A" }}>{item.Name}</Text>
                        <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>Phone: {item.Phone}</Text>
                      </View>
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: "#D97706" }}>
                        ${(parseFloat(item.RewardCredit) || 0).toFixed(2)} Rewards
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.modalCancelBtn, { marginTop: 8 }]}
              onPress={() => setShowRewardModal(false)}
            >
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* LOYALTY MEMBER MODAL */}
      <Modal
        visible={showLoyaltyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLoyaltyModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowLoyaltyModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, width: "90%", maxWidth: 440 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 18, fontFamily: Fonts.bold, color: "#0F172A" }}>Walk-in Loyalty</Text>
              <TouchableOpacity onPress={() => setShowLoyaltyModal(false)}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 13, fontFamily: Fonts.medium, color: "#64748B", marginBottom: 16 }}>
              Search loyalty customer by phone or name.
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Search phone or name..."
              placeholderTextColor="#94A3B8"
              value={loyaltySearchText}
              onChangeText={handleLoyaltySearch}
            />

            {isSearchingLoyalty ? (
              <ActivityIndicator color="#10B981" size="small" style={{ marginVertical: 16 }} />
            ) : (
              <ScrollView style={{ maxHeight: 200, marginVertical: 12 }}>
                {loyaltySearchResults.length === 0 ? (
                  <Text style={{ textAlign: "center", color: "#94A3B8", marginVertical: 12, fontSize: 13 }}>
                    {loyaltySearchText ? "No loyalty members found" : "Type to search loyalty members"}
                  </Text>
                ) : (
                  loyaltySearchResults.map((item: any) => (
                    <TouchableOpacity
                      key={item.MemberId}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: "#ECFDF5",
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: "#A7F3D0",
                      }}
                      onPress={() => {
                        setLoyaltyCustomer(item);
                        setShowLoyaltyModal(false);
                      }}
                    >
                      <View>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: "#0F172A" }}>{item.Name}</Text>
                        <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>Phone: {item.Phone}</Text>
                      </View>
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: "#10B981" }}>
                        {item.VisitCount || 0} Visits
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={[styles.modalCancelBtn, { marginTop: 8 }]}
              onPress={() => setShowLoyaltyModal(false)}
            >
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* MEMBER & CREDIT CUSTOMER SELECTION / QUICK ADD MODAL */}
      <Modal
        visible={showMemberModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMemberModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMemberModal(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.memberModalCard, { width: "92%", maxWidth: 460, maxHeight: "85%" }]}
          >
            {/* Header */}
            <View style={styles.memberModalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.memberModalHeaderIcon, { backgroundColor: memberModalType === "CREDIT" ? "#EEF2FF" : "#FEF3C7" }]}>
                  <Ionicons
                    name={memberModalType === "CREDIT" ? "wallet" : "ribbon"}
                    size={20}
                    color={memberModalType === "CREDIT" ? "#4F46E5" : "#D97706"}
                  />
                </View>
                <View>
                  <Text style={styles.memberModalTitle}>
                    {isQuickAddMode
                      ? memberModalType === "CREDIT"
                        ? "Quick Add Credit Customer"
                        : "Quick Add Member"
                      : memberModalType === "CREDIT"
                      ? "Select Credit Customer"
                      : "Select Member"}
                  </Text>
                  <Text style={styles.memberModalSubtitle}>
                    {memberModalType === "CREDIT"
                      ? "Charge order balance to customer credit ledger"
                      : "Select or add membership account"}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowMemberModal(false)} style={styles.memberModalCloseBtn}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {isQuickAddMode ? (
              /* QUICK ADD FORM */
              <ScrollView showsVerticalScrollIndicator={false} style={{ marginVertical: 10 }}>
                <View style={styles.quickAddFormField}>
                  <Text style={styles.quickAddLabel}>Customer Name *</Text>
                  <TextInput
                    style={styles.quickAddInput}
                    placeholder="Enter full name"
                    placeholderTextColor="#94A3B8"
                    value={newName}
                    onChangeText={setNewName}
                  />
                </View>

                <View style={styles.quickAddFormField}>
                  <Text style={styles.quickAddLabel}>Phone Number *</Text>
                  <TextInput
                    style={styles.quickAddInput}
                    placeholder="e.g. +65 91234567"
                    placeholderTextColor="#94A3B8"
                    value={newPhone}
                    onChangeText={setNewPhone}
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.quickAddFormField}>
                  <Text style={styles.quickAddLabel}>Email Address (Optional)</Text>
                  <TextInput
                    style={styles.quickAddInput}
                    placeholder="Enter email address"
                    placeholderTextColor="#94A3B8"
                    value={newEmail}
                    onChangeText={setNewEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.quickAddFormField}>
                  <Text style={styles.quickAddLabel}>Address (Optional)</Text>
                  <TextInput
                    style={styles.quickAddInput}
                    placeholder="Enter delivery/billing address"
                    placeholderTextColor="#94A3B8"
                    value={newAddress}
                    onChangeText={setNewAddress}
                  />
                </View>

                <View style={styles.quickAddFormField}>
                  <Text style={styles.quickAddLabel}>Credit Limit ($)</Text>
                  <TextInput
                    style={styles.quickAddInput}
                    placeholder="1000"
                    placeholderTextColor="#94A3B8"
                    value={newCreditLimit}
                    onChangeText={setNewCreditLimit}
                    keyboardType="numeric"
                  />
                </View>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                  <TouchableOpacity
                    style={[styles.modalCancelBtn, { flex: 1 }]}
                    onPress={() => setIsQuickAddMode(false)}
                  >
                    <Text style={styles.modalCancelText}>Back to Search</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalSaveBtn, { flex: 1 }, (!newName.trim() || !newPhone.trim() || addingCustomer) && { opacity: 0.6 }]}
                    onPress={handleQuickAddCustomer}
                    disabled={!newName.trim() || !newPhone.trim() || addingCustomer}
                  >
                    {addingCustomer ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.modalSaveText}>Save & Select</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              /* SEARCH & SELECT MODE */
              <View style={{ flex: 1, minHeight: 280 }}>
                {/* Search Bar + Quick Add Button */}
                <View style={{ flexDirection: "row", gap: 8, marginVertical: 10 }}>
                  <View style={styles.memberSearchBar}>
                    <Ionicons name="search" size={18} color="#64748B" style={{ marginRight: 6 }} />
                    <TextInput
                      style={styles.memberSearchInput}
                      placeholder="Search by Name or Phone..."
                      placeholderTextColor="#94A3B8"
                      value={memberQuery}
                      onChangeText={setMemberQuery}
                      autoFocus
                    />
                    {searchingMembers && <ActivityIndicator size="small" color="#FF5A16" />}
                  </View>

                  <TouchableOpacity
                    style={styles.quickAddToggleBtn}
                    onPress={() => {
                      setIsQuickAddMode(true);
                      if (memberQuery && isNaN(Number(memberQuery))) {
                        setNewName(memberQuery);
                      } else if (memberQuery) {
                        setNewPhone(memberQuery);
                      }
                    }}
                  >
                    <Ionicons name="person-add" size={15} color="#FFFFFF" />
                    <Text style={styles.quickAddToggleBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {/* Customer / Members List */}
                <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                  {membersList.length === 0 ? (
                    <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 36 }}>
                      <Ionicons
                        name={memberModalType === "CREDIT" ? "wallet-outline" : "ribbon-outline"}
                        size={40}
                        color="#CBD5E1"
                        style={{ marginBottom: 8 }}
                      />
                      <Text style={{ fontFamily: Fonts.medium, fontSize: 14, color: "#64748B" }}>
                        {memberQuery ? "No matching accounts found" : "Type above to search or click Add"}
                      </Text>
                    </View>
                  ) : (
                    membersList.map((item: any, idx: number) => {
                      const isSelected = selectedMember?.MemberId === item.MemberId;
                      const availCredit =
                        item.AvailableCredit !== undefined
                          ? Number(item.AvailableCredit)
                          : Number(item.CreditLimit || 0) - Number(item.CurrentBalance || 0);

                      return (
                        <TouchableOpacity
                          key={item.MemberId || idx}
                          style={[
                            styles.memberListItemCard,
                            isSelected && styles.memberListItemCardSelected,
                            !item.IsActive && { opacity: 0.5 },
                          ]}
                          onPress={() => {
                            setSelectedMember(item);
                            setShowMemberModal(false);
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={styles.memberListItemName}>{item.Name}</Text>
                              {item.IsActive === false && (
                                <Text style={styles.inactivePillText}>(Inactive)</Text>
                              )}
                            </View>
                            <Text style={styles.memberListItemPhone}>Phone: {item.Phone}</Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={styles.memberListItemAvailLabel}>Avail Credit</Text>
                            <Text style={[styles.memberListItemAvailVal, availCredit < 0 && { color: "#EF4444" }]}>
                              ${availCredit.toFixed(2)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.modalCancelBtn, { marginTop: 10 }]}
                  onPress={() => setShowMemberModal(false)}
                >
                  <Text style={styles.modalCancelText}>Close</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* YEAHPAY TERMINAL PROCESSING MODAL */}
      <Modal
        visible={terminalModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (terminalStatus !== "processing") setTerminalModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.terminalModalCard, { width: "90%", maxWidth: 420 }]}>
            <View style={styles.terminalIconWrap}>
              {terminalStatus === "processing" ? (
                <ActivityIndicator size="large" color="#059669" />
              ) : terminalStatus === "success" ? (
                <Ionicons name="checkmark-circle" size={54} color="#10B981" />
              ) : terminalStatus === "cancelled" ? (
                <Ionicons name="close-circle" size={54} color="#F59E0B" />
              ) : (
                <Ionicons name="alert-circle" size={54} color="#EF4444" />
              )}
            </View>

            <Text style={styles.terminalTitle}>
              {terminalStatus === "processing"
                ? "Waiting for Terminal Payment"
                : terminalStatus === "success"
                ? "Payment Approved!"
                : terminalStatus === "cancelled"
                ? "Payment Cancelled"
                : "Payment Declined"}
            </Text>

            <Text style={styles.terminalSubtitle}>
              {terminalMessage}
            </Text>

            <View style={styles.terminalAmountBox}>
              <Text style={styles.terminalAmountLabel}>Payable Total</Text>
              <Text style={styles.terminalAmountValue}>${finalTotal.toFixed(2)}</Text>
            </View>

            {terminalStatus === "processing" ? (
              <TouchableOpacity
                style={styles.terminalCancelBtn}
                onPress={() => {
                  setTerminalModalVisible(false);
                  setTerminalStatus("idle");
                }}
              >
                <Text style={styles.terminalCancelBtnText}>Dismiss / Cancel</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.modalSaveBtn, { width: "100%", marginTop: 12 }]}
                onPress={() => setTerminalModalVisible(false)}
              >
                <Text style={styles.modalSaveText}>Close</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* CASH RECEIVED SCREEN MODAL */}
      <Modal
        visible={showCashModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isProcessingPayment) setShowCashModal(false);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            if (!isProcessingPayment) setShowCashModal(false);
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.cashModalContainer}
            onPress={(e) => e.stopPropagation()}
          >
            {/* MODAL HEADER */}
            <View style={styles.cashModalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={styles.cashModalHeaderIcon}>
                  <Ionicons name="cash" size={20} color="#FF5A16" />
                </View>
                <Text style={styles.cashModalTitle}>CASH RECEIVED</Text>
              </View>
              <TouchableOpacity
                style={styles.cashModalCloseBtn}
                onPress={() => setShowCashModal(false)}
                disabled={isProcessingPayment}
              >
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* CASH SECTION (2 COLUMNS: LEFT = AMOUNTS + QUICK CASH, RIGHT = NUMERIC KEYPAD) */}
            <View style={styles.cashSectionBody}>
              {(() => {
                const enteredCashNum = parseFloat(cashReceivedInput) || 0;
                const changeAmount = Math.max(0, enteredCashNum - finalTotal);
                const isInsufficient = enteredCashNum < finalTotal || isNaN(enteredCashNum);

                return (
                  <>
                    <View style={styles.cashAndKeypadRow}>
                      {/* Left Column: Cash Received + Change + Quick Cash */}
                      <View style={styles.cashLeftCol}>
                        {/* Side-by-side: Cash Received Input (Left) & Change to Return (Right) */}
                        <View style={styles.cashAmountsRow}>
                          <View style={styles.cashInputBox}>
                            <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                            <TextInput
                              ref={cashInputRef}
                              style={styles.cashInput}
                              value={cashReceivedInput}
                              onChangeText={(text) => {
                                const sanitized = text.replace(/[^0-9.]/g, "");
                                const parts = sanitized.split(".");
                                let clean = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : sanitized;
                                if (clean.includes(".")) {
                                  const [integerPart, decimalPart] = clean.split(".");
                                  clean = integerPart + "." + decimalPart.slice(0, 2);
                                }
                                setCashReceivedInput(clean);
                              }}
                              keyboardType="numeric"
                              placeholder="0.00"
                              {...Platform.select({
                                web: { outlineStyle: "none" } as any,
                              })}
                            />
                          </View>

                          <View style={styles.changeBox}>
                            <Text style={styles.changeLabel}>CHANGE TO RETURN</Text>
                            <Text style={styles.changeValue}>
                              {currencySymbol}
                              {changeAmount.toFixed(2)}
                            </Text>
                          </View>
                        </View>

                        {/* Quick Cash Buttons in 2 Rows (4 buttons per row) */}
                        <View style={styles.quickCashGrid}>
                          {/* Row 1: First 4 Quick Cash amounts ($20, $50, $100, $200) */}
                          <View style={styles.quickCashRow}>
                            {quickCashAmounts.slice(0, 4).map((v) => {
                              const isSelected = parseFloat(cashReceivedInput) === v;
                              return (
                                <TouchableOpacity
                                  key={v}
                                  style={[
                                    styles.quickCashGridBtn,
                                    isSelected && styles.activeQuickCashBtn,
                                  ]}
                                  onPress={() => {
                                    setCashReceivedInput(v.toString());
                                    if (cashInputRef.current) cashInputRef.current.focus();
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text
                                    style={[
                                      styles.quickCashText,
                                      isSelected && styles.activeQuickCashText,
                                    ]}
                                  >
                                    {currencySymbol}
                                    {v}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          {/* Row 2: Next 2 Quick Cash amounts ($500, $1000) + Exact + Clear */}
                          <View style={styles.quickCashRow}>
                            {quickCashAmounts.slice(4, 6).map((v) => {
                              const isSelected = parseFloat(cashReceivedInput) === v;
                              return (
                                <TouchableOpacity
                                  key={v}
                                  style={[
                                    styles.quickCashGridBtn,
                                    isSelected && styles.activeQuickCashBtn,
                                  ]}
                                  onPress={() => {
                                    setCashReceivedInput(v.toString());
                                    if (cashInputRef.current) cashInputRef.current.focus();
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text
                                    style={[
                                      styles.quickCashText,
                                      isSelected && styles.activeQuickCashText,
                                    ]}
                                  >
                                    {currencySymbol}
                                    {v}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}

                            {/* Exact Button */}
                            {(() => {
                              const isExact = Math.abs(parseFloat(cashReceivedInput) - finalTotal) < 0.01;
                              return (
                                <TouchableOpacity
                                  style={[
                                    styles.quickCashGridBtn,
                                    styles.quickCashExactBtn,
                                    isExact && styles.activeQuickCashExactBtn,
                                  ]}
                                  onPress={() => {
                                    setCashReceivedInput(finalTotal.toFixed(2));
                                    if (cashInputRef.current) cashInputRef.current.focus();
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <Text style={styles.quickCashExactText}>Exact</Text>
                                </TouchableOpacity>
                              );
                            })()}

                            {/* Clear Button */}
                            <TouchableOpacity
                              style={[styles.quickCashGridBtn, styles.quickCashClearBtn]}
                              onPress={() => {
                                setCashReceivedInput("");
                                if (cashInputRef.current) cashInputRef.current.focus();
                              }}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.quickCashClearText}>Clear</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      {/* Right Column: Numeric Keypad */}
                      <View style={styles.keypadCol}>
                        <View style={styles.keypadHeader}>
                          <Text style={styles.keypadTitle}>NUMERIC KEYPAD</Text>
                        </View>
                        <View style={styles.keypadGrid}>
                          {/* Row 1: 7, 8, 9 */}
                          <View style={styles.keypadRow}>
                            {["7", "8", "9"].map((num) => (
                              <TouchableOpacity
                                key={num}
                                style={styles.keypadBtn}
                                onPress={() => handleCashKeypadPress(num)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.keypadBtnText}>{num}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {/* Row 2: 4, 5, 6 */}
                          <View style={styles.keypadRow}>
                            {["4", "5", "6"].map((num) => (
                              <TouchableOpacity
                                key={num}
                                style={styles.keypadBtn}
                                onPress={() => handleCashKeypadPress(num)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.keypadBtnText}>{num}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {/* Row 3: 1, 2, 3 */}
                          <View style={styles.keypadRow}>
                            {["1", "2", "3"].map((num) => (
                              <TouchableOpacity
                                key={num}
                                style={styles.keypadBtn}
                                onPress={() => handleCashKeypadPress(num)}
                                activeOpacity={0.7}
                              >
                                <Text style={styles.keypadBtnText}>{num}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {/* Row 4: . (Decimal), 0, Backspace */}
                          <View style={styles.keypadRow}>
                            <TouchableOpacity
                              style={styles.keypadBtn}
                              onPress={() => handleCashKeypadPress(".")}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.keypadBtnText}>.</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={styles.keypadBtn}
                              onPress={() => handleCashKeypadPress("0")}
                              activeOpacity={0.7}
                            >
                              <Text style={styles.keypadBtnText}>0</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.keypadBtn, styles.keypadBackspaceBtn]}
                              onPress={() => handleCashKeypadPress("backspace")}
                              activeOpacity={0.7}
                            >
                              <Ionicons name="backspace-outline" size={24} color="#EA580C" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    </View>

                    {/* COMPLETE SETTLEMENT BUTTON */}
                    <TouchableOpacity
                      style={[
                        styles.cashCompleteBtn,
                        (isInsufficient || isProcessingPayment) && styles.cashCompleteBtnDisabled,
                      ]}
                      onPress={async () => {
                        if (isInsufficient) {
                          toast.showToast({
                            message: "Insufficient Cash Amount",
                            subtitle: `Cash received must be at least ${currencySymbol}${finalTotal.toFixed(2)}`,
                            type: "warning",
                          });
                          return;
                        }
                        await executePaymentFinalize(enteredCashNum, changeAmount);
                      }}
                      disabled={isInsufficient || isProcessingPayment}
                      activeOpacity={0.88}
                    >
                      {isProcessingPayment ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
                          <Text style={styles.cashCompleteBtnText}>Complete Settlement</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    height: (Platform.OS === "web" ? "100vh" : "100%") as any,
    maxHeight: (Platform.OS === "web" ? "100vh" : "100%") as any,
    overflow: "hidden",
  },
  topNavbar: {
    height: 56,
    flexShrink: 0,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    zIndex: 10,
  },
  navLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  hamburgerBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  logoWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoTitle: {
    fontSize: 17,
    fontFamily: Fonts.extraBold || Fonts.bold,
    color: "#0F172A",
    letterSpacing: -0.3,
  },

  searchContainer: {
    flex: 1,
    maxWidth: 360,
    height: 38,
    backgroundColor: "#F1F5F9",
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#0F172A",
  },

  navRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 4,
  },
  summaryActionBtnText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
  },
  orderTypePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  orderTypePillDineIn: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
  },
  orderTypePillTW: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
  },
  orderTypePillText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  tableNoPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  tableOrangeCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FF5A16",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  tableOrangeCircleText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  tableNoPillText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#C2410C",
  },
  headerSettingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },

  /* 3-COLUMN MAIN BODY */
  main3Column: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 10,
    backgroundColor: "#F3F4F6",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  kitchenTabsBar: {
    paddingVertical: 2,
    marginBottom: 6,
  },
  catScroll: {
    gap: 8,
    alignItems: "center",
  },
  catPill: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
  },
  catPillActive: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  catText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#64748B",
  },
  catTextActive: {
    color: "#FF5A16",
  },
  mainBody3Column: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    gap: 10,
    minHeight: 0,
    overflow: "hidden",
  },
  mainBodyMobile: {
    padding: 6,
    gap: 0,
  },
  mainBodyTablet: {
    padding: 8,
    gap: 8,
  },

  /* MOBILE TOP COMPACT SEARCH BAR */
  mobileSearchWrapper: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  mobileSearchContainer: {
    height: 36,
    backgroundColor: "#F1F5F9",
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  mobileSearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#0F172A",
  },

  /* MOBILE SEGMENT TAB BAR (Dishes | Groups | Cart) */
  mobileTabBarContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  mobileTabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  mobileTabButtonActive: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
  },
  mobileTabButtonText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#64748B",
  },
  mobileTabButtonTextActive: {
    color: "#FF5A16",
  },

  /* MOBILE FLOATING CART BAR */
  mobileFloatingCartBar: {
    position: "absolute",
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: "#FF5A16",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: "#FF5A16",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 999,
  },
  mobileFloatingCartLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mobileFloatingCartBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  mobileFloatingCartBadgeText: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: "#FF5A16",
  },
  mobileFloatingCartTitle: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  mobileFloatingCartSub: {
    fontSize: 10,
    fontFamily: Fonts.medium,
    color: "rgba(255,255,255,0.85)",
  },
  mobileFloatingCartRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  mobileFloatingCartTotal: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: "#FFFFFF",
  },

  /* COLUMN 1: LEFT SIDE CART */
  leftCartColumn: {
    width: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  leftCartColumnMobile: {
    width: "100%",
    borderRadius: 12,
  },
  leftCartColumnTablet: {
    width: 300,
  },
  cartHeaderBanner: {
    height: 42,
    backgroundColor: "#FF5A16",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  cartHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  cartHeaderTitle: {
    fontSize: 14.5,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  cartHeaderBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    marginLeft: 6,
  },
  cartHeaderBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  clearCartBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearCartText: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#FFFFFF",
  },

  cartItemsScroll: {
    flex: 1,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  emptyCartBox: {
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCartTitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#64748B",
    marginTop: 8,
  },
  emptyCartSub: {
    fontSize: 11.5,
    fontFamily: Fonts.regular,
    color: "#94A3B8",
    marginTop: 3,
  },

  cartItemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  cartItemThumbWrap: {
    position: "relative",
    marginRight: 8,
  },
  cartItemThumb: {
    width: 34,
    height: 34,
    borderRadius: 6,
    backgroundColor: "#F1F5F9",
  },
  vegBadgeTiny: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 12,
    height: 12,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  vegDotTiny: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  cartItemInfo: {
    flex: 1,
    marginRight: 6,
  },
  cartItemName: {
    fontSize: 12.5,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  cartSubDetailWrap: {
    marginTop: 1,
  },
  cartSubDetailText: {
    fontSize: 10,
    fontFamily: Fonts.medium,
    color: "#64748B",
    lineHeight: 13,
  },
  cartItemUnitPrice: {
    fontSize: 10,
    fontFamily: Fonts.medium,
    color: "#64748B",
    marginTop: 1,
  },
  qtyControlPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    paddingHorizontal: 3,
    paddingVertical: 2,
    marginRight: 6,
  },
  qtyBtnMinus: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnPlus: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  qtyNumText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    paddingHorizontal: 5,
  },
  cartItemTotalText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    marginRight: 4,
    width: 48,
    textAlign: "right",
  },
  deleteItemBtn: {
    padding: 2,
  },

  cartFooterArea: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 11.5,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  summaryValue: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  finalTotalCard: {
    backgroundColor: "#FFF7ED",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 6,
  },
  finalTotalLabel: {
    fontSize: 14.5,
    fontFamily: Fonts.extraBold || Fonts.bold,
    color: "#0F172A",
  },
  finalTotalValue: {
    fontSize: 17,
    fontFamily: Fonts.extraBold || Fonts.bold,
    color: "#0F172A",
  },
  completePaymentBtn: {
    backgroundColor: "#FF5A16",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  completePaymentBtnDisabled: {
    backgroundColor: "#FF5A16",
    opacity: 0.55,
  },
  completePaymentText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  payMethodsWrapper: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 8,
    marginBottom: 10,
  },
  paymodeHeaderTitle: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#64748B",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  paymodeVertRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
  },
  paymodeGridScrollWrap: {
    flex: 1,
  },
  paymodeVertScrollView: {
    maxHeight: 100,
  },
  paymodeGridInnerContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  payMethodGridItem: {
    width: "18.5%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 5,
    paddingHorizontal: 2,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  singleScrollPill: {
    width: 24,
    height: 100,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  singleScrollHalf: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  singleScrollDivider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 3,
  },
  payMethodBtnActive: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1.5,
    borderColor: "#FF5A16",
  },
  payMethodIconBg: {
    width: 28,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  payMethodLabel: {
    fontSize: 9.5,
    fontFamily: Fonts.bold,
    color: "#334155",
    textAlign: "center",
  },
  payMethodLabelActive: {
    color: "#FF5A16",
  },
  payMethodYeahPay: {
    borderColor: "#10B981",
    borderWidth: 1.5,
    backgroundColor: "#F0FDF4",
  },
  payMethodLabelYeahPay: {
    color: "#059669",
    fontWeight: "700",
  },

  /* Member / Credit Badge Above Complete Payment */
  memberPaymodePromptWrap: {
    marginTop: 6,
    marginBottom: 2,
  },
  selectedMemberBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  selectedMemberBadgeLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  selectedMemberIconBox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FF5A16",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  selectedMemberNameText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  selectedMemberPhoneText: {
    fontSize: 9.5,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  memberChangeBtn: {
    backgroundColor: "#FF5A16",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  memberChangeBtnText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  memberRemoveBtn: {
    padding: 3,
    marginLeft: 2,
  },
  memberSelectPromptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderStyle: "dashed",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  memberSelectPromptText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },

  /* Member / Credit Modal Styling */
  memberModalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      web: { boxShadow: "0 10px 25px rgba(0,0,0,0.15)" } as any,
    }),
  },
  memberModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  memberModalHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  memberModalTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  memberModalSubtitle: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  memberModalCloseBtn: {
    padding: 4,
  },
  memberSearchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    height: 38,
  },
  memberSearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#0F172A",
  },
  quickAddToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FF5A16",
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: "center",
  },
  quickAddToggleBtnText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  memberListItemCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10,
    marginBottom: 6,
  },
  memberListItemCardSelected: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
    borderWidth: 1.5,
  },
  memberListItemName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  memberListItemPhone: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#64748B",
    marginTop: 2,
  },
  memberListItemAvailLabel: {
    fontSize: 9.5,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  memberListItemAvailVal: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#10B981",
  },
  inactivePillText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "#EF4444",
  },
  quickAddFormField: {
    marginBottom: 10,
  },
  quickAddLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#334155",
    marginBottom: 4,
  },
  quickAddInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#0F172A",
  },

  /* YeahPay Terminal Modal Styling */
  terminalModalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
  },
  terminalIconWrap: {
    marginBottom: 14,
  },
  terminalTitle: {
    fontSize: 17,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    textAlign: "center",
  },
  terminalSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  terminalAmountBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: "center",
    marginVertical: 14,
    width: "100%",
  },
  terminalAmountLabel: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  terminalAmountValue: {
    fontSize: 22,
    fontFamily: Fonts.bold,
    color: "#059669",
    marginTop: 2,
  },
  terminalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    width: "100%",
    alignItems: "center",
  },
  terminalCancelBtnText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#64748B",
  },

  /* COLUMN 2: CENTER DISH GROUPS */
  centerGroupsColumn: {
    width: 295,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  centerGroupsColumnMobile: {
    width: "100%",
    borderRadius: 12,
  },
  centerGroupsColumnTablet: {
    width: 240,
  },
  groupsHeader: {
    height: 42,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupsHeaderTitle: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  groupsHeaderToggles: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    padding: 2,
  },
  miniToggleBtn: {
    width: 24,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  miniToggleBtnActive: {
    backgroundColor: "#FFFFFF",
  },
  toggleViewIconBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleViewIconBtnActive: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  favoritesButtonRow: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: "#FFFFFF",
  },
  favoritesBigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF5F7",
    borderWidth: 1.5,
    borderColor: "#FECDD3",
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 14,
    height: 50,
    shadowColor: "#E11D48",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  favoritesBigBtnActive: {
    backgroundColor: "#E11D48",
    borderColor: "#BE123C",
    shadowColor: "#E11D48",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 4,
  },
  favoritesIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFE4E6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  favoritesIconCircleActive: {
    backgroundColor: "rgba(255, 255, 255, 0.24)",
  },
  favoritesBigBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#BE123C",
    letterSpacing: 0.3,
  },
  favoritesBigBtnTextActive: {
    color: "#FFFFFF",
  },
  favoritesCountBadge: {
    backgroundColor: "#FFE4E6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#FECDD3",
  },
  favoritesCountBadgeActive: {
    backgroundColor: "rgba(255, 255, 255, 0.24)",
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  favoritesCountBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#BE123C",
  },
  favoritesCountBadgeTextActive: {
    color: "#FFFFFF",
  },
  dishGroupPanelBody: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
  },
  dishGroupScroll: {
    flex: 1,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 8,
  },
  dishGroupScrollContent: {
    paddingBottom: 8,
  },
  dishGroupGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dishGroupCard2Col: {
    width: (Platform.OS === "web" ? "calc(50% - 3px)" : "48.5%") as any,
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 9,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dishGroupCard2ColActive: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  dishGroupName2Col: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: Fonts.bold,
    color: "#1E293B",
    marginRight: 4,
    lineHeight: 15,
  },
  dishGroupName2ColActive: {
    color: "#FFFFFF",
  },
  dishGroupBadge2Col: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderRadius: 8,
    minWidth: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dishGroupBadge2ColActive: {
    backgroundColor: "#FFFFFF",
  },
  dishGroupBadgeText2Col: {
    fontSize: 10.5,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  dishGroupBadgeText2ColActive: {
    color: "#FF5A16",
  },
  dishGroupScrollPillContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingRight: 6,
    paddingLeft: 2,
  },
  dishGroupScrollPill: {
    width: 24,
    height: 100,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  scrollBtnDisabled: {
    opacity: 0.35,
  },

  categoriesScroll: {
    flex: 1,
    padding: 10,
  },
  categoryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  categoryCardActive: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  categoryThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: "#E2E8F0",
  },
  categoryName: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#1E293B",
  },
  categoryNameActive: {
    color: "#FFFFFF",
  },
  categoryBadge: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  categoryBadgeActive: {
    backgroundColor: "#FFFFFF",
  },
  categoryBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  categoryBadgeTextActive: {
    color: "#FF5A16",
  },

  /* COLUMN 3: RIGHT DISHES */
  rightDishesColumn: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  rightDishesColumnMobile: {
    width: "100%",
    borderRadius: 12,
  },
  dishesHeaderRow: {
    height: 38,
    flexShrink: 0,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dishesHeaderTitle: {
    fontSize: 14.5,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  filterPillsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  filterPillActive: {
    backgroundColor: "#FF5A16",
  },
  filterPillVegActive: {
    backgroundColor: "#22C55E",
  },
  filterPillNonVegActive: {
    backgroundColor: "#FF5A16",
  },
  filterPillText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  filterPillTextActive: {
    color: "#FFFFFF",
  },

  viewToggleGroup: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    padding: 2,
  },
  viewToggleBtn: {
    width: 26,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  viewToggleBtnActive: {
    backgroundColor: "#FF5A16",
  },

  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingStateText: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  emptyDishesState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyDishesTitle: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#475569",
    marginTop: 8,
  },
  emptyDishesSub: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: "#94A3B8",
    marginTop: 3,
  },

  /* FAVORITES VIEW: SINGLE HORIZONTAL ROW */
  favoritesRowContainer: {
    flex: 1,
    padding: 10,
    justifyContent: "flex-start",
    alignItems: "flex-start",
    overflow: "hidden",
  },
  favoritesHorizontalScroll: {
    width: "100%",
    flexGrow: 0,
  },
  favoritesHorizontalContent: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
    paddingRight: 24,
    paddingBottom: 8,
  },
  favoriteCardItem: {
    width: 130,
    flexShrink: 0,
  },

  dishesGridScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  dishesGridContainer: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    flexGrow: 1,
  },
  dishesListContainer: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    flexGrow: 1,
  },
  dishCard: {
    position: "relative",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 4,
    alignItems: "center",
    ...Theme.shadowSm,
  },
  dishCardSoldOut: {
    opacity: 0.5,
  },
  dishImageWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: "hidden",
    marginBottom: 2,
    backgroundColor: Theme.bgMain,
  },
  dishImg: {
    width: "100%",
    height: "100%",
  },
  dishName: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    minHeight: 22,
    lineHeight: 11,
  },
  dishPrice: {
    fontSize: 11,
    fontFamily: Fonts.black,
    color: Theme.primary,
    marginTop: 1,
    textAlign: "center",
  },
  qtyBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: Theme.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
    borderWidth: 2,
    borderColor: "#fff",
    ...Theme.shadowSm,
  },
  qtyBadgeText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 13,
  },
  tagBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    zIndex: 5,
  },
  tagBadgeText: {
    fontSize: 7.5,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  addPlusBtn: {
    width: 20,
    height: 20,
    borderRadius: 4.5,
    backgroundColor: "#FF5A16",
    alignItems: "center",
    justifyContent: "center",
  },
  addPlusBtnDisabled: {
    backgroundColor: "#94A3B8",
  },

  /* DISH GROUPS BOTTOM PAGINATION BAR */
  groupsPaginationBar: {
    height: 34,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    zIndex: 10,
  },

  /* DISHES BOTTOM PAGINATION BAR */
  dishesPaginationBar: {
    height: 34,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    zIndex: 10,
  },
  paginationLeft: {
    minWidth: 84,
    alignItems: "flex-start",
  },
  paginationCenter: {
    flex: 1,
  },
  paginationRight: {
    minWidth: 84,
    alignItems: "flex-end",
  },
  paginationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
  },
  paginationBtnText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },
  paginationBtnPrimary: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  paginationBtnPrimaryText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },
  paginationText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#475569",
  },
  paginationCurrentText: {
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  paginationTotalText: {
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  paginationBtnDisabled: {
    backgroundColor: "#F1F5F9",
    borderColor: "#E2E8F0",
  },
  paginationBtnTextDisabled: {
    color: "#94A3B8",
  },
  paginationSubtext: {
    fontSize: 11,
    fontFamily: Fonts.regular,
    color: "#94A3B8",
  },

  /* NORMAL POS TABLE VIEW STYLES */
  normalPosContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  normalPosHeaderBar: {
    height: 48,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTabPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    marginRight: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTabPillActive: {
    backgroundColor: "#FF5A16",
  },
  sectionTabText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  sectionTabTextActive: {
    color: "#FFFFFF",
  },
  sectionCountTag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    marginLeft: 6,
  },
  sectionCountText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  normalTableGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  normalTableCard: {
    width: 100,
    height: 90,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  tableNoTextBig: {
    fontSize: 22,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  normalPosFabBtn: {
    position: "absolute",
    bottom: 20,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FF5A16",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
  },

  /* MODALS STYLES */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalBox: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    marginBottom: 14,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: "#0F172A",
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  modalCancelText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#FF5A16",
  },
  modalSaveText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#FFFFFF",
  },

  modifierModalContent: {
    width: "100%",
    maxWidth: 500,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
  },
  modifierModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modifierModalTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  modifierModalBody: {
    marginBottom: 16,
  },
  modifierGroupContainer: {
    marginBottom: 14,
  },
  modifierGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modifierGroupName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  modifierGroupLimits: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  modifierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modifierCard: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  modifierCardSelected: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
  },
  modifierCardName: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#334155",
  },
  modifierCardPrice: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#64748B",
    marginTop: 2,
  },
  modifierCardTextSelected: {
    color: "#FF5A16",
  },
  modifierModalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  openItemModalContent: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  dishGroupPillsBar: {
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    paddingVertical: 8,
  },
  dishGroupPillsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  dishGroupPillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  dishGroupPillBtnActive: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  dishGroupPillText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#334155",
  },
  dishGroupPillTextActive: {
    color: "#FFFFFF",
  },
  dishesList: {
    flexDirection: "column",
    gap: 8,
  },
  dishListRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10,
  },
  dishListThumbWrap: {
    position: "relative",
    marginRight: 12,
  },
  dishListThumb: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
  },
  dishListInfo: {
    flex: 1,
    marginRight: 10,
  },
  dishListName: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  dishListCode: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#64748B",
    marginTop: 2,
  },
  dishListPrice: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
    marginRight: 12,
  },
  cartQtyBadgeRow: {
    backgroundColor: "#FF5A16",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  cartQtyBadgeRowText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.bold,
  },

  /* TABLE SELECTION MODAL STYLES */
  tableModalContent: {
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
  },
  tableModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  tableModalTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  tableModalTabs: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  },
  tableModalTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  tableModalTabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tableModalTabText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },
  tableModalTabTextActive: {
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },
  tableSearchSmallBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tableHeaderSearchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#FF5A16",
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 14,
  },
  tableHeaderSearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#0F172A",
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  tableSearchHeaderCloseBtn: {
    padding: 4,
    marginLeft: 4,
  },
  tableSearchEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  tableSearchEmptyText: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#64748B",
    textAlign: "center",
    marginBottom: 12,
  },
  tableSearchClearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
  },
  tableSearchClearText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },
  tablePickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tablePickerCard: {
    width: "31%",
    minWidth: 120,
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    padding: 10,
    alignItems: "center",
  },
  tablePickerCardSelected: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
  },
  tablePickerCardOccupied: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FCA5A5",
  },
  tablePickerNumBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  tablePickerNumText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#334155",
  },
  tablePickerName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    marginBottom: 6,
  },
  tableStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tableStatusText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  tableModalFooter: {
    marginTop: 12,
    alignItems: "center",
  },
  autoSelectFreeBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
  },
  autoSelectFreeText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },

  /* Custom Item Sub-modal Styling (Image 2) */
  customItemModal: {
    width: "88%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
      web: { boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)" } as any,
    }),
  },
  customModalTitle: {
    fontSize: 20,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    color: "#475569",
    fontSize: 14,
    fontFamily: Fonts.bold,
    marginBottom: 8,
  },
  customInput: {
    height: 52,
    backgroundColor: "#FAF7F2",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    paddingHorizontal: 16,
    color: "#0F172A",
    fontSize: 16,
    fontFamily: Fonts.medium,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  customModalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  customBtnCancel: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#F1EDE6",
    justifyContent: "center",
    alignItems: "center",
  },
  customBtnTextCancel: {
    color: "#475569",
    fontSize: 16,
    fontFamily: Fonts.bold,
  },
  customBtnAdd: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#FF5A16",
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#FF5A16",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: { elevation: 4 },
      web: { boxShadow: "0 4px 12px rgba(255, 90, 22, 0.35)" } as any,
    }),
  },
  customBtnTextAdd: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: Fonts.bold,
  },

  /* CASH RECEIVED MODAL STYLES (MATCHING payment.tsx) */
  cashModalContainer: {
    width: "95%",
    maxWidth: 780,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: { elevation: 16 },
      web: { boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)" } as any,
    }),
  },
  cashModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  cashModalHeaderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#FFF7ED",
    justifyContent: "center",
    alignItems: "center",
  },
  cashModalTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: "#0F172A",
    letterSpacing: 0.5,
  },
  cashModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
  },
  cashSectionBody: {
    flexDirection: "column",
  },
  cashAndKeypadRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "stretch",
  },
  cashLeftCol: {
    flex: 1.35,
    flexDirection: "column",
    justifyContent: "space-between",
  },
  cashAmountsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  cashInputBox: {
    flex: 1.3,
    flexDirection: "row",
    alignItems: "center",
    height: 60,
    backgroundColor: "#F5EFE6",
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#EADDC8",
  },
  currencyPrefix: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.primary,
    marginRight: 6,
  },
  cashInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  changeBox: {
    flex: 1,
    height: 60,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#FFF7ED",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FFEDD5",
    justifyContent: "center",
  },
  changeLabel: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  changeValue: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  quickCashGrid: {
    flexDirection: "column",
    gap: 10,
  },
  quickCashRow: {
    flexDirection: "row",
    gap: 10,
  },
  quickCashGridBtn: {
    flex: 1,
    height: 56,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  activeQuickCashBtn: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
  },
  quickCashExactBtn: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FDBA74",
    borderWidth: 1,
  },
  activeQuickCashExactBtn: {
    backgroundColor: "#FFEDD5",
    borderColor: Theme.primary,
  },
  quickCashExactText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  quickCashText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  activeQuickCashText: { color: Theme.primary },
  quickCashClearBtn: {
    backgroundColor: "#EF4444",
    borderColor: "#DC2626",
    borderWidth: 1,
  },
  quickCashClearText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: "#fff",
  },
  keypadCol: {
    flex: 1,
    backgroundColor: "#FAFAFA",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
  },
  keypadHeader: {
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  keypadTitle: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#9CA3AF",
    letterSpacing: 0.5,
  },
  keypadGrid: {
    flexDirection: "column",
    gap: 8,
  },
  keypadRow: {
    flexDirection: "row",
    gap: 8,
  },
  keypadBtn: {
    flex: 1,
    height: 52,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  keypadBtnText: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: "#D97706",
  },
  keypadBackspaceBtn: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FFEDD5",
  },
  cashCompleteBtn: {
    marginTop: 20,
    height: 54,
    backgroundColor: "#FF5A16",
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#FF5A16",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
      web: { boxShadow: "0 6px 16px rgba(255, 90, 22, 0.4)" } as any,
    }),
  },
  cashCompleteBtnDisabled: {
    backgroundColor: "#CBD5E1",
    opacity: 0.65,
    ...Platform.select({
      web: { boxShadow: "none" } as any,
      ios: { shadowOpacity: 0 },
      android: { elevation: 0 },
    }),
  },
  cashCompleteBtnText: {
    fontSize: 17,
    fontFamily: Fonts.black,
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
