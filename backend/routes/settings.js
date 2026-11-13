const express = require("express");
const router = express.Router();
const sql = require("mssql");
const { poolPromise, getRemotePool, isRemoteOnline } = require("../config/db");
const { getAppSettings, getCompanySettings, invalidateCache } = require("../utils/settingsCache");
const { logSettingsDiff, initSettingsAuditTable } = require("../utils/auditLogger");
const { syncKitchensToPrintMaster } = require("../config/init");


let appSettingsSchemaVerified = false;

async function ensureAppSettingsColumns(pool) {
  if (appSettingsSchemaVerified || !pool) return;
  try {
    await pool.query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableKDSPrint')
        ALTER TABLE AppSettings ADD EnableKDSPrint BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'SVCIdentification')
        ALTER TABLE AppSettings ADD SVCIdentification BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableCombo')
        ALTER TABLE AppSettings ADD EnableCombo BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableQuickServe')
        ALTER TABLE AppSettings ADD EnableQuickServe BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'ShowLoyalty')
        ALTER TABLE AppSettings ADD ShowLoyalty BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'ShowRewardPoints')
        ALTER TABLE AppSettings ADD ShowRewardPoints BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'ShowPromoCode')
        ALTER TABLE AppSettings ADD ShowPromoCode BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableOnlinePayment')
        ALTER TABLE AppSettings ADD EnableOnlinePayment BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableQROrderAutoPrint')
        ALTER TABLE AppSettings ADD EnableQROrderAutoPrint BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableComboPrint')
        ALTER TABLE AppSettings ADD EnableComboPrint BIT DEFAULT 0 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableRequestService')
        ALTER TABLE AppSettings ADD EnableRequestService BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableCookingInstructions')
        ALTER TABLE AppSettings ADD EnableCookingInstructions BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableDirectPaymentToProcess')
        ALTER TABLE AppSettings ADD EnableDirectPaymentToProcess BIT DEFAULT 0 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableSkipSummaryScreen')
        ALTER TABLE AppSettings ADD EnableSkipSummaryScreen BIT DEFAULT 0 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableReceiptPrint')
        ALTER TABLE AppSettings ADD EnableReceiptPrint BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableVoiceSuccess')
        ALTER TABLE AppSettings ADD EnableVoiceSuccess BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'EnableNotificationSound')
        ALTER TABLE AppSettings ADD EnableNotificationSound BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'MenuNavigationMode')
        ALTER TABLE AppSettings ADD MenuNavigationMode NVARCHAR(20) DEFAULT 'scroll' WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'QuickServeEnableKOT')
        ALTER TABLE AppSettings ADD QuickServeEnableKOT BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'QuickServeEnableKDS')
        ALTER TABLE AppSettings ADD QuickServeEnableKDS BIT DEFAULT 1 WITH VALUES;
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'AppSettings' AND COLUMN_NAME = 'QuickServeEnableKDSPrinter')
        ALTER TABLE AppSettings ADD QuickServeEnableKDSPrinter BIT DEFAULT 1 WITH VALUES;
    `);
    appSettingsSchemaVerified = true;
  } catch (err) {
    console.warn("Failed self-healing AppSettings columns:", err.message);
  }
}

// 🔹 GET Settings
router.get("/", async (req, res) => {
  try {
    const pool = await poolPromise;
    ensureAppSettingsColumns(pool);

    const settings = await getAppSettings();
    res.json({
      ...(settings || {}),
      SVCIdentification: settings?.SVCIdentification !== undefined ? (settings.SVCIdentification ? 1 : 0) : 1,
      EnableOnlinePayment: settings?.EnableOnlinePayment !== undefined ? (settings.EnableOnlinePayment ? 1 : 0) : 1,
      EnableQROrderAutoPrint: settings?.EnableQROrderAutoPrint !== undefined ? (settings.EnableQROrderAutoPrint ? 1 : 0) : 1,
      EnableComboPrint: settings?.EnableComboPrint !== undefined ? (settings.EnableComboPrint ? 1 : 0) : 0,
      EnableRequestService: settings?.EnableRequestService !== undefined ? (settings.EnableRequestService ? 1 : 0) : 1,
      EnableCookingInstructions: settings?.EnableCookingInstructions !== undefined ? (settings.EnableCookingInstructions ? 1 : 0) : 1,
      EnableDirectPaymentToProcess: settings?.EnableDirectPaymentToProcess !== undefined ? (settings.EnableDirectPaymentToProcess ? 1 : 0) : 0,
      EnableSkipSummaryScreen: settings?.EnableSkipSummaryScreen !== undefined ? (settings.EnableSkipSummaryScreen ? 1 : 0) : 0,
      EnableReceiptPrint: settings?.EnableReceiptPrint !== undefined ? (settings.EnableReceiptPrint ? 1 : 0) : 1,
      EnableVoiceSuccess: settings?.EnableVoiceSuccess !== undefined ? (settings.EnableVoiceSuccess ? 1 : 0) : 1,
      EnableNotificationSound: settings?.EnableNotificationSound !== undefined ? (settings.EnableNotificationSound ? 1 : 0) : 1,
      EnableQuickServe: settings?.EnableQuickServe !== undefined ? (settings.EnableQuickServe ? 1 : 0) : 1,
      QuickServeEnableKOT: settings?.QuickServeEnableKOT !== undefined ? (settings.QuickServeEnableKOT ? 1 : 0) : 1,
      QuickServeEnableKDS: settings?.QuickServeEnableKDS !== undefined ? (settings.QuickServeEnableKDS ? 1 : 0) : 1,
      QuickServeEnableKDSPrinter: settings?.QuickServeEnableKDSPrinter !== undefined ? (settings.QuickServeEnableKDSPrinter ? 1 : 0) : 1,
      MenuNavigationMode: settings?.MenuNavigationMode || "scroll",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 UPDATE Settings
router.post("/update", async (req, res) => {
  try {
    const { upiId, shopName, qrCodeUrl, enableKOT, enableKDS, enableCheckoutBill, enableCheckoutFlow, enableDirectProcessToPay, customerSideDisplay, enableGuestDetailsPopup, enableCashDrawer, SVCIdentification, enableKDSPrint, enableCombo, enableQuickServe, quickServeEnableKOT, quickServeEnableKDS, quickServeEnableKDSPrinter, showLoyalty, showRewardPoints, showPromoCode, enableOnlinePayment, enableQROrderAutoPrint, enableComboPrint, enableRequestService, enableCookingInstructions, enableDirectPaymentToProcess, enableSkipSummaryScreen, enableReceiptPrint, enableVoiceSuccess, enableNotificationSound, menuNavigationMode } = req.body;
    const pool = await poolPromise;

    // Snapshot existing app settings before update
    const oldAppSettings = (await getAppSettings()) || {};

    const userInfo = {
      userName: req.body.userName || req.body.modifiedBy || req.body.user?.userName || req.body.user?.fullName || "",
      userId: req.body.userId || req.body.user?.userId || req.body.user?.id || "",
      role: req.body.userRole || req.body.user?.roleName || req.body.user?.role || ""
    };

    // Use an UPSERT logic (Update if exists, Insert if not)
    await pool.request()
      .input("UPI", sql.NVarChar, upiId || null)
      .input("Shop", sql.NVarChar, shopName || "My Restaurant")
      .input("QR", sql.NVarChar, qrCodeUrl || null)
      .input("EnableKOT", sql.Bit, enableKOT !== undefined ? enableKOT : 1)
      .input("EnableKDS", sql.Bit, enableKDS !== undefined ? enableKDS : 1)
      .input("EnableCheckoutBill", sql.Bit, enableCheckoutBill !== undefined ? enableCheckoutBill : 1)
      .input("EnableCheckoutFlow", sql.Bit, enableCheckoutFlow !== undefined ? enableCheckoutFlow : 1)
      .input("EnableDirectProcessToPay", sql.Bit, enableDirectProcessToPay !== undefined ? enableDirectProcessToPay : 0)
      .input("CustomerSideDisplay", sql.Bit, customerSideDisplay !== undefined ? customerSideDisplay : 1)
      .input("EnableGuestDetailsPopup", sql.Bit, enableGuestDetailsPopup !== undefined ? enableGuestDetailsPopup : 1)
      .input("EnableCashDrawer", sql.Bit, enableCashDrawer !== undefined ? enableCashDrawer : 1)
      .input("EnableKDSPrint", sql.Bit, enableKDSPrint !== undefined ? enableKDSPrint : 1)
      .input("SVCIdentification", sql.Bit, SVCIdentification !== undefined ? SVCIdentification : 1)
      .input("EnableCombo", sql.Bit, enableCombo !== undefined ? enableCombo : 1)
      .input("EnableQuickServe", sql.Bit, enableQuickServe !== undefined ? enableQuickServe : 1)
      .input("QuickServeEnableKOT", sql.Bit, quickServeEnableKOT !== undefined ? quickServeEnableKOT : 1)
      .input("QuickServeEnableKDS", sql.Bit, quickServeEnableKDS !== undefined ? quickServeEnableKDS : 1)
      .input("QuickServeEnableKDSPrinter", sql.Bit, quickServeEnableKDSPrinter !== undefined ? quickServeEnableKDSPrinter : 1)
      .input("ShowLoyalty", sql.Bit, showLoyalty !== undefined ? showLoyalty : 1)
      .input("ShowRewardPoints", sql.Bit, showRewardPoints !== undefined ? showRewardPoints : 1)
      .input("ShowPromoCode", sql.Bit, showPromoCode !== undefined ? showPromoCode : 1)
      .input("EnableOnlinePayment", sql.Bit, enableOnlinePayment !== undefined ? enableOnlinePayment : 1)
      .input("EnableQROrderAutoPrint", sql.Bit, enableQROrderAutoPrint !== undefined ? enableQROrderAutoPrint : 1)
      .input("EnableComboPrint", sql.Bit, enableComboPrint !== undefined ? enableComboPrint : 0)
      .input("EnableRequestService", sql.Bit, enableRequestService !== undefined ? enableRequestService : 1)
      .input("EnableCookingInstructions", sql.Bit, enableCookingInstructions !== undefined ? enableCookingInstructions : 1)
      .input("EnableDirectPaymentToProcess", sql.Bit, enableDirectPaymentToProcess !== undefined ? enableDirectPaymentToProcess : 0)
      .input("EnableSkipSummaryScreen", sql.Bit, enableSkipSummaryScreen !== undefined ? enableSkipSummaryScreen : 0)
      .input("EnableReceiptPrint", sql.Bit, enableReceiptPrint !== undefined ? enableReceiptPrint : 1)
      .input("EnableVoiceSuccess", sql.Bit, enableVoiceSuccess !== undefined ? enableVoiceSuccess : 1)
      .input("EnableNotificationSound", sql.Bit, enableNotificationSound !== undefined ? enableNotificationSound : 1)
      .input("MenuNavigationMode", sql.NVarChar, menuNavigationMode || "scroll")
      .query(`
        IF EXISTS (SELECT 1 FROM AppSettings)
        BEGIN
          UPDATE AppSettings
          SET 
            UPI_ID = @UPI,
            ShopName = @Shop,
            PayNow_QR_Url = @QR,
            EnableKOT = @EnableKOT,
            EnableKDS = @EnableKDS,
            EnableCheckoutBill = @EnableCheckoutBill,
            EnableCheckoutFlow = @EnableCheckoutFlow,
            EnableDirectProcessToPay = @EnableDirectProcessToPay,
            CustomerSideDisplay = @CustomerSideDisplay,
            EnableGuestDetailsPopup = @EnableGuestDetailsPopup,
            EnableCashDrawer = @EnableCashDrawer,
            EnableKDSPrint = @EnableKDSPrint,
            SVCIdentification = @SVCIdentification,
            EnableCombo = @EnableCombo,
            EnableQuickServe = @EnableQuickServe,
            QuickServeEnableKOT = @QuickServeEnableKOT,
            QuickServeEnableKDS = @QuickServeEnableKDS,
            QuickServeEnableKDSPrinter = @QuickServeEnableKDSPrinter,
            ShowLoyalty = @ShowLoyalty,
            ShowRewardPoints = @ShowRewardPoints,
            ShowPromoCode = @ShowPromoCode,
            EnableOnlinePayment = @EnableOnlinePayment,
            EnableQROrderAutoPrint = @EnableQROrderAutoPrint,
            EnableComboPrint = @EnableComboPrint,
            EnableRequestService = @EnableRequestService,
            EnableCookingInstructions = @EnableCookingInstructions,
            EnableDirectPaymentToProcess = @EnableDirectPaymentToProcess,
            EnableSkipSummaryScreen = @EnableSkipSummaryScreen,
            EnableReceiptPrint = @EnableReceiptPrint,
            EnableVoiceSuccess = @EnableVoiceSuccess,
            EnableNotificationSound = @EnableNotificationSound,
            MenuNavigationMode = @MenuNavigationMode,
            UpdatedOn = GETDATE()
        END
        ELSE
        BEGIN
          IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('AppSettings') AND is_identity = 1)
          BEGIN
            SET IDENTITY_INSERT [dbo].[AppSettings] ON;
            INSERT INTO AppSettings (Id, UPI_ID, ShopName, PayNow_QR_Url, EnableKOT, EnableKDS, EnableCheckoutBill, EnableCheckoutFlow, EnableDirectProcessToPay, CustomerSideDisplay, EnableGuestDetailsPopup, EnableCashDrawer, EnableKDSPrint, SVCIdentification, EnableCombo, EnableQuickServe, QuickServeEnableKOT, QuickServeEnableKDS, QuickServeEnableKDSPrinter, ShowLoyalty, ShowRewardPoints, ShowPromoCode, EnableOnlinePayment, EnableQROrderAutoPrint, EnableComboPrint, EnableRequestService, EnableCookingInstructions, EnableDirectPaymentToProcess, EnableSkipSummaryScreen, EnableReceiptPrint, EnableVoiceSuccess, EnableNotificationSound, MenuNavigationMode, UpdatedOn)
            VALUES (1, @UPI, @Shop, @QR, @EnableKOT, @EnableKDS, @EnableCheckoutBill, @EnableCheckoutFlow, @EnableDirectProcessToPay, @CustomerSideDisplay, @EnableGuestDetailsPopup, @EnableCashDrawer, @EnableKDSPrint, @SVCIdentification, @EnableCombo, @EnableQuickServe, @QuickServeEnableKOT, @QuickServeEnableKDS, @QuickServeEnableKDSPrinter, @ShowLoyalty, @ShowRewardPoints, @ShowPromoCode, @EnableOnlinePayment, @EnableQROrderAutoPrint, @EnableComboPrint, @EnableRequestService, @EnableCookingInstructions, @EnableDirectPaymentToProcess, @EnableSkipSummaryScreen, @EnableReceiptPrint, @EnableVoiceSuccess, @EnableNotificationSound, @MenuNavigationMode, GETDATE());
            SET IDENTITY_INSERT [dbo].[AppSettings] OFF;
          END
          ELSE
          BEGIN
            INSERT INTO AppSettings (Id, UPI_ID, ShopName, PayNow_QR_Url, EnableKOT, EnableKDS, EnableCheckoutBill, EnableCheckoutFlow, EnableDirectProcessToPay, CustomerSideDisplay, EnableGuestDetailsPopup, EnableCashDrawer, EnableKDSPrint, SVCIdentification, EnableCombo, EnableQuickServe, QuickServeEnableKOT, QuickServeEnableKDS, QuickServeEnableKDSPrinter, ShowLoyalty, ShowRewardPoints, ShowPromoCode, EnableOnlinePayment, EnableQROrderAutoPrint, EnableComboPrint, EnableRequestService, EnableCookingInstructions, EnableDirectPaymentToProcess, EnableSkipSummaryScreen, EnableReceiptPrint, EnableVoiceSuccess, EnableNotificationSound, MenuNavigationMode, UpdatedOn)
            VALUES (1, @UPI, @Shop, @QR, @EnableKOT, @EnableKDS, @EnableCheckoutBill, @EnableCheckoutFlow, @EnableDirectProcessToPay, @CustomerSideDisplay, @EnableGuestDetailsPopup, @EnableCashDrawer, @EnableKDSPrint, @SVCIdentification, @EnableCombo, @EnableQuickServe, @QuickServeEnableKOT, @QuickServeEnableKDS, @QuickServeEnableKDSPrinter, @ShowLoyalty, @ShowRewardPoints, @ShowPromoCode, @EnableOnlinePayment, @EnableQROrderAutoPrint, @EnableComboPrint, @EnableRequestService, @EnableCookingInstructions, @EnableDirectPaymentToProcess, @EnableSkipSummaryScreen, @EnableReceiptPrint, @EnableVoiceSuccess, @EnableNotificationSound, @MenuNavigationMode, GETDATE());
          END
        END
      `);

    if (SVCIdentification !== undefined) {
      await pool.request()
        .input("SVCIdentification", sql.Bit, SVCIdentification ? 1 : 0)
        .query("UPDATE CompanySettings SET SVCIdentification = @SVCIdentification WHERE Id = '1'").catch(() => {});
    }

    invalidateCache();

    // Map req.body keys to DB column names for audit logging comparison (fall back to oldAppSettings if undefined)
    const newSettingsMapped = {
      UPI_ID: upiId !== undefined ? upiId : oldAppSettings.UPI_ID,
      ShopName: shopName !== undefined ? shopName : oldAppSettings.ShopName,
      PayNow_QR_Url: qrCodeUrl !== undefined ? qrCodeUrl : oldAppSettings.PayNow_QR_Url,
      EnableKOT: enableKOT !== undefined ? (enableKOT ? 1 : 0) : (oldAppSettings.EnableKOT ? 1 : 0),
      EnableKDS: enableKDS !== undefined ? (enableKDS ? 1 : 0) : (oldAppSettings.EnableKDS ? 1 : 0),
      EnableCheckoutBill: enableCheckoutBill !== undefined ? (enableCheckoutBill ? 1 : 0) : (oldAppSettings.EnableCheckoutBill ? 1 : 0),
      EnableCheckoutFlow: enableCheckoutFlow !== undefined ? (enableCheckoutFlow ? 1 : 0) : (oldAppSettings.EnableCheckoutFlow ? 1 : 0),
      EnableDirectProcessToPay: enableDirectProcessToPay !== undefined ? (enableDirectProcessToPay ? 1 : 0) : (oldAppSettings.EnableDirectProcessToPay ? 1 : 0),
      CustomerSideDisplay: customerSideDisplay !== undefined ? (customerSideDisplay ? 1 : 0) : (oldAppSettings.CustomerSideDisplay ? 1 : 0),
      EnableGuestDetailsPopup: enableGuestDetailsPopup !== undefined ? (enableGuestDetailsPopup ? 1 : 0) : (oldAppSettings.EnableGuestDetailsPopup ? 1 : 0),
      EnableCashDrawer: enableCashDrawer !== undefined ? (enableCashDrawer ? 1 : 0) : (oldAppSettings.EnableCashDrawer ? 1 : 0),
      EnableKDSPrint: enableKDSPrint !== undefined ? (enableKDSPrint ? 1 : 0) : (oldAppSettings.EnableKDSPrint ? 1 : 0),
      SVCIdentification: SVCIdentification !== undefined ? (SVCIdentification ? 1 : 0) : (oldAppSettings.SVCIdentification ? 1 : 0),
      EnableCombo: enableCombo !== undefined ? (enableCombo ? 1 : 0) : (oldAppSettings.EnableCombo ? 1 : 0),
      EnableQuickServe: enableQuickServe !== undefined ? (enableQuickServe ? 1 : 0) : (oldAppSettings.EnableQuickServe ? 1 : 0),
      QuickServeEnableKOT: quickServeEnableKOT !== undefined ? (quickServeEnableKOT ? 1 : 0) : (oldAppSettings.QuickServeEnableKOT !== undefined ? (oldAppSettings.QuickServeEnableKOT ? 1 : 0) : 1),
      QuickServeEnableKDS: quickServeEnableKDS !== undefined ? (quickServeEnableKDS ? 1 : 0) : (oldAppSettings.QuickServeEnableKDS !== undefined ? (oldAppSettings.QuickServeEnableKDS ? 1 : 0) : 1),
      QuickServeEnableKDSPrinter: quickServeEnableKDSPrinter !== undefined ? (quickServeEnableKDSPrinter ? 1 : 0) : (oldAppSettings.QuickServeEnableKDSPrinter !== undefined ? (oldAppSettings.QuickServeEnableKDSPrinter ? 1 : 0) : 1),
      ShowLoyalty: showLoyalty !== undefined ? (showLoyalty ? 1 : 0) : (oldAppSettings.ShowLoyalty ? 1 : 0),
      ShowRewardPoints: showRewardPoints !== undefined ? (showRewardPoints ? 1 : 0) : (oldAppSettings.ShowRewardPoints ? 1 : 0),
      ShowPromoCode: showPromoCode !== undefined ? (showPromoCode ? 1 : 0) : (oldAppSettings.ShowPromoCode ? 1 : 0),
      EnableOnlinePayment: enableOnlinePayment !== undefined ? (enableOnlinePayment ? 1 : 0) : (oldAppSettings.EnableOnlinePayment ? 1 : 0),
      EnableQROrderAutoPrint: enableQROrderAutoPrint !== undefined ? (enableQROrderAutoPrint ? 1 : 0) : (oldAppSettings.EnableQROrderAutoPrint ? 1 : 0),
      EnableComboPrint: enableComboPrint !== undefined ? (enableComboPrint ? 1 : 0) : (oldAppSettings.EnableComboPrint ? 1 : 0),
      EnableRequestService: enableRequestService !== undefined ? (enableRequestService ? 1 : 0) : (oldAppSettings.EnableRequestService ? 1 : 0),
      EnableCookingInstructions: enableCookingInstructions !== undefined ? (enableCookingInstructions ? 1 : 0) : (oldAppSettings.EnableCookingInstructions ? 1 : 0),
      EnableDirectPaymentToProcess: enableDirectPaymentToProcess !== undefined ? (enableDirectPaymentToProcess ? 1 : 0) : (oldAppSettings.EnableDirectPaymentToProcess ? 1 : 0),
      EnableSkipSummaryScreen: enableSkipSummaryScreen !== undefined ? (enableSkipSummaryScreen ? 1 : 0) : (oldAppSettings.EnableSkipSummaryScreen ? 1 : 0),
      EnableReceiptPrint: enableReceiptPrint !== undefined ? (enableReceiptPrint ? 1 : 0) : (oldAppSettings.EnableReceiptPrint ? 1 : 0),
      EnableVoiceSuccess: enableVoiceSuccess !== undefined ? (enableVoiceSuccess ? 1 : 0) : (oldAppSettings.EnableVoiceSuccess ? 1 : 0),
      EnableNotificationSound: enableNotificationSound !== undefined ? (enableNotificationSound ? 1 : 0) : (oldAppSettings.EnableNotificationSound ? 1 : 0),
      MenuNavigationMode: menuNavigationMode !== undefined ? menuNavigationMode : (oldAppSettings.MenuNavigationMode || "scroll")
    };

    try {
      await logSettingsDiff(pool, oldAppSettings, newSettingsMapped, userInfo);
    } catch (auditErr) {
      console.warn("⚠️ AppSettings audit logging warning:", auditErr.message);
    }

    res.json({ success: true, message: "Settings updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 GET Audit Logs
router.get("/audit-logs", async (req, res) => {
  try {
    const { category, search, limit = 100 } = req.query;
    const pool = await poolPromise;
    await initSettingsAuditTable(pool);

    let query = "SELECT TOP (@Limit) AuditId, Category, FieldName, FieldLabel, OldValue, NewValue, ModifiedBy, UserId, UserRole, CONVERT(VARCHAR, CreatedAt, 126) + '+08:00' AS CreatedAt FROM dbo.SettingsAuditLog WHERE OldValue <> NewValue AND OldValue IS NOT NULL AND NewValue IS NOT NULL AND OldValue <> '' AND NewValue <> '' AND ModifiedBy IS NOT NULL AND ModifiedBy <> '' AND ModifiedBy <> 'Admin' AND ModifiedBy <> 'ADMIN'";

    const request = pool.request().input("Limit", sql.Int, parseInt(String(limit)) || 100);

    if (category && category !== "ALL") {
      query += " AND Category = @Category";
      request.input("Category", sql.NVarChar, category);
    }

    if (search && String(search).trim()) {
      query += " AND (FieldLabel LIKE @Search OR ModifiedBy LIKE @Search OR OldValue LIKE @Search OR NewValue LIKE @Search)";
      request.input("Search", sql.NVarChar, `%${String(search).trim()}%`);
    }

    query += " ORDER BY CreatedAt DESC";

    const result = await request.query(query);
    res.json({ success: true, logs: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// 🔹 GET Kitchen Printers
router.get("/kitchen-printers", async (req, res) => {
  try {
    const pool = await poolPromise;

    // 1. Self-healing check for Cashier Printer (PrinterType = 1)
    const cashierCheck = await pool.request()
      .query("SELECT COUNT(*) as count FROM PrintMaster WHERE PrinterType = 1 AND IsActive = 1");
    if (cashierCheck.recordset[0].count === 0) {
      console.log("🛠️ Inserting default Cashier Printer row into PrintMaster...");
      const compSettings = await pool.request().query("SELECT TOP 1 PrinterIP FROM CompanySettings");
      const defaultIP = compSettings.recordset[0]?.PrinterIP || "192.168.0.20";
      await pool.request()
        .input("ip", sql.NVarChar, defaultIP)
        .query(`
          INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy)
          VALUES (NEWID(), 'Receipt Printer', @ip, @ip, 1, 1, 'Receipt Print', 0, 1, 1)
        `);
    }

    // 2. Self-healing check for TakeAway Printer (PrinterType = 3)
    const takeawayCheck = await pool.request()
      .query("SELECT COUNT(*) as count FROM PrintMaster WHERE PrinterType = 3 AND IsActive = 1");
    if (takeawayCheck.recordset[0].count === 0) {
      console.log("🛠️ Inserting default TakeAway Printer row into PrintMaster...");
      await pool.request().query(`
        INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy)
        VALUES (NEWID(), 'TakeAway', '192.168.0.20', '192.168.0.20', 3, 1, 'TakeAway', 6, 1, 1)
      `);
    }

    // 2.5 Self-healing check for KDS Printer (PrinterType = 4)
    const kdsCheck = await pool.request()
      .query("SELECT COUNT(*) as count FROM PrintMaster WHERE PrinterType = 4 AND IsActive = 1");
    if (kdsCheck.recordset[0].count === 0) {
      console.log("🛠️ Inserting default KDS Printer row into PrintMaster...");
      await pool.request().query(`
        INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy)
        VALUES (NEWID(), 'KDS Printer', '', '', 4, 1, 'KDS Printer', 9, 1, 1)
      `);
    }

    // 3. Fetch active categories (matching menu.js kitchens endpoint structure)
    const activeCatsResult = await pool.request().query(`
      SELECT cm.CategoryId, cm.CategoryName AS KitchenTypeName, ckt.KitchenTypeCode
      FROM CategoryMaster cm
      LEFT JOIN CategoryKitchenType ckt ON cm.CategoryId = ckt.CategoryId
      WHERE cm.IsActive = 1
    `);
    const rawActiveCats = activeCatsResult.recordset;

    // Filter out TEST categories/kitchens (same as menuStore)
    const activeCats = rawActiveCats.filter(
      k => k.KitchenTypeName && !k.KitchenTypeName.toUpperCase().includes("TEST")
    );

    // 4. Fetch all printers from PrintMaster
    const printersResult = await pool.request().query(`
      SELECT PrinterId, KitchenTypeValue, KitchenTypeName, PrinterPath, PrinterIP, PrinterType, IsActive, IsEnabled 
      FROM PrintMaster
    `);
    const allPrinters = printersResult.recordset;

    const responsePrinters = [];

    // Add Cashier printer (PrinterType = 1)
    const cashierPrinter = allPrinters.find(p => p.PrinterType === 1);
    if (cashierPrinter) {
      responsePrinters.push({
        ...cashierPrinter,
        IsActive: cashierPrinter.IsActive === true || cashierPrinter.IsActive === 1 ? 1 : 0,
        IsEnabled: cashierPrinter.IsEnabled === undefined || cashierPrinter.IsEnabled === null || cashierPrinter.IsEnabled === true || cashierPrinter.IsEnabled === 1 ? 1 : 0
      });
    }

    // Add TakeAway printer (PrinterType = 3)
    const takeawayPrinter = allPrinters.find(p => p.PrinterType === 3);
    if (takeawayPrinter) {
      responsePrinters.push({
        ...takeawayPrinter,
        IsActive: takeawayPrinter.IsActive === true || takeawayPrinter.IsActive === 1 ? 1 : 0,
        IsEnabled: takeawayPrinter.IsEnabled === undefined || takeawayPrinter.IsEnabled === null || takeawayPrinter.IsEnabled === true || takeawayPrinter.IsEnabled === 1 ? 1 : 0
      });
    }

    // Add KDS printer (PrinterType = 4)
    const kdsPrinter = allPrinters.find(p => p.PrinterType === 4);
    if (kdsPrinter) {
      responsePrinters.push({
        ...kdsPrinter,
        IsActive: kdsPrinter.IsActive === true || kdsPrinter.IsActive === 1 ? 1 : 0,
        IsEnabled: kdsPrinter.IsEnabled === undefined || kdsPrinter.IsEnabled === null || kdsPrinter.IsEnabled === true || kdsPrinter.IsEnabled === 1 ? 1 : 0
      });
    }

    // Map active categories to kitchen printers (PrinterType = 2)
    const seenCodes = new Set();
    for (const cat of activeCats) {
      // Default to code 2 (Indian) if no KitchenTypeCode is mapped in ckt (same as dishes query default)
      const code = parseInt(cat.KitchenTypeCode || '2');
      
      // Deduplicate on KitchenTypeValue so each printer code only has one configuration input
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);

      const match = allPrinters.find(p => p.PrinterType === 2 && p.KitchenTypeValue === code);
      if (match) {
        responsePrinters.push({
          PrinterId: match.PrinterId,
          KitchenTypeValue: code,
          KitchenTypeName: cat.KitchenTypeName,
          PrinterPath: match.PrinterPath,
          PrinterIP: match.PrinterIP || match.PrinterPath || "",
          PrinterType: 2,
          IsActive: match.IsActive === true || match.IsActive === 1 ? 1 : 0,
          IsEnabled: match.IsEnabled === undefined || match.IsEnabled === null || match.IsEnabled === true || match.IsEnabled === 1 ? 1 : 0
        });
      } else {
        // Virtual record for missing printer
        responsePrinters.push({
          PrinterId: null, // Indicates it needs to be inserted on save
          KitchenTypeValue: code,
          KitchenTypeName: cat.KitchenTypeName,
          PrinterPath: "",
          PrinterIP: "",
          PrinterType: 2,
          IsActive: 1,
          IsEnabled: 1
        });
      }
    }

    res.json(responsePrinters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function executePrinterUpdate(targetPool, printer) {
  if (!targetPool || !targetPool.connected) return;
  const targetId = printer.printerId || printer.id;
  const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(targetId));
  const printerIp = printer.ip || "";
  const isActiveValue = printer.isActive === 0 || printer.isActive === false ? 0 : 1;
  const isEnabledValue = printer.isEnabled === 0 || printer.isEnabled === false ? 0 : 1;

  if (printer.type === 2) {
    // Kitchen printer: update ALL rows matching this KitchenTypeValue OR KitchenTypeName to keep duplicates in sync
    const codeVal = parseInt(printer.id);
    await targetPool.request()
      .input("code", sql.Int, isNaN(codeVal) ? 0 : codeVal)
      .input("ip", sql.NVarChar, printerIp)
      .input("name", sql.NVarChar, printer.name || "Kitchen Printer")
      .input("isActive", sql.Bit, isActiveValue)
      .input("isEnabled", sql.Bit, isEnabledValue)
      .query(`
        UPDATE PrintMaster 
        SET PrinterPath = @ip, PrinterIP = @ip, KitchenTypeName = @name, PrinterName = @name, IsActive = @isActive, IsEnabled = @isEnabled
        WHERE (KitchenTypeValue = @code OR KitchenTypeName = @name) AND PrinterType = 2
      `);
  } else if (isGuid) {
    // Existing printer by GUID: update path, name, and active status
    await targetPool.request()
      .input("printerId", sql.UniqueIdentifier, targetId)
      .input("ip", sql.NVarChar, printerIp)
      .input("name", sql.NVarChar, printer.name || "Printer")
      .input("isActive", sql.Bit, isActiveValue)
      .input("isEnabled", sql.Bit, isEnabledValue)
      .query(`
        UPDATE PrintMaster 
        SET PrinterPath = @ip, PrinterIP = @ip, KitchenTypeName = @name, PrinterName = @name, IsActive = @isActive, IsEnabled = @isEnabled
        WHERE PrinterId = @printerId
      `);
  } else {
    // Cashier or Takeaway fallback by type
    await targetPool.request()
      .input("ip", sql.NVarChar, printerIp)
      .input("type", sql.Int, printer.type)
      .input("isActive", sql.Bit, isActiveValue)
      .input("isEnabled", sql.Bit, isEnabledValue)
      .query("UPDATE PrintMaster SET PrinterPath = @ip, PrinterIP = @ip, IsActive = @isActive, IsEnabled = @isEnabled WHERE PrinterType = @type");
  }

  // Sync to CompanySettings table if it's the Cashier printer
  if (printer.type === 1 || parseInt(printer.id) === 0) {
    await targetPool.request()
      .input("ip", sql.NVarChar, printerIp)
      .query("UPDATE CompanySettings SET PrinterIP = @ip");
  }
}

// 🔹 UPDATE Kitchen Printers
router.post("/kitchen-printers/update", async (req, res) => {
  try {
    const { printers } = req.body; // Array of { id, ip, type, name, printerId, isActive, isEnabled }
    const pool = await poolPromise;

    for (const printer of printers) {
      await executePrinterUpdate(pool, printer);
      if (isRemoteOnline()) {
        try {
          const rPool = getRemotePool();
          if (rPool && rPool.connected) {
            await executePrinterUpdate(rPool, printer);
          }
        } catch (rErr) {
          console.warn("[Settings] Remote printer update sync warning:", rErr.message);
        }
      }
    }

    // Clear menu cache so the new printer IsEnabled/PrinterIP configurations take effect immediately
    try {
      const menuRouter = require("./menu");
      if (menuRouter && typeof menuRouter.clearMenuCache === "function") {
        menuRouter.clearMenuCache();
      }
    } catch (cacheErr) {
      console.warn("Failed to clear menu cache:", cacheErr.message);
    }

    res.json({ success: true, message: "Printers updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 ADD Kitchen Printer
router.post("/kitchen-printers/add", async (req, res) => {
  try {
    const { name, ip } = req.body;
    const pool = await poolPromise;
    
    const addQuery = `
      DECLARE @nextVal INT = (SELECT ISNULL(MAX(KitchenTypeValue), 0) + 1 FROM PrintMaster);
      INSERT INTO PrintMaster (
        PrinterId, PrinterName, PrinterPath, PrinterIP, 
        PrinterType, PrintSection, KitchenTypeName, 
        KitchenTypeValue, IsActive, PrintCopy
      )
      VALUES (
        NEWID(), @name, @ip, @ip, 
        2, 1, @name, 
        @nextVal, 1, 1
      )
    `;

    await pool.request()
      .input("name", sql.NVarChar, name)
      .input("ip", sql.NVarChar, ip)
      .query(addQuery);

    if (isRemoteOnline()) {
      try {
        const rPool = getRemotePool();
        if (rPool && rPool.connected) {
          await rPool.request()
            .input("name", sql.NVarChar, name)
            .input("ip", sql.NVarChar, ip)
            .query(addQuery);
        }
      } catch (rErr) {
        console.warn("[Settings] Remote printer add sync warning:", rErr.message);
      }
    }

    res.json({ success: true, message: "Kitchen printer added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 DELETE Kitchen Printer (Soft Delete)
router.post("/kitchen-printers/delete", async (req, res) => {
  try {
    const { id } = req.body; // KitchenTypeValue
    const pool = await poolPromise;
    
    await pool.request()
      .input("id", sql.Int, id)
      .query("UPDATE PrintMaster SET IsActive = 0 WHERE KitchenTypeValue = @id");

    if (isRemoteOnline()) {
      try {
        const rPool = getRemotePool();
        if (rPool && rPool.connected) {
          await rPool.request()
            .input("id", sql.Int, id)
            .query("UPDATE PrintMaster SET IsActive = 0 WHERE KitchenTypeValue = @id");
        }
      } catch (rErr) {
        console.warn("[Settings] Remote printer delete sync warning:", rErr.message);
      }
    }

    res.json({ success: true, message: "Kitchen printer deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔹 ON-DEMAND Kitchen Sync (trigger immediately after adding kitchen from backoffice)
router.post("/sync-kitchens", async (req, res) => {
  try {
    const pool = await poolPromise;
    await syncKitchensToPrintMaster(pool);
    res.json({ success: true, message: "Kitchen sync completed. New kitchens auto-added to PrintMaster." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
