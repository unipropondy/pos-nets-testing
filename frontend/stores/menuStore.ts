import { create } from 'zustand';
import { API_URL } from '@/constants/Config';
import { socket } from '@/constants/socket';

interface MenuState {
  kitchens: any[];
  dishGroups: Record<string, any[]>;
  dishesByGroup: Record<string, any[]>;
  allDishes: any[];
  modifierCache: Record<string, any[]>;
  lastFetched: number | null;
  isLoading: boolean;

  fetchMenu: (force?: boolean) => Promise<void>;
  fetchGroups: (kitchenId: string) => Promise<any[]>;
  fetchDishes: (groupId: string) => Promise<any[]>;
  fetchModifiersForGroup: (groupId: string) => Promise<void>;
  clearCache: () => void;
  forceRefreshMenu: () => Promise<void>;
}

export const useMenuStore = create<MenuState>((set, get) => ({
  kitchens: [],
  dishGroups: {},
  dishesByGroup: {},
  allDishes: [],
  modifierCache: {},
  lastFetched: null,
  isLoading: false,

  fetchMenu: async (force = false) => {
    const { lastFetched, kitchens, dishGroups, dishesByGroup } = get();
    // Cache for 30 minutes unless forced
    if (!force && lastFetched && kitchens.length > 0 && Object.keys(dishGroups).length > 0 && Object.keys(dishesByGroup).length > 0 && Date.now() - lastFetched < 1800000) {
      return;
    }

    set({ isLoading: true });
    try {
      // 1. Fetch kitchens and all dishes in parallel
      const [kRes, dRes] = await Promise.all([
        fetch(`${API_URL}/api/menu/kitchens`),
        fetch(`${API_URL}/api/menu/dishes/all`)
      ]);
      const kData = await kRes.json();
      const dData = await dRes.json();

      const rawKitchens = Array.isArray(kData) ? kData.filter((k: any) => k.KitchenTypeName && !k.KitchenTypeName.includes("TEST")) : [];
      // 🟢 Deduplicate kitchens by CategoryId
      const kitchensData = Array.from(
        new Map(rawKitchens.map((k: any) => [k.CategoryId, k])).values()
      );

      const allDishesRaw = Array.isArray(dData) ? dData : [];
      // Deduplicate dishes by DishId
      const allDishesData = Array.from(
        new Map(allDishesRaw.map((d: any) => [d.DishId || d.id, d])).values()
      );

      // 2. ⚡ Pre-index all dishes into dishesByGroup immediately from allDishesData!
      const preIndexedDishesByGroup: Record<string, any[]> = {};
      allDishesData.forEach((dish: any) => {
        const primaryGroupId = String(dish.DishGroupId || "");
        if (primaryGroupId) {
          if (!preIndexedDishesByGroup[primaryGroupId]) preIndexedDishesByGroup[primaryGroupId] = [];
          preIndexedDishesByGroup[primaryGroupId].push(dish);
        }
        if (dish.MappedGroupIds) {
          const mappedIds = String(dish.MappedGroupIds).split(",").map((s: string) => s.trim()).filter(Boolean);
          mappedIds.forEach((mId: string) => {
            if (mId !== primaryGroupId) {
              if (!preIndexedDishesByGroup[mId]) preIndexedDishesByGroup[mId] = [];
              preIndexedDishesByGroup[mId].push(dish);
            }
          });
        }
      });

      // 3. ⚡ Pre-fetch groups for all kitchens in parallel so category switching is 100% instant
      const groupPromises = kitchensData.map(async (k: any) => {
        try {
          const res = await fetch(`${API_URL}/api/menu/dishgroups/${k.CategoryId}`);
          const gData = await res.json();
          const rawGroups = Array.isArray(gData) ? gData : [];
          const groups = Array.from(
            new Map(rawGroups.map((g: any) => [g.DishGroupId || g.id, g])).values()
          );
          return { kitchenId: String(k.CategoryId), groups };
        } catch {
          return { kitchenId: String(k.CategoryId), groups: [] };
        }
      });
      const groupResults = await Promise.all(groupPromises);
      const preIndexedGroups: Record<string, any[]> = {};
      groupResults.forEach(item => {
        preIndexedGroups[item.kitchenId] = item.groups;
        item.groups.forEach((g: any) => {
          const gId = String(g.DishGroupId || g.id || "");
          if (gId && !preIndexedDishesByGroup[gId]) {
            preIndexedDishesByGroup[gId] = [];
          }
        });
      });

      set({ 
        kitchens: kitchensData, 
        dishGroups: preIndexedGroups,
        dishesByGroup: preIndexedDishesByGroup,
        allDishes: allDishesData,
        lastFetched: Date.now(),
        isLoading: false 
      });
    } catch (error) {
      console.error("Failed to fetch menu:", error);
      set({ isLoading: false });
    }
  },

  fetchGroups: async (kitchenId) => {
    const kIdStr = String(kitchenId);
    const { dishGroups } = get();
    if (dishGroups[kIdStr] && dishGroups[kIdStr].length > 0) return dishGroups[kIdStr];

    try {
      const res = await fetch(`${API_URL}/api/menu/dishgroups/${kitchenId}`);
      const data = await res.json();
      const rawGroups = Array.isArray(data) ? data : [];
      // 🟢 Deduplicate groups by DishGroupId
      const groups = Array.from(
        new Map(rawGroups.map((g: any) => [g.DishGroupId || g.id, g])).values()
      );
      
      set((state) => ({
        dishGroups: { ...state.dishGroups, [kIdStr]: groups }
      }));
      return groups;
    } catch (error) {
      console.error(`Failed to fetch groups for kitchen ${kitchenId}:`, error);
      return [];
    }
  },

  fetchDishes: async (groupId) => {
    const gIdStr = String(groupId);
    const { dishesByGroup, allDishes, modifierCache } = get();
    if (dishesByGroup[gIdStr] && dishesByGroup[gIdStr].length > 0) {
      const groupDishes = dishesByGroup[gIdStr];
      const hasAnyModifierCached = groupDishes.some(d => modifierCache[d.DishId || d.id] !== undefined);
      if (!hasAnyModifierCached) {
        get().fetchModifiersForGroup(gIdStr);
      }
      return dishesByGroup[gIdStr];
    }

    // ⚡ In-memory fallback from allDishes before hitting network
    if (allDishes && allDishes.length > 0) {
      const matched = allDishes.filter((d: any) => 
        String(d.DishGroupId) === gIdStr || 
        (d.MappedGroupIds && String(d.MappedGroupIds).split(",").map((s: string) => s.trim()).includes(gIdStr))
      );
      if (matched.length > 0) {
        set((state) => ({
          dishesByGroup: { ...state.dishesByGroup, [gIdStr]: matched }
        }));
        get().fetchModifiersForGroup(gIdStr);
        return matched;
      }
    }

    try {
      const res = await fetch(`${API_URL}/api/menu/dishes/group/${groupId}`);
      const data = await res.json();
      const dishesRaw = Array.isArray(data) ? data : [];
      
      // Deduplicate dishes by DishId
      const dishes = Array.from(
        new Map(dishesRaw.map((d: any) => [d.DishId || d.id, d])).values()
      );

      set((state) => ({
        dishesByGroup: { ...state.dishesByGroup, [gIdStr]: dishes }
      }));

      // 🚀 BACKGROUND PRE-FETCH: Load all modifiers for this group
      get().fetchModifiersForGroup(gIdStr);

      return dishes;
    } catch (error) {
      console.error(`Failed to fetch dishes for group ${groupId}:`, error);
      return [];
    }
  },

  fetchModifiersForGroup: async (groupId) => {
    try {
      const res = await fetch(`${API_URL}/api/menu/modifiers/group/${groupId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const newModifiers: Record<string, any[]> = {};
        data.forEach(m => {
          if (!newModifiers[m.DishId]) newModifiers[m.DishId] = [];
          newModifiers[m.DishId].push(m);
        });
        
        set(state => ({
          modifierCache: { ...state.modifierCache, ...newModifiers }
        }));
      }
    } catch (err) {
      console.error("Failed to fetch group modifiers:", err);
    }
  },

  clearCache: () => set({ kitchens: [], dishGroups: {}, dishesByGroup: {}, allDishes: [], modifierCache: {}, lastFetched: null }),

  forceRefreshMenu: async () => {
    set({ isLoading: true });
    try {
      await fetch(`${API_URL}/api/menu/clear-cache`, { method: 'POST' });
    } catch (err) {
      console.warn("Backend cache clear failed:", err);
    }
    get().clearCache();
    await get().fetchMenu(true);
  },
}));

// 🔌 Real-time Socket Listener for Menu Updates (e.g. IsPublished toggle = 1 or 0)
socket.on('menu_updated', (data) => {
  console.log('⚡ [MenuStore] Received menu_updated socket event:', data);
  useMenuStore.getState().clearCache();
  useMenuStore.getState().fetchMenu(true);
});
