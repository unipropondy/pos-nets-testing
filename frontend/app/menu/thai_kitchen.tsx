import { API_URL } from "@/constants/Config";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import CartSidebar from "../../components/CartSidebar";
import ComboCustomizer from "../../components/ComboCustomizer";
import { useToast } from "../../components/Toast";
import { Skeleton } from "../../components/ui/Skeleton";
import UniversalPrinter from "../../components/UniversalPrinter";
import WindowControls from "../../components/WindowControls";
import { Fonts } from "../../constants/Fonts";
import { Theme } from "../../constants/theme";
import { useBarcodeScanner } from "../../hooks/useBarcodeScanner";
import { useAuthStore } from "../../stores/authStore";
import {
  addToCartGlobal,
  getContextId,
  setCurrentContext,
  useCartStore
} from "../../stores/cartStore";
import { useCompanySettingsStore } from "../../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";
import { useMenuStore } from "../../stores/menuStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { usePaymentSettingsStore } from "../../stores/paymentSettingsStore";

const EMPTY_ARRAY: any[] = [];

const IMAGE_BASE_URL = `${API_URL}/api/menu/image/`;

// --- COMPONENTS ---

const NavRail = () => {
  const router = useRouter();
  const navItems = [
    { id: "home", icon: "home-outline", label: "Home", active: true },
  ];

  return (
    <View style={styles.rail}>
      <View style={styles.railTop}>
        {navItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.railItem, item.active && styles.railItemActive]}
            onPress={() => {
              if (item.id === "home") {
                const targetSec = useOrderContextStore.getState().currentOrder?.section || "SECTION_1";
                router.replace(`/(tabs)/category?section=${targetSec}`);
              }
            }}
          >
            <Ionicons
              name={item.icon as any}
              size={22}
              color={item.active ? Theme.primary : Theme.textSecondary}
            />
            <Text
              style={[styles.railLabel, item.active && styles.railLabelActive]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.railBottom}>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => router.replace("/login")}
        >
          <Ionicons
            name="log-out-outline"
            size={22}
            color={Theme.textSecondary}
          />
          <Text style={styles.railLabel}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const DishCard = React.memo(
  ({ dish, width, cartQty, onPress, isPhone, isTablet, isLandscape }: any) => {
    const isSC = (Number(dish.isServiceCharge) === 1 || dish.isServiceCharge === true) && useGeneralSettingsStore.getState().settings.SVCIdentification !== false;
    const isSoldOut = dish.IsSoldOut === true || String(dish.IsSoldOut) === "1" || dish.IsSoldOut === 1 || dish.isSoldOut === true || String(dish.isSoldOut) === "1" || dish.isSoldOut === 1;
    return (
      <Pressable
        style={({ pressed }: { pressed: boolean }) => [
          styles.card,
          {
            width,
            paddingVertical: isLandscape ? 4 : isPhone ? 8 : isTablet ? 12 : 10,
            paddingHorizontal: isLandscape ? 4 : isPhone ? 8 : isTablet ? 12 : 10,
          },
          isLandscape && {
            maxHeight: 98,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: isSC ? Theme.dangerBorder : "#F1F5F9",
          },
          isSC && {
            borderWidth: 1.5,
            borderColor: Theme.dangerBorder,
            backgroundColor: Theme.dangerBg,
          },
          isSoldOut && { opacity: 0.5 },
          pressed && !isSoldOut && { opacity: 0.85, transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => {
          if (isSoldOut) {
            alert(`${dish.Name} is Sold Out!`);
            return;
          }
          onPress(dish);
        }}
        disabled={isSoldOut}
      >
        {cartQty > 0 && (
          <View
            style={[
              styles.qtyBadge,
              isLandscape
                ? { width: 18, height: 18, borderRadius: 9 }
                : isPhone
                ? { width: 22, height: 22, borderRadius: 11 }
                : isTablet
                ? { width: 32, height: 32, borderRadius: 16 }
                : null,
            ]}
          >
            <Text
              style={[
                styles.qtyBadgeText,
                isLandscape
                  ? { fontSize: 9.5 }
                  : isPhone
                  ? { fontSize: 11 }
                  : isTablet
                  ? { fontSize: 15 }
                  : null,
              ]}
            >
              {cartQty}
            </Text>
          </View>
        )}
        <View
          style={[
            styles.dishImageWrap,
            isLandscape
              ? { width: 38, height: 38, marginBottom: 3, borderRadius: 19 }
              : isPhone
              ? { width: 48, height: 48, marginBottom: 4 }
              : isTablet
              ? {
                  width: 75,
                  height: 75,
                  marginBottom: 6,
                  borderRadius: 37.5,
                }
              : null,
          ]}
        >
          {dish.Image ? (
            <Image
              source={{ uri: `${IMAGE_BASE_URL}${dish.Image}` }}
              style={styles.dishImg}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
              priority="high"
              recyclingKey={String(dish.Image)}
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
                size={isLandscape ? 18 : isPhone ? 24 : isTablet ? 48 : 40}
                color={Theme.textMuted}
              />
            </View>
          )}
          {isSoldOut && (
            <View style={{
              position: "absolute",
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              justifyContent: "center",
              alignItems: "center",
              borderRadius: isLandscape ? 19 : isPhone ? 24 : 37.5,
            }}>
              <Text style={{
                color: "#fff",
                fontSize: 8,
                fontFamily: Fonts.bold,
                textAlign: "center"
              }}>SOLD OUT</Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.dishName,
            isLandscape
              ? { fontSize: 10.5, minHeight: 24, lineHeight: 12 }
              : isPhone
              ? { fontSize: 11, minHeight: 42, lineHeight: 14 }
              : isTablet
              ? { fontSize: 13, minHeight: 48, lineHeight: 16 }
              : null,
          ]}
          numberOfLines={2}
        >
          {dish.Name}
        </Text>
        <Text
          style={[
            styles.dishPrice,
            isLandscape
              ? { fontSize: 11.5, marginTop: 1 }
              : isPhone
              ? { fontSize: 12 }
              : isTablet
              ? { fontSize: 14 }
              : null,
          ]}
        >
          {(() => {
            const currencySymbol = useCompanySettingsStore.getState().settings.currencySymbol || "$";
            return (Number(dish.IsOpenItem) === 1 || dish.IsOpenItem === true || dish.IsOpenItem === 'true' || dish.IsOpenItem === '1') ? "Open Price" : `${currencySymbol}${(dish.Price || 0).toFixed(2)}`;
          })()}
        </Text>
        {isSoldOut ? (
          <View style={{ backgroundColor: "#EF444422", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2, borderWidth: 1, borderColor: "#EF444444", alignSelf: "center" }}>
            <Text style={{ fontSize: 9, color: "#EF4444", fontFamily: Fonts.bold }}>SOLD OUT</Text>
          </View>
        ) : (Number(dish.IsOpenItem) === 1 || dish.IsOpenItem === true || dish.IsOpenItem === 'true' || dish.IsOpenItem === '1') ? (
          <View style={{ backgroundColor: "#F59E0B22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2, borderWidth: 1, borderColor: "#F59E0B44", alignSelf: "center" }}>
            <Text style={{ fontSize: 9, color: "#B45309", fontFamily: Fonts.bold }}>OPEN</Text>
          </View>
        ) : null}
      </Pressable>
    );
  },
);

// 🚀 PERFORMANCE OPTIMIZATION: Surgical Quantity Updates
// This wrapper ensures only the SPECIFIC dish card being updated re-renders.
const DishCardWrapper = React.memo(
  ({ item, width, isPhone, isTablet, isLandscape, onPress }: any) => {
    const orderContext = useOrderContextStore((state) => state.currentOrder);
    const currentContextId = useCartStore((state) => state.currentContextId);
    const effectiveContextId = (orderContext ? getContextId(orderContext) : null) || currentContextId;
    const dishId = item.DishId || item.id;

    // ⚡ SURGICAL SUBSCRIPTION: Only re-render if the quantity of THIS specific product changes
    const cartQty = useCartStore((state) => {
      if (!effectiveContextId) return 0;
      const qtyMap = state.cartQtyMap[effectiveContextId] || {};
      return qtyMap[dishId] || 0;
    });

    return (
      <DishCard
        dish={item}
        width={width}
        cartQty={cartQty}
        onPress={onPress}
        isPhone={isPhone}
        isTablet={isTablet}
        isLandscape={isLandscape}
      />
    );
  },
  (prevProps, nextProps) => {
    return (
      (prevProps.item.DishId || prevProps.item.id) === (nextProps.item.DishId || nextProps.item.id) &&
      prevProps.width === nextProps.width &&
      prevProps.isPhone === nextProps.isPhone &&
      prevProps.isTablet === nextProps.isTablet &&
      prevProps.isLandscape === nextProps.isLandscape
    );
  }
);

const DishGridSkeleton = ({ cardWidth, columns, gap, isPhone }: any) => {
  const items = Array.from({ length: columns * 4 });
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        gap: gap,
        paddingBottom: 80,
      }}
    >
      {items.map((_, i) => (
        <View
          key={i}
          style={[
            styles.card,
            {
              width: cardWidth,
              padding: isPhone ? 8 : 12,
              borderStyle: "dashed",
            },
          ]}
        >
          <Skeleton
            circle
            width={isPhone ? 48 : 75}
            height={isPhone ? 48 : 75}
            style={{ marginBottom: 8 }}
          />
          <Skeleton width="80%" height={14} style={{ marginBottom: 6 }} />
          <Skeleton width="40%" height={14} />
        </View>
      ))}
    </View>
  );
};

const CategorySkeleton = () => (
  <View style={{ flexDirection: "row", gap: 10, marginBottom: 15 }}>
    {[1, 2, 3, 4].map((i) => (
      <Skeleton key={i} width={100} height={36} borderRadius={12} />
    ))}
  </View>
);

const GroupSkeleton = () => (
  <View style={{ flexDirection: "row", gap: 8, marginTop: 15 }}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} width={80} height={38} borderRadius={full} />
    ))}
  </View>
);

// 🚀 PERFORMANCE OPTIMIZATION: Cart Badge Component
const CartBadge = React.memo(({ isPhone, isLandscape }: any) => {
  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const currentContextId = useCartStore((state) => state.currentContextId);
  const effectiveContextId = (orderContext ? getContextId(orderContext) : null) || currentContextId;
  const count = useCartStore((state) => {
    if (!effectiveContextId) return 0;
    return (state.carts[effectiveContextId] || []).length;
  });

  if (count === 0) return null;

  return (
    <View
      style={[
        styles.cartBadge,
        isPhone &&
        isLandscape && { top: -4, right: -4, minWidth: 16, height: 16 },
      ]}
    >
      <Text
        style={[
          styles.cartBadgeText,
          isPhone && isLandscape && { fontSize: 9 },
        ]}
      >
        {count}
      </Text>
    </View>
  );
});

// --- SCREEN ---

export default function MenuScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();

  const {
    kitchens,
    fetchMenu,
    fetchGroups,
    fetchDishes,
    allDishes,
    isLoading: menuLoading,
    modifierCache,
    forceRefreshMenu,
  } = useMenuStore();

  const [groups, setGroups] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [isLoadingDishes, setIsLoadingDishes] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const [selectedKitchenId, setSelectedKitchenId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Search input ref & platform-aware focus management
  const searchInputRef = React.useRef<TextInput>(null);
  const [mobileSoftInputEnabled, setMobileSoftInputEnabled] = useState(false);
  const focusTimerRef = React.useRef<any>(null);

  const requestSearchFocus = React.useCallback(() => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      if (searchInputRef.current) {
        if (Platform.OS === "web") {
          const domInput = searchInputRef.current as any;
          if (domInput?.focus) {
            domInput.focus({ preventScroll: true });
          }
        } else {
          searchInputRef.current.focus();
        }
      }
    }, 50);
  }, []);

  // Cleanup focus timer on unmount
  useEffect(() => {
    return () => {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    };
  }, []);

  // Screen focus lifecycle: auto-focus search whenever menu screen mounts or regains navigation focus
  useFocusEffect(
    React.useCallback(() => {
      if (Platform.OS !== "web") {
        setMobileSoftInputEnabled(false);
      }
      requestSearchFocus();
    }, [requestSearchFocus])
  );
  // Track in-flight modifier fetches to prevent duplicate requests
  const fetchingModifiers = React.useRef<Set<string>>(new Set());

  // Modifier Modal State
  const [modifiers, setModifiers] = useState<any[]>([]);
  const [showModifier, setShowModifier] = useState(false);

  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitMembers, setSplitMembers] = useState<any[]>([]);
  const [selectedSplitDish, setSelectedSplitDish] = useState<any>(null);
  const [splitAmount, setSplitAmount] = useState("");
  const [songName, setSongName] = useState("");

  const [selectedDish, setSelectedDish] = useState<any | null>(null);
  const [selectedModifierQuantities, setSelectedModifierQuantities] = useState<Record<string, number>>({});
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  // Open Item modal state
  const [showOpenItemModal, setShowOpenItemModal] = useState(false);
  const [openItemDish, setOpenItemDish] = useState<any | null>(null);
  const [openItemPrice, setOpenItemPrice] = useState("");
  const [openItemError, setOpenItemError] = useState("");

  // Combo modal state
  const [showComboModal, setShowComboModal] = useState(false);
  const [comboDish, setComboDish] = useState<any | null>(null);

  // Custom Item Submodal (Screenshot Flow)
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customItemName, setCustomItemName] = useState("");
  const [customItemPrice, setCustomItemPrice] = useState("");
  const [customMods, setCustomMods] = useState<any[]>([]);
  const [editingLineItemId, setEditingLineItemId] = useState<string | null>(
    null,
  );
  const [showReprintOptions, setShowReprintOptions] = useState(false);
  const { showToast } = useToast();
  const user = useAuthStore((s: any) => s.user);


  const paymentSettings = usePaymentSettingsStore((s: any) => s.settings);

  const orderContext = useOrderContextStore((state) => state.currentOrder);

  // 🟢 OPTIMIZED SELECTORS: Removed cart subscription from main screen to prevent full-screen re-renders.
  const currentContextId = useCartStore((state) => state.currentContextId);
  const displayOrderId = useCartStore(
    (state) =>
      (orderContext?.tableId
        ? state.tableOrderIds[orderContext.tableId]
        : undefined) || null,
  );

  // --- MENU NAVIGATION MODE & PAGINATION ---
  const menuNavigationMode =
    useGeneralSettingsStore((s: any) => s.settings.menuNavigationMode) || "scroll";
  const [currentPage, setCurrentPage] = useState(1);
  const DISHES_PER_PAGE = 16;
  const dishesScrollRef = React.useRef<any>(null);

  // Dish Group Pagination (when menuNavigationMode === 'prev_next')
  const [currentGroupPage, setCurrentGroupPage] = useState(1);
  const GROUPS_PER_PAGE = 14; // 2 columns x 7 rows to display 14 dish groups per page and fill vertical space

  // Dish Group Vertical Scroll Navigation Ref & Measurements (Quick Serve POS style)
  const dishGroupScrollRef = React.useRef<ScrollView>(null);
  const [dishGroupScrollOffset, setDishGroupScrollOffset] = useState<number>(0);
  const [dishGroupContentHeight, setDishGroupContentHeight] = useState<number>(0);
  const [dishGroupContainerHeight, setDishGroupContainerHeight] = useState<number>(0);

  const isDishGroupAtTop = dishGroupScrollOffset <= 2;
  const isDishGroupAtBottom =
    dishGroupContainerHeight > 0 &&
    dishGroupContentHeight > 0 &&
    dishGroupScrollOffset + dishGroupContainerHeight >= dishGroupContentHeight - 5;

  const scrollDishGroupsVertically = (direction: "up" | "down") => {
    if (dishGroupScrollRef.current) {
      const delta = direction === "down" ? 120 : -120;
      const nextOffset = Math.max(0, dishGroupScrollOffset + delta);
      dishGroupScrollRef.current.scrollTo({
        y: nextOffset,
        animated: true,
      });
      setDishGroupScrollOffset(nextOffset);
    }
  };

  const scrollDishesToTop = () => {
    if (!dishesScrollRef.current) return;
    if (typeof dishesScrollRef.current.scrollToOffset === "function") {
      dishesScrollRef.current.scrollToOffset({ offset: 0, animated: false });
    } else if (typeof dishesScrollRef.current.scrollTo === "function") {
      dishesScrollRef.current.scrollTo({ y: 0, animated: false });
    }
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    scrollDishesToTop();
  };

  const handleGroupPageChange = (newPage: number) => {
    setCurrentGroupPage(newPage);
    if (dishGroupScrollRef.current) {
      dishGroupScrollRef.current.scrollTo({ y: 0, animated: false });
      setDishGroupScrollOffset(0);
    }
  };

  // Dish counts per dish group for badges
  const getDishGroupCount = (groupId: string | number) => {
    const gIdStr = String(groupId);
    const cached = useMenuStore.getState().dishesByGroup[gIdStr];
    if (Array.isArray(cached)) return cached.length;
    // Fallback: count from allDishes
    const matched = allDishes.filter((d: any) => String(d.DishGroupId || d.GroupId) === gIdStr);
    return matched.length;
  };

  const enableKOT = useGeneralSettingsStore((s: any) => s.settings.enableKOT);
  const enableCheckoutBill = useGeneralSettingsStore(
    (s: any) => s.settings.enableCheckoutBill,
  );

  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= 500;
  const isPhone = !isTablet;
  const [showCart, setShowCart] = useState(true);

  const toggleCart = () => {
    if (Platform.OS !== "web") {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setShowCart((prev) => !prev);
  };

  const insets = useSafeAreaInsets();
  const usableWidth = width - insets.left - insets.right;

  const handleReprintKOT = async () => {
    const effectiveContextId = (orderContext ? getContextId(orderContext) : null) || currentContextId;
    const cart = effectiveContextId ? (useCartStore.getState().carts[effectiveContextId] || []) : [];
    if (!cart.length) {
      showToast({ type: "error", message: "Cart is empty" });
      return;
    }

    try {
      const activeItems = cart.filter((i: any) => i.status !== "VOIDED");
      const contextObj = {
        orderType: orderContext?.orderType,
        tableNo: orderContext?.tableNo,
        takeawayNo: orderContext?.takeawayNo,
        section: orderContext?.section,
      };

      await UniversalPrinter.routeAndPrintOrderKOT(
        displayOrderId || "",
        contextObj,
        activeItems,
        false,
        orderContext?.serverName || "Staff",
        true,
        true
      );

      showToast({
        type: "success",
        message: "KOT Reprinted",
        subtitle: "Tickets sent to kitchen",
      });
      setShowReprintOptions(false);
    } catch (err) {
      console.error("Reprint KOT error:", err);
      showToast({ type: "error", message: "Reprint Failed" });
    }
  };

  const handleReprintBill = async () => {
    const effectiveContextId = (orderContext ? getContextId(orderContext) : null) || currentContextId;
    const cart = effectiveContextId ? (useCartStore.getState().carts[effectiveContextId] || []) : [];
    if (!cart.length) {
      showToast({ type: "error", message: "Cart is empty" });
      return;
    }

    try {
      const discountInfo = (effectiveContextId && useCartStore.getState().discounts[effectiveContextId]) || { applied: false, type: "fixed", value: 0 };

      const subtotal = cart.reduce((sum: number, item: any) => {
        if (item.status === "VOIDED") return sum;
        return sum + (item.price || 0) * item.qty;
      }, 0);

      const discAmt = discountInfo.applied
        ? discountInfo.type === "percentage"
          ? (subtotal * discountInfo.value) / 100
          : discountInfo.value
        : 0;

      const gstAmt = subtotal * ((paymentSettings.gstPercentage || 0) / 100);
      const total = subtotal - discAmt + gstAmt;

      const saleData = {
        items: cart,
        total: total,
        subtotal: subtotal,
        discount: discountInfo,
        orderId: displayOrderId,
        tableNo: orderContext?.tableNo,
        waiterName: orderContext?.serverName,
        date: new Date(),
        isCheckout: true,
      };

      await UniversalPrinter.printCheckoutBill(
        saleData,
        user?.userId || "SYSTEM",
        {
          ...discountInfo,
          amount: discAmt,
        },
      );

      showToast({
        type: "success",
        message: "Bill Printing",
        subtitle: "Receipt sent to printer",
      });
      setShowReprintOptions(false);
    } catch (err) {
      console.error("Print Bill error:", err);
      showToast({ type: "error", message: "Printing Failed" });
    }
  };

  // Cart width on the right (preserved exactly)
  const cartWidth = isTablet
    ? width > 1024
      ? 380
      : 330
    : isLandscape
      ? usableWidth * 0.38
      : width * 0.62;

  // Dish group column width on the left
  const groupsColumnWidth = isTablet ? (width > 1200 ? 280 : 250) : (isLandscape ? 220 : 200);

  // Main width for portrait fallback
  const mainWidth = showCart
    ? (isLandscape && !isTablet ? usableWidth : width) - cartWidth
    : (isLandscape && !isTablet ? usableWidth : width);

  // Center dishes panel width
  const centerDishesWidth = isLandscape
    ? Math.max(200, (showCart ? usableWidth - cartWidth : usableWidth) - groupsColumnWidth - 20)
    : usableWidth;

  // Fixed 4 columns in landscape mode to match Quick Serve POS 4x4 grid requirement
  const columns = isLandscape ? 4 : (isTablet ? (showCart ? 2 : 4) : 2);
  const gap = isLandscape ? 6 : (isPhone ? 8 : 10);
  const cardWidth = isLandscape
    ? Math.floor((centerDishesWidth - 16 - gap * (columns - 1)) / columns)
    : Math.floor((usableWidth - 32 - gap * (columns - 1)) / columns);

  const renderTopBar = () => (
    <View
      style={[
        styles.topBar,
        isLandscape && { marginBottom: 6, height: 38 },
      ]}
    >
      <TouchableOpacity
        onPress={() => {
          const targetSec = orderContext?.section || "SECTION_1";
          router.replace(`/(tabs)/category?section=${targetSec}`);
        }}
        style={[
          styles.backBtn,
          isLandscape && { width: 38, height: 38, borderRadius: 10 },
        ]}
      >
        <Ionicons
          name="arrow-back"
          size={isLandscape ? 20 : 24}
          color={Theme.textPrimary}
        />
      </TouchableOpacity>
      <View
        style={[
          styles.searchWrap,
          isLandscape && { height: 38, flex: 0.8 },
        ]}
      >
        <Ionicons
          name="search"
          size={isLandscape ? 16 : 20}
          color={Theme.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          ref={searchInputRef}
          style={[
            styles.searchInput,
            isLandscape && { fontSize: 13 },
          ]}
          placeholder="Search items..."
          value={searchText}
          onChangeText={setSearchText}
          showSoftInputOnFocus={Platform.OS === "web" ? true : mobileSoftInputEnabled}
          onTouchStart={() => {
            if (Platform.OS !== "web" && !mobileSoftInputEnabled) {
              setMobileSoftInputEnabled(true);
            }
          }}
          onPressIn={() => {
            if (Platform.OS !== "web" && !mobileSoftInputEnabled) {
              setMobileSoftInputEnabled(true);
            }
          }}
          blurOnSubmit={false}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => clearSearch()}>
            <Ionicons name="close-circle" size={16} color={Theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.headerRightActions}>
        <WindowControls buttonStyle={styles.headerBillBtn} />
        <TouchableOpacity
          style={[
            styles.headerBillBtn,
            isLandscape && { width: 38, height: 38, borderRadius: 10 },
            menuLoading && { opacity: 0.5 },
          ]}
          onPress={handleForceRefresh}
          disabled={menuLoading}
        >
          {menuLoading ? (
            <ActivityIndicator size="small" color={Theme.primary} />
          ) : (
            <Ionicons
              name="refresh-outline"
              size={isLandscape ? 20 : 24}
              color={Theme.primary}
            />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.headerBillBtn,
            isLandscape && { width: 38, height: 38, borderRadius: 10 },
          ]}
          onPress={() => setShowReprintOptions(true)}
        >
          <Ionicons
            name="receipt-outline"
            size={isLandscape ? 20 : 24}
            color={Theme.primary}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.headerCartBtn,
            isLandscape && { width: 38, height: 38, borderRadius: 10 },
            showCart && { backgroundColor: Theme.primaryLight },
          ]}
          onPress={toggleCart}
        >
          <Ionicons
            name={showCart ? "cart" : "cart-outline"}
            size={isLandscape ? 20 : 24}
            color={Theme.primary}
          />
          <CartBadge isPhone={isPhone} isLandscape={isLandscape} />
        </TouchableOpacity>

        <View style={styles.topActions} />
      </View>
    </View>
  );

  const renderCategoryNav = () => (
    <View
      style={[
        styles.categoryNavigation,
        isPhone && isLandscape && { marginBottom: 6 },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catScroll}
      >
        {kitchens.map((k: any) => (
          <TouchableOpacity
            key={k.CategoryId}
            style={[
              styles.catPill,
              selectedKitchenId === k.CategoryId && styles.catPillActive,
              isPhone && isLandscape && { height: 36, paddingHorizontal: 16 },
            ]}
            onPress={() => loadGroups(k.CategoryId)}
          >
            <Text
              style={[
                styles.catText,
                selectedKitchenId === k.CategoryId && styles.catTextActive,
                isPhone && isLandscape && { fontSize: 13 },
              ]}
            >
              {k.KitchenTypeName}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View
        style={isPhone && isLandscape ? { marginTop: 12 } : { marginTop: 15 }}
      >
        {isInitialLoading ? (
          <GroupSkeleton />
        ) : groups.length === 0 ? (
          <View style={styles.emptyNavState}>
            <Text style={styles.emptyNavText}>No Dishgroup added</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupScroll}
          >
            {groups.map((g: any) => (
              <TouchableOpacity
                key={g.DishGroupId}
                style={[
                  styles.groupPill,
                  selectedGroup === g.DishGroupId && styles.groupPillActive,
                  isPhone &&
                  isLandscape && { height: 36, paddingHorizontal: 14 },
                ]}
                onPress={() => loadDishes(g.DishGroupId)}
              >
                <Text
                  style={[
                    styles.groupText,
                    selectedGroup === g.DishGroupId && styles.groupTextActive,
                    isPhone && isLandscape && { fontSize: 12 },
                  ]}
                >
                  {g.DishGroupName}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );

  const dismissKeyboard = () => Keyboard.dismiss();

  useEffect(() => {
    const newId = getContextId(orderContext);
    setCurrentContext(newId);
  }, [orderContext]);

  const handleForceRefresh = async () => {
    try {
      showToast({
        type: "info",
        message: "Refreshing Menu...",
        subtitle: "Syncing with database...",
      });
      await forceRefreshMenu();

      const currentKitchens = useMenuStore.getState().kitchens;
      const targetKitchenId =
        selectedKitchenId ||
        (currentKitchens.length > 0 ? currentKitchens[0].CategoryId : "");

      if (targetKitchenId) {
        const groupsData = await fetchGroups(targetKitchenId);
        setGroups(groupsData);

        const targetGroup =
          selectedGroup ||
          (groupsData.length > 0 ? groupsData[0].DishGroupId : "");
        if (targetGroup) {
          const dishesData = await fetchDishes(targetGroup);
          setItems(dishesData);
        }
      }
      showToast({
        type: "success",
        message: "Menu Refreshed",
        subtitle: "All configurations reloaded successfully",
      });
    } catch (err) {
      console.error("Failed to refresh menu:", err);
      showToast({
        type: "error",
        message: "Refresh Failed",
        subtitle: "Please try again",
      });
    }
  };

  useEffect(() => {
    const initMenu = async () => {
      setIsInitialLoading(true);
      await fetchMenu();
      const currentKitchens = useMenuStore.getState().kitchens;
      const currentDishGroups = useMenuStore.getState().dishGroups;
      if (currentKitchens.length > 0) {
        // Find first kitchen with available dish groups, or fall back to the first kitchen
        const firstActiveWithGroups = currentKitchens.find((k: any) => {
          const g = currentDishGroups[String(k.CategoryId)];
          return Array.isArray(g) && g.length > 0;
        });
        const initialKitchenId = firstActiveWithGroups ? firstActiveWithGroups.CategoryId : currentKitchens[0].CategoryId;
        await loadGroups(initialKitchenId);
      }
      setIsInitialLoading(false);
    };
    initMenu();
  }, []);

  const loadGroups = async (kitchenId: string) => {
    const kIdStr = String(kitchenId);
    if (selectedKitchenId === kIdStr && groups.length > 0) {
      requestSearchFocus();
      return;
    }
    setSelectedKitchenId(kIdStr);
    setCurrentPage(1);
    setCurrentGroupPage(1);
    requestSearchFocus();

    const store = useMenuStore.getState();
    let groupsData = store.dishGroups[kIdStr];
    if (!groupsData || groupsData.length === 0) {
      groupsData = await fetchGroups(kIdStr);
    }

    const currentGroups = Array.isArray(groupsData) ? groupsData : [];
    setGroups(currentGroups);

    if (currentGroups.length > 0) {
      loadDishes(currentGroups[0].DishGroupId);
    } else {
      setSelectedGroup("");
      setItems([]);
    }
  };

  const loadDishes = async (groupId: string) => {
    const gIdStr = String(groupId);
    if (selectedGroup === gIdStr && items.length > 0) {
      requestSearchFocus();
      return;
    }
    setSelectedGroup(gIdStr);
    setCurrentPage(1);
    requestSearchFocus();

    // 🚀 INSTANT SWITCH: Read from in-memory cache with zero flicker/refresh!
    const store = useMenuStore.getState();
    const cachedDishes = store.dishesByGroup[gIdStr];
    if (Array.isArray(cachedDishes)) {
      setItems(cachedDishes);
      return;
    }

    // Only if not found in cache, show brief loader and fetch
    setIsLoadingDishes(true);
    const dishesData = await fetchDishes(gIdStr);
    setItems(dishesData || []);
    setIsLoadingDishes(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const filteredItems = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    if (!query) return items;

    // Search across all dishes if query exists
    return allDishes.filter((d) => {
      const name = (d.Name || d.DishName || "").toLowerCase();
      const code = (d.DishCode || "").toLowerCase();
      const desc = (d.Description || "").toLowerCase();

      return (
        name.includes(query) || code.includes(query) || desc.includes(query)
      );
    });
  }, [debouncedSearch, items, allDishes]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / DISHES_PER_PAGE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  // In Previous/Next mode, slice to 16 items per page. In Scroll mode, show all filtered items.
  const displayedItems = useMemo(() => {
    if (menuNavigationMode === "prev_next") {
      const startIndex = (safePage - 1) * DISHES_PER_PAGE;
      return filteredItems.slice(startIndex, startIndex + DISHES_PER_PAGE);
    }
    return filteredItems;
  }, [menuNavigationMode, filteredItems, safePage]);

  // Dish Group Pagination Calculations
  const totalGroupPages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const safeGroupPage = Math.min(Math.max(1, currentGroupPage), totalGroupPages);

  // In Previous/Next mode, slice groups to GROUPS_PER_PAGE. In Scroll mode, show all groups.
  const displayedGroups = useMemo(() => {
    if (menuNavigationMode === "prev_next") {
      const startIndex = (safeGroupPage - 1) * GROUPS_PER_PAGE;
      return groups.slice(startIndex, startIndex + GROUPS_PER_PAGE);
    }
    return groups;
  }, [menuNavigationMode, groups, safeGroupPage]);

  const clearSearch = React.useCallback(() => {
    setSearchText("");
    setDebouncedSearch("");
    if (Platform.OS !== "web") {
      setMobileSoftInputEnabled(false);
    }
    requestSearchFocus();
  }, [requestSearchFocus]);

  const openModifiers = React.useCallback(
    async (dish: any) => {
      console.log("Dish Clicked", dish);
      try {
        const splitRes = await fetch(
          `${API_URL}/api/menu/checksplitdish/${dish.DishId}`
        );
        if (splitRes.ok) {
          const splitData = await splitRes.json();
          console.log("SplitData", splitData);
          if (splitData.IsGroupDish === true) {
            const res = await fetch(
              `${API_URL}/api/menu/splitdishes`
            );
            const data = await res.json();
            setSplitMembers(data);
            setSelectedSplitDish(dish);
            setShowSplitModal(true);
            return;
          }
        }
      } catch (err) {
        console.log("Split API Error", err);
      }

      // COMBO ITEM: Open wizard customizer instead of standard cart addition
      const isComboEnabled = useGeneralSettingsStore.getState().settings.enableCombo !== false;
      const isItCombo = isComboEnabled && (dish.IsCombo === true || String(dish.IsCombo) === "1" || String(dish.IsCombo) === "true");
      if (isItCombo) {
        setComboDish(dish);
        setShowComboModal(true);
        return;
      }

      const currentKitchen = kitchens.find(
        (k) => k.CategoryId === selectedKitchenId,
      );
      const currentKitchenName = currentKitchen?.KitchenTypeName || "KITCHEN";
      const currentKitchenCode =
        currentKitchen?.KitchenTypeCode || String(selectedKitchenId || "0");

      const addToCartSimple = (overridePrice?: number) => {
        addToCartGlobal({
          id: dish.DishId,
          name: dish.Name,
          price: overridePrice !== undefined ? overridePrice : (dish.Price || 0),
          categoryName: currentKitchenName,
          KitchenTypeName: dish.KitchenTypeName || currentKitchenName,
          PrinterIP: dish.PrinterIP,
          KitchenTypeCode: dish.KitchenTypeCode || currentKitchenCode,
          isServiceCharge: dish.isServiceCharge,
          IsOpenItem: dish.IsOpenItem,
          takeawayCharge: dish.takeawayCharge ?? dish.TakeawayCharge,
        });
        clearSearch();
      };

      // OPEN ITEM: Prompt for custom price before doing anything else
      const isItOpenItem = Number(dish.IsOpenItem) === 1 || dish.IsOpenItem === true || dish.IsOpenItem === 'true' || dish.IsOpenItem === '1';
      if (isItOpenItem) {
        setOpenItemDish({
          ...dish,
          _kitchenName: currentKitchenName,
          _kitchenCode: currentKitchenCode,
        });
        setOpenItemPrice(dish.Price > 0 ? String(dish.Price) : "");
        setOpenItemError("");
        setShowOpenItemModal(true);
        return; // Wait for user to confirm price
      }

      const cachedData = modifierCache[dish.DishId];
      if (cachedData) {
        if (cachedData.length > 0) {
          setSelectedDish(dish);
          setSelectedModifierQuantities({});
          setCustomMods([]);
          setModifiers(cachedData);
          setShowModifier(true);
        } else {
          addToCartSimple();
        }
        return;
      }

      // Prevent concurrent fetches for the same dish
      if (fetchingModifiers.current.has(dish.DishId)) return;
      fetchingModifiers.current.add(dish.DishId);

      // No need to set isAdding state for UI blocking
      setLoadingModifiers(true);
      setSelectedDish(dish);
      setSelectedModifierQuantities({});
      setCustomMods([]);

      try {
        const res = await fetch(`${API_URL}/api/menu/modifiers/${dish.DishId}`);
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          setModifiers(data);
          setShowModifier(true);
        } else {
          addToCartSimple();
        }
      } catch (err) {
        addToCartSimple();
      } finally {
        // Remove dishId from fetching set after fetch completes
        fetchingModifiers.current.delete(dish.DishId);
        setLoadingModifiers(false);
      }
    },
    [selectedKitchenId, kitchens, modifierCache],
  );

  // ─── 🔲 BARCODE SCANNER INTEGRATION ───────────────────────────────────────
  // Scans barcode -> triggers openModifiers(dish).
  // If item has modifiers/combos/options -> pops up modifier modal!
  // If simple item -> adds to cart immediately.
  useBarcodeScanner({
    onSuccess: (dish: any) => {
      openModifiers(dish);
    },
    onError: (msg: string) => {
      showToast({ type: 'error', message: msg, duration: 2500 });
    },
  });
  // ──────────────────────────────────────────────────────────────────────────

  // Group modifiers dynamically
  const groupedModifiers = React.useMemo(() => {
    const groupsMap: Record<string, {
      groupId: string;
      groupName: string;
      minSelect: number;
      maxSelect: number;
      multiselect: boolean;
      items: any[];
    }> = {};

    const allMods = [...modifiers, ...customMods];

    allMods.forEach((m) => {
      const gId = m.ModifierGroupId || "general";
      const gName = m.ModifierGroupName || "General Modifiers";
      const minS = m.MinSelectionCount !== undefined ? Number(m.MinSelectionCount) : 0;
      const maxS = m.MaxSelectionCount !== undefined ? Number(m.MaxSelectionCount) : 0;
      const multi = m.MultiselectAllow === 1 || m.MultiselectAllow === true || m.MultiselectAllow === "1" || m.MultiselectAllow === "true";

      if (!groupsMap[gId]) {
        groupsMap[gId] = {
          groupId: gId,
          groupName: gName,
          minSelect: minS,
          maxSelect: maxS,
          multiselect: multi,
          items: [],
        };
      }
      if (!groupsMap[gId].items.some(x => String(x.ModifierID) === String(m.ModifierID))) {
        groupsMap[gId].items.push(m);
      }
    });

    return Object.values(groupsMap);
  }, [modifiers, customMods]);

  const adjustModifierQuantity = (mod: any, gId: string, delta: number) => {
    const key = `${mod.ModifierID}_${gId}`;

    const group = groupedModifiers.find(g => g.groupId === gId);
    const maxSelect = group ? group.maxSelect : 0;
    const multiselect = group ? group.multiselect : false;

    const groupSelectedCount = Object.entries(selectedModifierQuantities)
      .filter(([k]) => k.endsWith(`_${gId}`))
      .reduce((sum, [, qty]) => sum + qty, 0);

    setSelectedModifierQuantities((prev) => {
      const currentQty = prev[key] || 0;
      let newQty = currentQty + delta;
      if (newQty < 0) newQty = 0;

      if (!multiselect && newQty > 1) {
        newQty = 1;
      }

      if (delta > 0 && maxSelect > 0) {
        if (groupSelectedCount + delta > maxSelect) {
          showToast({ type: "error", message: `You can select at most ${maxSelect} items in ${group?.groupName}.` });
          return prev;
        }
      }

      const next = { ...prev };
      if (newQty === 0) {
        delete next[key];
      } else {
        next[key] = newQty;
      }
      return next;
    });
  };

  const openModifiersRef = React.useRef(openModifiers);
  openModifiersRef.current = openModifiers;
  const handleDishPress = React.useCallback((dish: any) => {
    openModifiersRef.current(dish);
  }, []);

  const renderDishItem = React.useCallback(
    ({ item }: { item: any }) => {
      return (
        <DishCardWrapper
          item={item}
          width={cardWidth}
          onPress={handleDishPress}
          isPhone={isPhone}
          isTablet={isTablet}
          isLandscape={isLandscape}
        />
      );
    },
    [cardWidth, handleDishPress, isPhone, isTablet, isLandscape],
  );

  const toggleModifier = (mod: any) => {
    if (mod.isOpenModifier === 1 || mod.isOpenModifier === true) {
      setShowCustomModal(true);
      return;
    }

    const gId = mod.ModifierGroupId || "general";
    const key = `${mod.ModifierID}_${gId}`;
    const isSelected = !!selectedModifierQuantities[key];

    if (isSelected) {
      adjustModifierQuantity(mod, gId, -1);
    } else {
      adjustModifierQuantity(mod, gId, 1);
    }
  };

  const addCustomMod = () => {
    if (!customItemName) return;
    const newId = `custom-${Date.now()}`;
    const newMod = {
      ModifierID: newId,
      ModifierName: customItemName,
      Price: parseFloat(customItemPrice) || 0,
      ModifierGroupId: "general",
      ModifierGroupName: "General Modifiers",
      MinSelectionCount: 0,
      MaxSelectionCount: 0,
      MultiselectAllow: 0
    };

    setCustomMods((prev) => [...prev, newMod]);
    setSelectedModifierQuantities((prev) => ({
      ...prev,
      [`${newId}_general`]: 1
    }));

    setShowCustomModal(false);
    setCustomItemName("");
    setCustomItemPrice("");
  };

  const addWithModifiers = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (selectedDish) {
      const allAvailable = [...modifiers, ...customMods];

      // Validate Min Selection Count
      for (const group of groupedModifiers) {
        if (group.minSelect > 0) {
          const groupSelectedCount = Object.entries(selectedModifierQuantities)
            .filter(([k]) => k.endsWith(`_${group.groupId}`))
            .reduce((sum, [, qty]) => sum + qty, 0);

          if (groupSelectedCount < group.minSelect) {
            alert(`Please select at least ${group.minSelect} items from ${group.groupName}.`);
            return;
          }
        }
      }

      const modsToAdd: any[] = [];
      Object.entries(selectedModifierQuantities).forEach(([key, qty]) => {
        if (qty <= 0) return;
        const [modId] = key.split("_");
        const m = allAvailable.find((x) => String(x.ModifierID) === String(modId));
        if (m) {
          modsToAdd.push({
            ModifierId: String(m.ModifierID || m.ModifierId || ""),
            ModifierName: m.ModifierName,
            Price: Number(m.Price || 0),
            qty: qty,
          });
        }
      });

      const extra = modsToAdd.reduce((sum, m) => sum + (m.Price || 0) * (m.qty || 1), 0);
      const finalPrice = (selectedDish.Price || 0) + extra;

      const currentKitchen = kitchens.find(
        (k) => k.CategoryId === selectedKitchenId,
      );
      const currentKitchenName = currentKitchen?.KitchenTypeName || "Kitchen";
      const currentKitchenCode =
        currentKitchen?.KitchenTypeCode || selectedKitchenId;

      addToCartGlobal({
        id: selectedDish.DishId,
        name: selectedDish.Name,
        price: finalPrice,
        modifiers: modsToAdd as any,
        basePrice: selectedDish.Price || 0,
        categoryName: currentKitchenName, // Grouping by Kitchen Name
        KitchenTypeName: selectedDish.KitchenTypeName || currentKitchenName,
        PrinterIP: selectedDish.PrinterIP,
        KitchenTypeCode: selectedDish.KitchenTypeCode || currentKitchenCode,
        splitMembers: selectedDish.splitMembers || undefined,
        isServiceCharge: selectedDish.isServiceCharge,
        takeawayCharge: selectedDish.takeawayCharge ?? selectedDish.TakeawayCharge,
      } as any);

    }
    setShowModifier(false);
    clearSearch();
  };

  // OPEN ITEM: Validate and add to cart at custom price
  const confirmOpenItemPrice = () => {
    const trimmed = openItemPrice.trim();
    if (!trimmed || trimmed === "") {
      setOpenItemError("Please enter a price.");
      return;
    }
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed) || parsed < 0) {
      setOpenItemError("Enter a valid non-negative number.");
      return;
    }
    if (parsed === 0) {
      setOpenItemError("Price cannot be zero.");
      return;
    }

    const dish = openItemDish;
    if (!dish) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addToCartGlobal({
      id: dish.DishId,
      name: dish.Name,
      price: parsed,
      categoryName: dish._kitchenName,
      KitchenTypeName: dish.KitchenTypeName || dish._kitchenName,
      PrinterIP: dish.PrinterIP,
      KitchenTypeCode: dish.KitchenTypeCode || dish._kitchenCode,
      IsOpenItem: dish.IsOpenItem,
      isServiceCharge: dish.isServiceCharge,
      takeawayCharge: dish.takeawayCharge ?? dish.TakeawayCharge,
    });

    // Reset
    setShowOpenItemModal(false);
    setOpenItemDish(null);
    setOpenItemPrice("");
    setOpenItemError("");
    clearSearch();
  };

  if (!orderContext) return null;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={{ flex: 1 }}>
        {isLandscape ? (
          <View style={styles.layout}>
            {/* 3-COLUMN MAIN BODY: Matches Quick Serve POS Structure */}
            <View style={styles.main3Column}>
              {/* TOP BAR */}
              {renderTopBar()}

              {/* KITCHEN TYPE SELECTION ROW — Separate horizontal section above menu containers */}
              <View style={styles.kitchenTabsBar}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.catScroll}
                >
                  {kitchens.map((k: any) => (
                    <TouchableOpacity
                      key={k.CategoryId}
                      style={[
                        styles.catPill,
                        selectedKitchenId === k.CategoryId && styles.catPillActive,
                      ]}
                      onPress={() => loadGroups(k.CategoryId)}
                    >
                      <Text
                        style={[
                          styles.catText,
                          selectedKitchenId === k.CategoryId && styles.catTextActive,
                        ]}
                      >
                        {k.KitchenTypeName}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* 3 COLUMNS CONTAINER */}
              <View style={styles.columnsRow}>
                {/* ================= COLUMN 1: LEFT SIDE → DISH GROUPS ================= */}
                <View style={[styles.leftGroupsColumn, { width: groupsColumnWidth }]}>
                  {/* DISH GROUPS HEADER */}
                  <View style={styles.groupsHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons
                        name="restaurant-outline"
                        size={16}
                        color={Theme.primary}
                      />
                      <Text style={styles.groupsHeaderTitle}>Dish Groups</Text>
                    </View>
                  </View>

                  {/* DISH GROUPS VERTICAL 2-COLUMN LIST WITH UP/DOWN SCROLL BUTTONS */}
                  <View style={styles.dishGroupPanelBody}>
                    {isInitialLoading ? (
                      <View style={{ padding: 12 }}>
                        <GroupSkeleton />
                      </View>
                    ) : groups.length === 0 ? (
                      <View style={styles.emptyGroupPanelState}>
                        <Ionicons
                          name="restaurant-outline"
                          size={40}
                          color={Theme.textMuted}
                        />
                        <Text style={styles.emptyGroupPanelText}>No dish groups available for this kitchen.</Text>
                      </View>
                    ) : (
                      <>
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
                            {displayedGroups.map((group) => {
                              const isGroupActive = selectedGroup === String(group.DishGroupId);
                              const groupName = group.DishGroupName;
                              const count = getDishGroupCount(group.DishGroupId);

                              return (
                                <TouchableOpacity
                                  key={group.DishGroupId}
                                  style={[
                                    styles.dishGroupCard2Col,
                                    isGroupActive && styles.dishGroupCard2ColActive,
                                  ]}
                                  onPress={() => loadDishes(group.DishGroupId)}
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
                                <Ionicons
                                  name="chevron-up"
                                  size={14}
                                  color={isDishGroupAtTop ? "#CBD5E1" : "#334155"}
                                />
                              </TouchableOpacity>

                              <View style={styles.singleScrollDivider} />

                              <TouchableOpacity
                                style={[styles.singleScrollHalf, isDishGroupAtBottom && styles.scrollBtnDisabled]}
                                onPress={() => scrollDishGroupsVertically("down")}
                                disabled={isDishGroupAtBottom}
                                activeOpacity={0.7}
                              >
                                <Ionicons
                                  name="chevron-down"
                                  size={14}
                                  color={isDishGroupAtBottom ? "#CBD5E1" : "#334155"}
                                />
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}
                      </>
                    )}
                  </View>

                  {/* DISH GROUPS PAGINATION BAR (ONLY IN PREVIOUS / NEXT MODE) */}
                  {menuNavigationMode === "prev_next" && groups.length > 0 && (
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
                            color={safeGroupPage <= 1 ? "#94A3B8" : Theme.primary}
                          />
                          <Text style={[styles.paginationBtnText, safeGroupPage <= 1 && styles.paginationBtnTextDisabled]}>
                            Prev
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.paginationCenter}>
                        <Text style={styles.paginationText}>
                          <Text style={styles.paginationCurrentText}>{safeGroupPage}</Text>
                          <Text style={styles.paginationSubtext}> / </Text>
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
                            color={safeGroupPage >= totalGroupPages ? "#94A3B8" : Theme.primary}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>

                {/* ================= COLUMN 2: CENTER → DISH ITEMS ================= */}
                <View style={styles.centerDishesColumn}>
                  {/* DISHES PANEL HEADER */}
                  <View style={styles.dishesHeaderRow}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Ionicons
                        name="restaurant"
                        size={18}
                        color={Theme.primary}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.dishesHeaderTitle}>
                        {debouncedSearch.trim()
                          ? `Search Results for "${debouncedSearch.trim()}"`
                          : selectedGroup
                          ? `${groups.find((g) => String(g.DishGroupId) === String(selectedGroup))?.DishGroupName || "Dish Group"} Dishes`
                          : "Menu Dishes"}
                      </Text>
                      {filteredItems.length > 0 && (
                        <View style={styles.dishCountBadge}>
                          <Text style={styles.dishCountBadgeText}>
                            {filteredItems.length}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* DISHES GRID AREA */}
                  <View style={styles.gridContainer}>
                    {isLoadingDishes || isInitialLoading ? (
                      <DishGridSkeleton
                        cardWidth={cardWidth}
                        columns={columns}
                        gap={gap}
                        isPhone={isPhone}
                      />
                    ) : (
                      <FlatList
                        ref={dishesScrollRef}
                        data={displayedItems}
                        keyExtractor={(item, index) =>
                          item.DishId || `dish-${index}`
                        }
                        numColumns={columns}
                        key={`grid-${columns}`}
                        renderItem={renderDishItem}
                        scrollEnabled={menuNavigationMode === "scroll"}
                        columnWrapperStyle={
                          columns > 1 ? { gap: gap, marginBottom: isLandscape ? 3 : gap } : undefined
                        }
                        getItemLayout={(data, index) => ({
                          length: isLandscape ? 101 : 150,
                          offset: (isLandscape ? 101 : 150) * Math.floor(index / columns),
                          index,
                        })}
                        removeClippedSubviews={Platform.OS === "android"}
                        initialNumToRender={16}
                        maxToRenderPerBatch={16}
                        windowSize={5}
                        contentContainerStyle={[
                          isLandscape ? styles.dishesListLandscapePadding : styles.listPadding,
                          (columns as number) === 1 && { gap: gap },
                          filteredItems.length === 0 && {
                            flex: 1,
                            justifyContent: "center",
                          },
                        ]}
                        showsVerticalScrollIndicator={menuNavigationMode === "scroll"}
                        ListEmptyComponent={
                          !isLoadingDishes && !isInitialLoading ? (
                            <View style={styles.emptyItemsState}>
                              <Ionicons
                                name="restaurant-outline"
                                size={56}
                                color={Theme.textMuted}
                              />
                              <Text style={styles.emptyItemsText}>
                                {groups.length === 0
                                  ? "No dishes available for this kitchen"
                                  : "No dish items added"}
                              </Text>
                            </View>
                          ) : null
                        }
                      />
                    )}
                  </View>

                  {/* QUICK SERVE STYLE PAGINATION BAR (ONLY IN PREVIOUS / NEXT MODE) */}
                  {menuNavigationMode === "prev_next" && filteredItems.length > 0 && (
                    <View style={styles.dishesPaginationBar}>
                      <View style={styles.paginationLeft}>
                        {safePage > 1 && (
                          <TouchableOpacity
                            style={styles.paginationBtn}
                            onPress={() => handlePageChange(safePage - 1)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="chevron-back" size={16} color={Theme.primary} />
                            <Text style={styles.paginationBtnText}>
                              Previous
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      <View style={styles.paginationCenter}>
                        <Text style={styles.paginationText}>
                          Page <Text style={styles.paginationCurrentText}>{safePage}</Text> of{" "}
                          <Text style={styles.paginationTotalText}>{totalPages}</Text>
                          <Text style={styles.paginationSubtext}>
                            {"  "}({Math.min(filteredItems.length, (safePage - 1) * DISHES_PER_PAGE + 1)}-
                            {Math.min(filteredItems.length, safePage * DISHES_PER_PAGE)} of {filteredItems.length})
                          </Text>
                        </Text>
                      </View>

                      <View style={styles.paginationRight}>
                        <TouchableOpacity
                          style={[styles.paginationBtn, safePage >= totalPages && styles.paginationBtnDisabled]}
                          onPress={() => {
                            if (safePage < totalPages) handlePageChange(safePage + 1);
                          }}
                          disabled={safePage >= totalPages}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.paginationBtnText, safePage >= totalPages && styles.paginationBtnTextDisabled]}>
                            Next
                          </Text>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={safePage >= totalPages ? "#94A3B8" : Theme.primary}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </View>

            {/* ================= COLUMN 3: RIGHT SIDE → CART ================= */}
            {showCart && <CartSidebar width={cartWidth} />}
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: Theme.bgMain }}>
            {/* TAB/PHONE LAYOUT - Hawker Style */}
            <View style={{ padding: isPhone ? 10 : 20, paddingBottom: 0 }}>
              {renderTopBar()}
              {renderCategoryNav()}
            </View>

            <View style={[styles.layout, { flex: 1 }]}>
              <View
                style={[
                  styles.main,
                  {
                    width: mainWidth,
                    paddingTop: 0,
                    paddingHorizontal: isPhone ? 10 : 20,
                  },
                ]}
              >
                <View style={styles.gridContainer}>
                  {isLoadingDishes || isInitialLoading ? (
                    <DishGridSkeleton
                      cardWidth={cardWidth}
                      columns={columns}
                      gap={gap}
                      isPhone={isPhone}
                    />
                  ) : (
                    <FlatList
                      data={filteredItems}
                      keyExtractor={(item) => item.DishId}
                      numColumns={columns}
                      key={columns}
                      renderItem={renderDishItem}
                      columnWrapperStyle={
                        columns > 1
                          ? { gap: gap, marginBottom: gap }
                          : undefined
                      }
                      contentContainerStyle={[
                        styles.listPadding,
                        (columns as number) === 1 && { gap: gap },
                        filteredItems.length === 0 && {
                          flex: 1,
                          justifyContent: "center",
                        },
                      ]}
                      getItemLayout={(data, index) => ({
                        length: 150, // Fixed height estimate
                        offset: 150 * Math.floor(index / columns),
                        index,
                      })}
                      removeClippedSubviews={Platform.OS !== "web"}
                      initialNumToRender={columns * 5}
                      maxToRenderPerBatch={columns * 3}
                      windowSize={5}
                      showsVerticalScrollIndicator={false}
                      ListEmptyComponent={
                        !isLoadingDishes && !isInitialLoading ? (
                          <View style={styles.emptyItemsState}>
                            <Ionicons
                              name="restaurant-outline"
                              size={64}
                              color={Theme.textMuted}
                            />
                            <Text style={styles.emptyItemsText}>
                              No dish items added
                            </Text>
                          </View>
                        ) : null
                      }
                    />
                  )}
                </View>
              </View>
              {showCart && <CartSidebar width={cartWidth} />}
            </View>
          </View>
        )}

        {showSplitModal && (
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { height: "80%" }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {selectedSplitDish?.Name}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setShowSplitModal(false);
                    requestSearchFocus();
                  }}
                  style={styles.modalClose}
                >
                  <Ionicons
                    name="close"
                    size={20}
                    color={Theme.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 15,
                }}
              >
                <Text
                  style={{
                    width: 100,
                    fontSize: 14,
                    fontWeight: "600",
                    color: "#333",
                  }}
                >
                  Amount
                </Text>

                <TextInput
                  placeholder="Enter Amount"
                  value={splitAmount}
                  onChangeText={setSplitAmount}
                  keyboardType="numeric"
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: "#ddd",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    height: 45,
                  }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 15,
                }}
              >
                <Text
                  style={{
                    width: 100,
                    fontSize: 14,
                    fontWeight: "600",
                    color: "#333",
                  }}
                >
                  Song Name
                </Text>

                <TextInput
                  placeholder="Enter Song Name"
                  value={songName}
                  onChangeText={setSongName}
                  style={{
                    flex: 1,
                    borderWidth: 1,
                    borderColor: "#ddd",
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    height: 45,
                  }}
                />
              </View>

              {/* Scrollable List */}
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={true}
              >
                {splitMembers.map((item, index) => (
                  <View
                    key={index}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: "#eee",
                    }}
                  >
                    <Text>{item.Name}</Text>

                    <TouchableOpacity
                      onPress={() => {
                        const updated = [...splitMembers];
                        updated[index].IsSelected =
                          !updated[index].IsSelected;
                        setSplitMembers(updated);
                      }}
                    >
                      <Ionicons
                        name={
                          item.IsSelected
                            ? "checkbox"
                            : "square-outline"
                        }
                        size={22}
                        color="green"
                      />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>

              {/* Fixed Done Button */}
              <TouchableOpacity
                style={{
                  backgroundColor: "#22c55e",
                  paddingVertical: 12,
                  borderRadius: 10,
                  marginTop: 15,
                  alignItems: "center",
                }}
                onPress={() => {
                  const selected = splitMembers.filter(
                    (x) => x.IsSelected
                  );

                  if (selected.length === 0) {
                    alert("Please select at least one member");
                    return;
                  }

                  const totalAmount = parseFloat(splitAmount || "0");

                  if (totalAmount <= 0) {
                    alert("Please enter amount");
                    return;
                  }

                  if (!songName.trim()) {
                    alert("Please enter song name");
                    return;
                  }

                  const shareAmount =
                    totalAmount / selected.length;

                  selected.forEach((member) => {
                    console.log({
                      id: member.DishId,
                      name: `${selectedSplitDish.Name} - ${member.Name}`,
                      songName: songName,
                      price: shareAmount,
                    });
                    addToCartGlobal({
                      id: member.DishId,
                      name: `${selectedSplitDish.Name} - ${member.Name}`,
                      songName: songName,
                      price: shareAmount,
                      takeawayCharge: selectedSplitDish.takeawayCharge ?? selectedSplitDish.TakeawayCharge,
                    } as any);
                  });

                  setShowSplitModal(false);
                  clearSearch();
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontWeight: "bold",
                    fontSize: 16,
                  }}
                >
                  DONE
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* MODIFIER MODAL (Screenshot 1 Style) */}
        {showModifier && selectedDish && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <Text style={[styles.modalTitle, { fontSize: 18 }]} numberOfLines={2}>
                    Modifiers {selectedDish.Name} {groupedModifiers.length === 1 && (
                      <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
                        {groupedModifiers[0].minSelect > 0 && groupedModifiers[0].maxSelect > 0 && ` (Select ${groupedModifiers[0].minSelect} to ${groupedModifiers[0].maxSelect})`}
                        {groupedModifiers[0].minSelect > 0 && groupedModifiers[0].maxSelect === 0 && ` (Select at least ${groupedModifiers[0].minSelect})`}
                        {groupedModifiers[0].minSelect === 0 && groupedModifiers[0].maxSelect > 0 && ` (Select up to ${groupedModifiers[0].maxSelect})`}
                        {groupedModifiers[0].minSelect === 0 && groupedModifiers[0].maxSelect === 0 && ` (Optional)`}
                      </Text>
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowModifier(false);
                    requestSearchFocus();
                  }}
                  style={styles.modalClose}
                >
                  <Ionicons
                    name="close"
                    size={20}
                    color={Theme.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                {loadingModifiers ? (
                  <ActivityIndicator color={Theme.primary} size="large" />
                ) : (
                  <ScrollView
                    style={styles.modifierList}
                    showsVerticalScrollIndicator={false}
                  >
                    {groupedModifiers.map((group) => {
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
                          {groupedModifiers.length > 1 && (
                            <View style={styles.modifierGroupHeader}>
                              <Text style={styles.modifierGroupName}>{gName}</Text>
                              <Text style={styles.modifierGroupLimits}>
                                {minSelect > 0 && maxSelect > 0 && `(Select ${minSelect} to ${maxSelect})`}
                                {minSelect > 0 && maxSelect === 0 && `(Select at least ${minSelect})`}
                                {minSelect === 0 && maxSelect > 0 && `(Select up to ${maxSelect})`}
                                {minSelect === 0 && maxSelect === 0 && `(Optional)`}
                                {` - Selected: ${groupSelectedCount}`}
                              </Text>
                            </View>
                          )}
                          <View style={styles.modifierGrid}>
                            {group.items.map((m) => {
                              const key = `${m.ModifierID}_${gId}`;
                              const qty = selectedModifierQuantities[key] || 0;
                              const isSelected = qty > 0;
                              const isDisabled = maxSelect > 0 && groupSelectedCount >= maxSelect && qty === 0;

                              return (
                                <TouchableOpacity
                                  key={m.ModifierID}
                                  style={[
                                    styles.modifierCard,
                                    isSelected && styles.modifierCardSelected,
                                    isDisabled && { opacity: 0.5 }
                                  ]}
                                  onPress={() => {
                                    if (isSelected || !isDisabled) {
                                      if (multiselect) {
                                        adjustModifierQuantity(m, gId, isSelected ? -1 : 1);
                                      } else {
                                        toggleModifier(m);
                                      }
                                    }
                                  }}
                                  disabled={isDisabled}
                                  activeOpacity={0.7}
                                >
                                  <Text style={[styles.modifierCardName, isSelected && styles.modifierCardTextSelected]}>
                                    {m.ModifierName}
                                  </Text>
                                  {m.Price > 0 && (
                                    <Text style={[styles.modifierCardPrice, isSelected && styles.modifierCardTextSelected]}>
                                      +${Number(m.Price).toFixed(2)}
                                    </Text>
                                  )}
                                  {isSelected && (
                                    <View style={styles.modifierCheckmarkWrap}>
                                      <Ionicons
                                        name="checkmark-circle"
                                        size={18}
                                        color={Theme.primary}
                                      />
                                    </View>
                                  )}

                                  {multiselect && isSelected ? (
                                    <View style={styles.modifierCardQtyContainer}>
                                      <TouchableOpacity
                                        onPress={(e) => {
                                          e.stopPropagation();
                                          adjustModifierQuantity(m, gId, -1);
                                        }}
                                        style={styles.modifierCardQtyBtn}
                                      >
                                        <Ionicons name="remove" size={12} color={Theme.primary} />
                                      </TouchableOpacity>
                                      <Text style={styles.modifierCardQtyText}>{qty}</Text>
                                      <TouchableOpacity
                                        onPress={(e) => {
                                          e.stopPropagation();
                                          adjustModifierQuantity(m, gId, 1);
                                        }}
                                        disabled={isDisabled}
                                        style={[styles.modifierCardQtyBtn, isDisabled && { borderColor: '#ddd' }]}
                                      >
                                        <Ionicons name="add" size={12} color={isDisabled ? '#ccc' : Theme.primary} />
                                      </TouchableOpacity>
                                    </View>
                                  ) : null}
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

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalBtnCancel}
                  onPress={() => {
                    setShowModifier(false);
                    requestSearchFocus();
                  }}
                >
                  <Text style={styles.modalBtnTextCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalBtnAdd,
                    { backgroundColor: Theme.success },
                  ]}
                  onPress={addWithModifiers}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                  <Text style={styles.modalBtnTextAdd}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ADD CUSTOM ITEM SUB-MODAL (Screenshot 2 Style) */}
            {showCustomModal && (
              <View
                style={[
                  styles.modalOverlay,
                  { zIndex: 2000, backgroundColor: "rgba(0,0,0,0.8)" },
                ]}
              >
                <View style={styles.customItemModal}>
                  <Text style={styles.customModalTitle}>Add Custom Item</Text>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Item Name *</Text>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter item name"
                      placeholderTextColor="#666"
                      value={customItemName}
                      onChangeText={setCustomItemName}
                      autoFocus
                    />
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Price (Optional)</Text>
                    <TextInput
                      style={styles.customInput}
                      placeholder="Enter price"
                      placeholderTextColor="#666"
                      keyboardType="numeric"
                      value={customItemPrice}
                      onChangeText={setCustomItemPrice}
                    />
                  </View>

                  <View style={styles.customModalActions}>
                    <TouchableOpacity
                      style={styles.customBtnCancel}
                      onPress={() => setShowCustomModal(false)}
                    >
                      <Text style={styles.customBtnTextCancel}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.customBtnAdd}
                      onPress={addCustomMod}
                    >
                      <Text style={styles.customBtnTextAdd}>Add Item</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </View>
      <Modal transparent visible={showReprintOptions} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowReprintOptions(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { maxWidth: 300 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Reprint</Text>
                  <TouchableOpacity
                    onPress={() => setShowReprintOptions(false)}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.reprintOption}
                  onPress={handleReprintKOT}
                >
                  <View
                    style={[
                      styles.reprintIcon,
                      { backgroundColor: Theme.primaryLight },
                    ]}
                  >
                    <Ionicons
                      name="print-outline"
                      size={20}
                      color={Theme.primary}
                    />
                  </View>
                  <Text style={styles.reprintText}>KOT Reprint</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reprintOption}
                  onPress={handleReprintBill}
                >
                  <View
                    style={[
                      styles.reprintIcon,
                      { backgroundColor: Theme.successBg },
                    ]}
                  >
                    <Ionicons
                      name="receipt-outline"
                      size={20}
                      color={Theme.success}
                    />
                  </View>
                  <Text style={styles.reprintText}>Bill Reprint</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* OPEN ITEM PRICE MODAL */}
      <Modal
        transparent
        visible={showOpenItemModal}
        animationType="fade"
        onRequestClose={() => setShowOpenItemModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowOpenItemModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.customItemModal}>
                {/* Header */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <Text style={styles.customModalTitle}>Enter Price</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowOpenItemModal(false);
                      requestSearchFocus();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={22} color={Theme.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* Dish name */}
                <Text
                  style={{
                    fontFamily: Fonts.medium,
                    fontSize: 13,
                    color: Theme.textSecondary,
                    marginBottom: 16,
                  }}
                  numberOfLines={2}
                >
                  {openItemDish?.Name}
                </Text>

                {/* Price input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Custom Price *</Text>
                  <TextInput
                    style={[
                      styles.customInput,
                      openItemError
                        ? { borderColor: Theme.danger, borderWidth: 1.5 }
                        : {},
                    ]}
                    placeholder={
                      openItemDish?.Price > 0
                        ? `Default: ${openItemDish.Price}`
                        : "Enter price"
                    }
                    placeholderTextColor="#999"
                    keyboardType="decimal-pad"
                    value={openItemPrice}
                    onChangeText={(t) => {
                      setOpenItemPrice(t);
                      setOpenItemError("");
                    }}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={confirmOpenItemPrice}
                  />
                  {openItemError ? (
                    <Text
                      style={{
                        color: Theme.danger,
                        fontSize: 11,
                        fontFamily: Fonts.medium,
                        marginTop: 4,
                      }}
                    >
                      {openItemError}
                    </Text>
                  ) : null}
                </View>

                {/* Actions */}
                <View style={styles.customModalActions}>
                  <TouchableOpacity
                    style={styles.customBtnCancel}
                    onPress={() => {
                      setShowOpenItemModal(false);
                      requestSearchFocus();
                    }}
                  >
                    <Text style={styles.customBtnTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.customBtnAdd}
                    onPress={confirmOpenItemPrice}
                  >
                    <Text style={styles.customBtnTextAdd}>Add to Cart</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
      <ComboCustomizer
        visible={showComboModal}
        onClose={() => {
          setShowComboModal(false);
          setComboDish(null);
          requestSearchFocus();
        }}
        onSuccess={clearSearch}
        dish={comboDish}
        kitchenName={kitchens.find((k) => k.CategoryId === selectedKitchenId)?.KitchenTypeName || "KITCHEN"}
        kitchenCode={kitchens.find((k) => k.CategoryId === selectedKitchenId)?.KitchenTypeCode || String(selectedKitchenId || "0")}
      />
    </SafeAreaView>
  );
}

const full = 999;
const styles = StyleSheet.create({
  reprintOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.bgMain,
    gap: 12,
  },
  reprintText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  reprintIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  safe: { flex: 1, backgroundColor: Theme.bgMain },
  layout: { flex: 1, flexDirection: "row" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  rail: {
    width: 90,
    backgroundColor: "#fff",
    borderRightWidth: 1,
    borderRightColor: Theme.border,
    alignItems: "center",
    paddingVertical: 20,
  },
  railTop: { flex: 1, gap: 20 },
  railItem: {
    width: 64,
    height: 64,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
  },
  railItemActive: { backgroundColor: Theme.bgMain },
  railLabel: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginTop: 4,
  },
  railLabelActive: { color: Theme.primary },
  railBottom: { gap: 20, alignItems: "center" },
  logoutBtn: { alignItems: "center" },
  main: {
    flex: 1,
    padding: 12,
    ...Platform.select({
      web: {
        transitionProperty: "width",
        transitionDuration: "0.3s",
        transitionTimingFunction: "ease-in-out",
      } as any,
    }),
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  searchWrap: {
    flex: 0.7,
    height: 48,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    ...Theme.shadowSm,
  },
  searchIcon: { marginRight: 10 },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  topActions: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  categoryNavigation: { marginBottom: 15 },
  catScroll: { gap: 10 },
  catPill: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
  },
  catPillActive: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primary,
    borderWidth: 1.5,
    ...Theme.shadowSm,
  },
  catText: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary },
  catTextActive: { color: Theme.primary },
  groupScroll: { gap: 8 },
  groupPill: {
    paddingHorizontal: 16,
    height: 38,
    borderRadius: full,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
  },
  groupPillActive: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: Theme.primary,
    ...Theme.shadowSm,
  },
  groupText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  groupTextActive: { color: Theme.textPrimary, fontFamily: Fonts.bold },
  gridContainer: { flex: 1 },
  listPadding: { paddingBottom: 80 },
  card: {
    position: "relative",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 10,
    alignItems: "center",
    ...Theme.shadowMd,
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
  dishImageWrap: {
    width: 70,
    height: 70,
    borderRadius: 35,
    overflow: "hidden",
    marginBottom: 8,
    backgroundColor: Theme.bgMain,
  },
  dishImg: { width: "100%", height: "100%" },
  dishName: {
    fontSize: 13,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    minHeight: 36,
    lineHeight: 18,
  },
  dishPrice: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.primary,
    marginTop: 4,
  },
  headerCartBtn: {
    width: 48,
    height: 48,
    backgroundColor: Theme.bgMain,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    position: "relative",
  },
  headerBillBtn: {
    width: 48,
    height: 48,
    backgroundColor: Theme.bgMain,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cartBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: Theme.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#fff",
  },
  cartBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  title: { fontSize: 24, fontFamily: Fonts.black },
  modalOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modalContent: {
    width: "85%",
    maxWidth: 480,
    maxHeight: "90%",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  modalClose: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Theme.bgMuted,
    borderRadius: 18,
  },
  modalBody: { flexShrink: 1 },
  modifierList: { borderTopWidth: 1, borderTopColor: Theme.border },
  modifierRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    borderWidth: 1,
    borderColor: "#EAECEE",
    borderRadius: 10,
    backgroundColor: "#FAF9F6",
    marginBottom: 8,
  },
  modifierRowSelected: {
    borderColor: Theme.primary,
    backgroundColor: "#FFF5EB",
  },
  modifierName: {
    color: Theme.textPrimary,
    fontSize: 15,
    fontFamily: Fonts.medium,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: { backgroundColor: Theme.primary },
  modalFooter: { flexDirection: "row", gap: 12, marginTop: 24 },
  modalBtnCancel: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  modalBtnTextCancel: {
    color: Theme.textSecondary,
    fontSize: 16,
    fontFamily: Fonts.bold,
  },
  modalBtnAdd: {
    flex: 1.5,
    height: 54,
    borderRadius: 16,
    backgroundColor: Theme.success,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    ...Theme.shadowSm,
  },
  modalBtnTextAdd: { color: "#fff", fontSize: 16, fontFamily: Fonts.black },

  /* Submodal Styling (Screenshot 2) */
  customItemModal: {
    width: "85%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  customModalTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    marginBottom: 20,
  },
  inputGroup: { marginBottom: 18 },
  inputLabel: {
    color: Theme.textSecondary,
    fontSize: 14,
    fontFamily: Fonts.bold,
    marginBottom: 8,
  },
  customInput: {
    height: 52,
    backgroundColor: Theme.bgMain,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Theme.border,
    paddingHorizontal: 16,
    color: Theme.textPrimary,
    fontSize: 16,
    fontFamily: Fonts.medium,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  customModalActions: { flexDirection: "row", gap: 12, marginTop: 10 },
  customBtnCancel: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  customBtnTextCancel: {
    color: Theme.textSecondary,
    fontSize: 16,
    fontFamily: Fonts.bold,
  },
  customBtnAdd: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  customBtnTextAdd: { color: "#fff", fontSize: 16, fontFamily: Fonts.black },

  emptyNavState: {
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Theme.bgMuted,
    borderRadius: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  emptyNavText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
  },
  emptyItemsState: {
    flex: 1,
    height: 300,
    justifyContent: "center",
    alignItems: "center",
    gap: 15,
  },
  emptyItemsText: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
  },
  modifierGroupContainer: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 15,
  },
  modifierGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  modifierGroupName: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  modifierGroupLimits: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  qtyContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  qtyText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    minWidth: 20,
    textAlign: "center",
  },
  modifierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 8,
  },
  modifierCard: {
    width: "48%",
    backgroundColor: "#FAF9F6",
    borderWidth: 1.5,
    borderColor: "#EAECEE",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    minHeight: 70,
  },
  modifierCardSelected: {
    borderColor: Theme.primary,
    backgroundColor: "#FFF5EB",
  },
  modifierCardName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#2C3E50",
    textAlign: "center",
  },
  modifierCardTextSelected: {
    color: Theme.primary,
  },
  modifierCardPrice: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    marginTop: 4,
    backgroundColor: "#FFEEDB",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  modifierCheckmarkWrap: {
    position: "absolute",
    top: -6,
    right: -6,
    zIndex: 10,
  },
  modifierCardQtyContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  modifierCardQtyBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modifierCardQtyText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    minWidth: 14,
    textAlign: "center",
  },

  /* 3-COLUMN MAIN BODY LAYOUT (MATCHING QUICK SERVE POS) */
  main3Column: {
    flex: 1,
    padding: 10,
    backgroundColor: Theme.bgMain,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
  },
  columnsRow: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 0,
    overflow: "hidden",
  },

  /* COLUMN 1: LEFT SIDE DISH GROUPS */
  leftGroupsColumn: {
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
  kitchenTabsBar: {
    paddingVertical: 2,
    marginBottom: 6,
  },
  groupsHeader: {
    height: 34,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FAFAFA",
  },
  groupsHeaderTitle: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
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
    paddingRight: 6,
    paddingVertical: 6,
  },
  dishGroupScrollContent: {
    paddingBottom: 6,
  },
  dishGroupGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyGroupPanelState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    gap: 10,
  },
  emptyGroupPanelText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textMuted || "#94A3B8",
    textAlign: "center",
  },
  dishGroupCard2Col: {
    width: (Platform.OS === "web" ? "calc(50% - 3px)" : "48.5%") as any,
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    minHeight: 46,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dishGroupCard2ColActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  dishGroupName2Col: {
    flex: 1,
    fontSize: 12,
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
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dishGroupBadge2ColActive: {
    backgroundColor: "#FFFFFF",
  },
  dishGroupBadgeText2Col: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  dishGroupBadgeText2ColActive: {
    color: Theme.primary,
  },
  dishGroupScrollPillContainer: {
    justifyContent: "center",
    alignItems: "center",
    paddingRight: 6,
    paddingLeft: 2,
  },
  dishGroupScrollPill: {
    width: 24,
    height: 90,
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
  scrollBtnDisabled: {
    opacity: 0.35,
  },

  /* COLUMN 2: CENTER DISH ITEMS */
  centerDishesColumn: {
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
  dishesHeaderRow: {
    height: 34,
    flexShrink: 0,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FAFAFA",
  },
  dishesHeaderTitle: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  dishCountBadge: {
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 8,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: Theme.primaryBorder || Theme.primary,
  },
  dishCountBadgeText: {
    fontSize: 10.5,
    fontFamily: Fonts.bold,
    color: Theme.primary,
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
    minWidth: 80,
    alignItems: "flex-start",
  },
  paginationCenter: {
    flex: 1,
    alignItems: "center",
  },
  paginationRight: {
    minWidth: 80,
    alignItems: "flex-end",
  },
  paginationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: Theme.primaryLight || "#FFF7ED",
    borderWidth: 1,
    borderColor: Theme.primaryBorder || "#FFEDD5",
  },
  paginationBtnText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  paginationText: {
    fontSize: 11,
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
    fontSize: 10.5,
    fontFamily: Fonts.regular,
    color: "#94A3B8",
  },
  dishesListLandscapePadding: {
    paddingHorizontal: 6,
    paddingTop: 4,
    paddingBottom: 4,
  },
});
