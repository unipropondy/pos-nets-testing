const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../frontend/app/(tabs)/category.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// Normalize to LF for easy reliable matching
const hasCRLF = content.includes('\r\n');
if (hasCRLF) {
  content = content.replace(/\r\n/g, '\n');
}

// 1. Module-level caches and dedup variables
const targetTop = `let lastTablesFetchTime = 0;
let tablesFetchThrottleTimer: any = null;`;

const replacementTop = `let lastTablesFetchTime = 0;
let tablesFetchThrottleTimer: any = null;
let cachedAllTables: any[] | null = null;
let inFlightTablesPromise: Promise<any> | null = null;
const sectionSettingsCache = new Map<string, { theme: string; chairs: boolean; time: number }>();
const inFlightSectionSettingsPromises = new Map<string, Promise<{ theme: string; chairs: boolean }>>();`;

if (!content.includes(targetTop)) {
  console.error("Target top not found!");
  process.exit(1);
}
content = content.replace(targetTop, replacementTop);
console.log("1. Top variables replaced.");

// 2. SectionTabMemo components
const targetHelper = `const getStatusUI = (status: number, diningSection?: number) => {`;

const sectionTabComponents = `// --- MEMOIZED SECTION TAB COMPONENTS FOR HIGH-PERFORMANCE RENDERING ---
const MobileSectionTab = React.memo(({
  section,
  isActive,
  onPress,
  sectionTables,
}: {
  section: string;
  isActive: boolean;
  onPress: () => void;
  sectionTables: TableItem[];
}) => {
  const occupied = useTableStatusStore((state) => {
    let count = 0;
    for (let i = 0; i < sectionTables.length; i++) {
      const t = sectionTables[i];
      const td = state.tableMap[t.id];
      const s = td ? (td.status === "SENT" ? 1 : td.status === "BILL_REQUESTED" ? 2 : td.status === "HOLD" ? 3 : td.status === "LOCKED" ? 5 : 0) : Number(t.Status);
      if (s !== 0) count++;
    }
    return count;
  });

  return (
    <TouchableOpacity
      key={section}
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.tabBtn,
        isActive && styles.activeTabBtn,
        { paddingVertical: 6, paddingHorizontal: 12 },
      ]}
    >
      <Ionicons
        name={getSectionIcon(section) as any}
        size={12}
        color={isActive ? "#fff" : Theme.textSecondary}
        style={{ marginRight: 4 }}
      />
      <Text
        style={[
          styles.tabText,
          isActive && styles.activeTabText,
          { fontSize: 12 },
        ]}
      >
        {getSectionLabel(section)}
      </Text>
      {occupied > 0 && (
        <View
          style={[
            styles.tabBadge,
            isActive && styles.activeTabBadge,
            { marginLeft: 4, height: 16, minWidth: 16 },
          ]}
        >
          <Text
            style={[
              styles.tabBadgeText,
              isActive && styles.activeTabBadgeText,
              { fontSize: 9 },
            ]}
          >
            {occupied}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

const TabletSectionTab = React.memo(({
  section,
  isActive,
  onPress,
  sectionTables,
  isTablet,
  isLandscape,
}: {
  section: string;
  isActive: boolean;
  onPress: () => void;
  sectionTables: TableItem[];
  isTablet: boolean;
  isLandscape: boolean;
}) => {
  const occupied = useTableStatusStore((state) => {
    let count = 0;
    for (let i = 0; i < sectionTables.length; i++) {
      const t = sectionTables[i];
      const td = state.tableMap[t.id];
      const s = td ? (td.status === "SENT" ? 1 : td.status === "BILL_REQUESTED" ? 2 : td.status === "HOLD" ? 3 : td.status === "LOCKED" ? 5 : 0) : Number(t.Status);
      if (s !== 0) count++;
    }
    return count;
  });

  return (
    <TouchableOpacity
      key={section}
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.tabBtn,
        isActive && styles.activeTabBtn,
        !isTablet && isLandscape && {
          paddingVertical: 6,
          paddingHorizontal: 12,
        },
      ]}
    >
      <Ionicons
        name={getSectionIcon(section) as any}
        size={14}
        color={isActive ? "#fff" : Theme.textSecondary}
        style={{ marginRight: 5 }}
      />
      <Text
        style={[
          styles.tabText,
          isActive && styles.activeTabText,
          { fontSize: isTablet ? 16 : 13 },
        ]}
      >
        {getSectionLabel(section)}
      </Text>
      {occupied > 0 && (
        <View
          style={[
            styles.tabBadge,
            isActive && styles.activeTabBadge,
          ]}
        >
          <Text
            style={[
              styles.tabBadgeText,
              isActive && styles.activeTabBadgeText,
            ]}
          >
            {occupied}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

const DesktopSectionTab = React.memo(({
  section,
  isActive,
  onPress,
  sectionTables,
}: {
  section: string;
  isActive: boolean;
  onPress: () => void;
  sectionTables: TableItem[];
}) => {
  const occupied = useTableStatusStore((state) => {
    let count = 0;
    for (let i = 0; i < sectionTables.length; i++) {
      const t = sectionTables[i];
      const td = state.tableMap[t.id];
      const s = td ? (td.status === "SENT" ? 1 : td.status === "BILL_REQUESTED" ? 2 : td.status === "HOLD" ? 3 : td.status === "LOCKED" ? 5 : 0) : Number(t.Status);
      if (s !== 0) count++;
    }
    return count;
  });

  const label = formatSectionGlobal(getSectionLabel(section), true);

  return (
    <TouchableOpacity
      key={section}
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.tabBtn,
        {
          borderRadius: 22,
          paddingVertical: 7,
          paddingHorizontal: 16,
          backgroundColor: isActive ? "#FF5E1A" : "#FFFFFF",
          borderColor: isActive ? "#FF5E1A" : "#E5E7EB",
          borderWidth: 1.5,
          shadowColor: isActive ? "#FF5E1A" : "#000",
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isActive ? 0.25 : 0.04,
          shadowRadius: 3,
          elevation: isActive ? 2 : 1,
        },
      ]}
    >
      <Ionicons
        name={getSectionIcon(section) as any}
        size={15}
        color={isActive ? "#FFFFFF" : "#6B7280"}
        style={{ marginRight: 6 }}
      />
      <Text
        style={[
          styles.tabText,
          {
            fontSize: 13,
            fontWeight: isActive ? "800" : "600",
            color: isActive ? "#FFFFFF" : "#4B5563",
            letterSpacing: 0.2,
          },
        ]}
      >
        {label}
      </Text>
      {occupied > 0 && (
        <View
          style={[
            styles.tabBadge,
            {
              marginLeft: 6,
              backgroundColor: isActive ? "rgba(255,255,255,0.28)" : "#F3F4F6",
              borderRadius: 10,
              minWidth: 18,
              height: 18,
              paddingHorizontal: 5,
              justifyContent: "center",
              alignItems: "center",
            },
          ]}
        >
          <Text
            style={[
              styles.tabBadgeText,
              {
                color: isActive ? "#FFFFFF" : "#4B5563",
                fontSize: 10,
                fontWeight: "700",
              },
            ]}
          >
            {occupied}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

const getStatusUI = (status: number, diningSection?: number) => {`;

if (!content.includes(targetHelper)) {
  console.error("Target helper not found!");
  process.exit(1);
}
content = content.replace(targetHelper, sectionTabComponents);
console.log("2. Section tabs components added.");

// 3. activeTab initialization with urlSection fallback and initial loading state
const targetTabInit = `  const [activeTab, setActiveTab] = useState<string>("SECTION_1");

  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const { showToast } = useToast();
  const { section: urlSection } = useLocalSearchParams<{ section?: string }>();
  const isWindows = Platform.OS === "windows" || (Platform.OS === "web" && typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent));
  const [allTables, setAllTables] = useState<TableItem[]>([]);`;

const replacementTabInit = `  const { section: urlSection } = useLocalSearchParams<{ section?: string }>();
  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const initialSection = urlSection || orderContext?.section || "SECTION_1";
  const [activeTab, setActiveTab] = useState<string>(initialSection);

  const { showToast } = useToast();
  const isWindows = Platform.OS === "windows" || (Platform.OS === "web" && typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent));
  const [allTables, setAllTables] = useState<TableItem[]>(cachedAllTables || []);`;

if (!content.includes(targetTabInit)) {
  console.error("Target tab init not found!");
  process.exit(1);
}
content = content.replace(targetTabInit, replacementTabInit);
console.log("3. Tab init replaced.");

// 4. Update loadSectionSettings with memory caching + dedup
const targetLoadSettings = `  const loadSectionSettings = async (sectionKey: string) => {
    try {
      // 1. Instant local cache fallback
      const savedTheme = await AsyncStorage.getItem(\`layout_background_theme_\${sectionKey}\`);
      if (savedTheme) setBackgroundTheme(savedTheme);
      const savedChairs = await AsyncStorage.getItem(\`layout_show_chairs_\${sectionKey}\`);
      if (savedChairs !== null) setShowChairs(savedChairs === "true");

      // 2. Fetch live settings from central server
      const res = await fetch(\`\${API_URL}/api/tables/section-layout?section=\${sectionKey}\`);
      if (res.ok) {
        const data = await res.json();
        if (data.backgroundTheme) {
          setBackgroundTheme(data.backgroundTheme);
          await AsyncStorage.setItem(\`layout_background_theme_\${sectionKey}\`, data.backgroundTheme);
        }
        if (data.showChairs !== undefined) {
          const chairsBool = Boolean(data.showChairs);
          setShowChairs(chairsBool);
          await AsyncStorage.setItem(\`layout_show_chairs_\${sectionKey}\`, String(chairsBool));
        }
      }
    } catch (e) {
      console.warn("⚠️ [Category] Could not load section settings from backend:", e);
    }
  };`;

const replacementLoadSettings = `  const loadSectionSettings = async (sectionKey: string) => {
    try {
      // 1. In-memory hot cache hit
      const memoryCached = sectionSettingsCache.get(sectionKey);
      if (memoryCached) {
        setBackgroundTheme(memoryCached.theme);
        setShowChairs(memoryCached.chairs);
        if (Date.now() - memoryCached.time < 60000) {
          return;
        }
      }

      // 2. Instant local AsyncStorage fallback
      const savedTheme = await AsyncStorage.getItem(\`layout_background_theme_\${sectionKey}\`);
      if (savedTheme) setBackgroundTheme(savedTheme);
      const savedChairs = await AsyncStorage.getItem(\`layout_show_chairs_\${sectionKey}\`);
      if (savedChairs !== null) setShowChairs(savedChairs === "true");

      // 3. Deduplicated network fetch
      let fetchPromise = inFlightSectionSettingsPromises.get(sectionKey);
      if (!fetchPromise) {
        fetchPromise = (async () => {
          try {
            const res = await fetch(\`\${API_URL}/api/tables/section-layout?section=\${sectionKey}\`);
            if (res.ok) {
              const data = await res.json();
              const theme = data.backgroundTheme || "champagne_fizz";
              const chairs = data.showChairs !== undefined ? Boolean(data.showChairs) : true;
              sectionSettingsCache.set(sectionKey, { theme, chairs, time: Date.now() });
              await AsyncStorage.setItem(\`layout_background_theme_\${sectionKey}\`, theme);
              await AsyncStorage.setItem(\`layout_show_chairs_\${sectionKey}\`, String(chairs));
              return { theme, chairs };
            }
          } catch (netErr) {
            console.warn("⚠️ [Category] Could not load section settings from backend:", netErr);
          } finally {
            inFlightSectionSettingsPromises.delete(sectionKey);
          }
          return { theme: savedTheme || "champagne_fizz", chairs: savedChairs !== null ? savedChairs === "true" : true };
        })();
        inFlightSectionSettingsPromises.set(sectionKey, fetchPromise);
      }

      const freshSettings = await fetchPromise;
      if (freshSettings && freshSettings.theme) setBackgroundTheme(freshSettings.theme);
      if (freshSettings && freshSettings.chairs !== undefined) setShowChairs(freshSettings.chairs);
    } catch (e) {
      console.warn("⚠️ [Category] Could not load section settings:", e);
    }
  };`;

if (!content.includes(targetLoadSettings)) {
  console.error("Target load settings not found!");
  process.exit(1);
}
content = content.replace(targetLoadSettings, replacementLoadSettings);
console.log("4. Load section settings replaced.");

// 5. Update initial loading state
const targetLoadingState = `  const [loading, setLoading] = useState(true);`;
const replacementLoadingState = `  const [loading, setLoading] = useState(cachedAllTables === null || cachedAllTables.length === 0);`;

if (!content.includes(targetLoadingState)) {
  console.error("Target loading state not found!");
  process.exit(1);
}
content = content.replace(targetLoadingState, replacementLoadingState);
console.log("5. Loading state replaced.");

// 6. Deduplicate fetchTables and reuse in-flight promise
const targetFetchTables = `  const fetchTables = async () => {
    lastTablesFetchTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(\`\${API_URL}/api/tables/all\`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);

      if (!response.ok)
        throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);

      const data = await response.json();`;

const replacementFetchTables = `  const fetchTables = async () => {
    if (inFlightTablesPromise) {
      return inFlightTablesPromise;
    }

    inFlightTablesPromise = (async () => {
      lastTablesFetchTime = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const response = await fetch(\`\${API_URL}/api/tables/all\`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        clearTimeout(timeoutId);

        if (!response.ok)
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);

        const data = await response.json();`;

if (!content.includes(targetFetchTables)) {
  console.error("Target fetchTables not found!");
  process.exit(1);
}
content = content.replace(targetFetchTables, replacementFetchTables);

const targetBlockBeforeEnd = `        useTableStatusStore.getState().batchUpdateTableStatus(updates);
      } else {
        throw new Error("No tables returned from API");
      }
    } catch (error) {
      Alert.alert(
        "Connection Error",
        \`Failed to connect to server at \${API_URL}\\n\\nPlease ensure the backend server is running.\`,
        [{ text: "OK" }],
      );
      setAllTables([]);
    } finally {
      setLoading(false);
    }
  };`;

const replacementEndFetch = `        useTableStatusStore.getState().batchUpdateTableStatus(updates);
        cachedAllTables = uniqueTables;
      } else {
        throw new Error("No tables returned from API");
      }
    } catch (error) {
      Alert.alert(
        "Connection Error",
        \`Failed to connect to server at \${API_URL}\\n\\nPlease ensure the backend server is running.\`,
        [{ text: "OK" }],
      );
      if (!cachedAllTables || cachedAllTables.length === 0) {
        setAllTables([]);
      }
    } finally {
      inFlightTablesPromise = null;
      setLoading(false);
    }
  })();

  return inFlightTablesPromise;
  };`;

if (!content.includes(targetBlockBeforeEnd)) {
  console.error("Target block before end of fetchTables not found!");
  process.exit(1);
}
content = content.replace(targetBlockBeforeEnd, replacementEndFetch);
console.log("6. fetchTables dedup and caching added.");

// 7. Remove tableMap subscription from main Category component
const targetTableMapSub = `  const tableMap = useTableStatusStore((state) => state.tableMap);`;
if (!content.includes(targetTableMapSub)) {
  console.error("Target tableMap sub not found!");
  process.exit(1);
}
content = content.replace(targetTableMapSub, `  // tableMap subscription removed from Category root to prevent full screen re-renders on table status update`);
console.log("7. tableMap subscription removed from root.");

// 8. Replace mobile, tablet, and desktop section tabs with memoized components
// Mobile:
const targetMobileTabs = `<View style={[styles.tabsWrapper, { gap: 6 }]}>
                {visibleSections.map((section) => {
                  const isActive = activeTab === section;
                  const sectionTables = allTables.filter((t: TableItem) => {
                    if (section === "TAKEAWAY") return t.DiningSection === 4;
                    const match = section.match(/^SECTION_(\\d+)$/);
                    if (match) return t.DiningSection === parseInt(match[1], 10);
                    return false;
                  });
                  const occupied = sectionTables.filter((t: TableItem) => {
                    const tableData = tableMap[t.id];
                    const status = tableData
                      ? (tableData.status === "SENT"
                        ? 1
                        : tableData.status === "BILL_REQUESTED"
                          ? 2
                          : tableData.status === "HOLD"
                            ? 3
                            : tableData.status === "LOCKED"
                              ? 5
                              : 0)
                      : Number(t.Status);
                    return status !== 0;
                  }).length;

                  return (
                    <TouchableOpacity
                      key={section}
                      onPress={() => setActiveTab(section)}
                      activeOpacity={0.75}
                      style={[
                        styles.tabBtn,
                        isActive && styles.activeTabBtn,
                        { paddingVertical: 6, paddingHorizontal: 12 },
                      ]}
                    >
                      <Ionicons
                        name={getSectionIcon(section) as any}
                        size={12}
                        color={isActive ? "#fff" : Theme.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.tabText,
                          isActive && styles.activeTabText,
                          { fontSize: 12 },
                        ]}
                      >
                        {getSectionLabel(section)}
                      </Text>
                      {occupied > 0 && (
                        <View
                          style={[
                            styles.tabBadge,
                            isActive && styles.activeTabBadge,
                            { marginLeft: 4, height: 16, minWidth: 16 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tabBadgeText,
                              isActive && styles.activeTabBadgeText,
                              { fontSize: 9 },
                            ]}
                          >
                            {occupied}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>`;

const replacementMobileTabs = `<View style={[styles.tabsWrapper, { gap: 6 }]}>
                {visibleSections.map((section) => {
                  const sectionTables = allTables.filter((t: TableItem) => {
                    if (section === "TAKEAWAY") return t.DiningSection === 4;
                    const match = section.match(/^SECTION_(\\d+)$/);
                    if (match) return t.DiningSection === parseInt(match[1], 10);
                    return false;
                  });
                  return (
                    <MobileSectionTab
                      key={section}
                      section={section}
                      isActive={activeTab === section}
                      onPress={() => setActiveTab(section)}
                      sectionTables={sectionTables}
                    />
                  );
                })}
              </View>`;

if (!content.includes(targetMobileTabs)) {
  console.error("Target mobile tabs not found!");
  process.exit(1);
}
content = content.replace(targetMobileTabs, replacementMobileTabs);
console.log("8a. Mobile tabs replaced.");

// Tablet:
const targetTabletTabs = `<View style={[styles.tabsWrapper, { gap: isTablet ? 8 : 6 }]}>
                {visibleSections.map((section) => {
                  const isActive = activeTab === section;
                  const sectionTables = allTables.filter((t: TableItem) => {
                    if (section === "TAKEAWAY") return t.DiningSection === 4;
                    const match = section.match(/^SECTION_(\\d+)$/);
                    if (match) return t.DiningSection === parseInt(match[1], 10);
                    return false;
                  });
                  const occupied = sectionTables.filter((t: TableItem) => {
                    const tableData = tableMap[t.id];
                    const status = tableData
                      ? (tableData.status === "SENT"
                        ? 1
                        : tableData.status === "BILL_REQUESTED"
                          ? 2
                          : tableData.status === "HOLD"
                            ? 3
                            : tableData.status === "LOCKED"
                              ? 5
                              : 0)
                      : Number(t.Status);
                    return status !== 0;
                  }).length;

                  return (
                    <TouchableOpacity
                      key={section}
                      onPress={() => setActiveTab(section)}
                      activeOpacity={0.75}
                      style={[
                        styles.tabBtn,
                        isActive && styles.activeTabBtn,
                        !isTablet &&
                        isLandscape && {
                          paddingVertical: 6,
                          paddingHorizontal: 12,
                        },
                      ]}
                    >
                      <Ionicons
                        name={getSectionIcon(section) as any}
                        size={14}
                        color={isActive ? "#fff" : Theme.textSecondary}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.tabText,
                          isActive && styles.activeTabText,
                          { fontSize: isTablet ? 16 : 13 },
                        ]}
                      >
                        {getSectionLabel(section)}
                      </Text>
                      {occupied > 0 && (
                        <View
                          style={[
                            styles.tabBadge,
                            isActive && styles.activeTabBadge,
                          ]}
                        >
                          <Text
                            style={[
                              styles.tabBadgeText,
                              isActive && styles.activeTabBadgeText,
                            ]}
                          >
                            {occupied}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>`;

const replacementTabletTabs = `<View style={[styles.tabsWrapper, { gap: isTablet ? 8 : 6 }]}>
                {visibleSections.map((section) => {
                  const sectionTables = allTables.filter((t: TableItem) => {
                    if (section === "TAKEAWAY") return t.DiningSection === 4;
                    const match = section.match(/^SECTION_(\\d+)$/);
                    if (match) return t.DiningSection === parseInt(match[1], 10);
                    return false;
                  });
                  return (
                    <TabletSectionTab
                      key={section}
                      section={section}
                      isActive={activeTab === section}
                      onPress={() => setActiveTab(section)}
                      sectionTables={sectionTables}
                      isTablet={isTablet}
                      isLandscape={isLandscape}
                    />
                  );
                })}
              </View>`;

if (!content.includes(targetTabletTabs)) {
  console.error("Target tablet tabs not found!");
  process.exit(1);
}
content = content.replace(targetTabletTabs, replacementTabletTabs);
console.log("8b. Tablet tabs replaced.");

// Desktop:
const targetDesktopTabs = `<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {visibleSections.map((section) => {
                const isActive = activeTab === section;
                const sectionTables = allTables.filter((t: TableItem) => {
                  if (section === "TAKEAWAY") return t.DiningSection === 4;
                  const match = section.match(/^SECTION_(\\d+)$/);
                  if (match) return t.DiningSection === parseInt(match[1], 10);
                  return false;
                });
                const occupied = sectionTables.filter((t: TableItem) => {
                  const tableData = tableMap[t.id];
                  const status = tableData
                    ? (tableData.status === "SENT"
                      ? 1
                      : tableData.status === "BILL_REQUESTED"
                        ? 2
                        : tableData.status === "HOLD"
                          ? 3
                          : tableData.status === "LOCKED"
                            ? 5
                            : 0)
                    : Number(t.Status);
                  return status !== 0;
                }).length;

                const label = formatSectionGlobal(getSectionLabel(section), true);

                return (
                  <TouchableOpacity
                    key={section}
                    onPress={() => setActiveTab(section)}
                    activeOpacity={0.8}
                    style={[
                      styles.tabBtn,
                      {
                        borderRadius: 22,
                        paddingVertical: 7,
                        paddingHorizontal: 16,
                        backgroundColor: isActive ? "#FF5E1A" : "#FFFFFF",
                        borderColor: isActive ? "#FF5E1A" : "#E5E7EB",
                        borderWidth: 1.5,
                        shadowColor: isActive ? "#FF5E1A" : "#000",
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: isActive ? 0.25 : 0.04,
                        shadowRadius: 3,
                        elevation: isActive ? 2 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={getSectionIcon(section) as any}
                      size={15}
                      color={isActive ? "#FFFFFF" : "#6B7280"}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.tabText,
                        {
                          fontSize: 13,
                          fontWeight: isActive ? "800" : "600",
                          color: isActive ? "#FFFFFF" : "#4B5563",
                          letterSpacing: 0.2,
                        },
                      ]}
                    >
                      {label}
                    </Text>
                    {occupied > 0 && (
                      <View
                        style={[
                          styles.tabBadge,
                          {
                            marginLeft: 6,
                            backgroundColor: isActive ? "rgba(255,255,255,0.28)" : "#F3F4F6",
                            borderRadius: 10,
                            minWidth: 18,
                            height: 18,
                            paddingHorizontal: 5,
                            justifyContent: "center",
                            alignItems: "center",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabBadgeText,
                            {
                              color: isActive ? "#FFFFFF" : "#4B5563",
                              fontSize: 10,
                              fontWeight: "700",
                            },
                          ]}
                        >
                          {occupied}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>`;

const replacementDesktopTabs = `<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {visibleSections.map((section) => {
                const sectionTables = allTables.filter((t: TableItem) => {
                  if (section === "TAKEAWAY") return t.DiningSection === 4;
                  const match = section.match(/^SECTION_(\\d+)$/);
                  if (match) return t.DiningSection === parseInt(match[1], 10);
                  return false;
                });
                return (
                  <DesktopSectionTab
                    key={section}
                    section={section}
                    isActive={activeTab === section}
                    onPress={() => setActiveTab(section)}
                    sectionTables={sectionTables}
                  />
                );
              })}
            </View>`;

if (!content.includes(targetDesktopTabs)) {
  console.error("Target desktop tabs not found!");
  process.exit(1);
}
content = content.replace(targetDesktopTabs, replacementDesktopTabs);
console.log("8c. Desktop tabs replaced.");

// Re-apply CRLF if originally present
if (hasCRLF) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ Successfully updated frontend/app/(tabs)/category.tsx with all optimizations!');
