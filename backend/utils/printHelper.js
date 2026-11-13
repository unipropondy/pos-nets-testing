/**
 * printHelper.js
 * Backend utility to format ESC/POS thermal text for KOT and KDS prints.
 * Mirrors the formatKOTThermalText logic in the frontend UniversalPrinter.ts
 * so the backend can queue print jobs directly without relying on the frontend.
 */

/**
 * Format KOT or KDS thermal ESC/POS text.
 * @param {object} data - { orderId, orderNo, tableNo, waiterName, items, kitchenName }
 * @param {string} type - 'NEW' | 'ADDITIONAL' | 'REPRINT' | 'KDS_PRINT'
 * @returns {string} ESC/POS formatted text
 */
function formatKOTThermalText(data, type = 'NEW') {
  // ── Type title ──────────────────────────────────────────────────────
  const title =
    type === 'KDS_PRINT'    ? 'KDS PRINT'
    : type === 'REPRINT'    ? 'REPRINT'
    : type === 'ADDITIONAL' ? 'ADDITIONAL ORDER'
    : 'NEW ORDER';

  const items       = (data.items || []).filter(i => (i.status || i.Status || '').toUpperCase() !== 'VOIDED');
  const tableNo     = data.tableNo     || 'N/A';
  const rawWaiter   = data.waiterName  || 'Staff';
  const isQuick     = !!(data.isQuickServe || data.isQuick || data.isQuickServeMode || data.orderContext?.isQuickServe || data.context?.orderType === 'QUICK_SERVE' || data.orderType === 'QUICK_SERVE' || data.section === 'QUICK_SERVE' || (typeof rawWaiter === 'string' && rawWaiter.toLowerCase().includes('(quick serve)')));
  const cleanTableNo = (tableNo || '').replace(/^table\s+/gi, '').trim() || tableNo;
  const displayTable = isQuick ? (cleanTableNo.toLowerCase().includes('(quick serve)') ? cleanTableNo : `${cleanTableNo} (quick serve)`) : tableNo;
  const waiter      = isQuick ? (rawWaiter.replace(/\s*\(quick serve\)/gi, '').trim() || 'Staff') : rawWaiter;
  const orderNo     = data.orderNo     || data.orderId || '';
  const kitchenName = data.kitchenName || '';

  // ── Timestamp ───────────────────────────────────────────────────────
  const now = data.date ? new Date(data.date) : (data.createdAt ? new Date(data.createdAt) : new Date());
  const dateStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day:'2-digit', month:'2-digit', year:'2-digit' }).format(now);
  const timeStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour:'2-digit', minute:'2-digit', hour12:false }).format(now);

  const DIV = '[L]------------------------------------------------\n';

  // ── HEADER ──────────────────────────────────────────────────────────
  let text = '';
  // 1.5 cm white space (approx 4 empty lines) at the top
  text += '[L]\n'.repeat(4);
  text += `[C]<font size='big'><B>${title}</B></font>\n`;
  text += `[C]<B>${dateStr}  ${timeStr}</B>\n`;
  text += DIV;

  // TABLE visible at top for both KOT and KDS
  text += `[C]<font size='big'><B>TABLE: ${displayTable}</B></font>\n`;
  text += DIV;

  text += "[L]<B>QTY  ITEM</B>\n";
  text += DIV;

  // ── ITEMS ───────────────────────────────────────────────────────────
  if (type === 'KDS_PRINT') {
    // KDS: group by kitchen section
    const groups = {};
    items.forEach(item => {
      const k = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || 'KITCHEN').toUpperCase().trim();
      if (!groups[k]) groups[k] = [];
      groups[k].push(item);
    });

    for (const [kName, groupItems] of Object.entries(groups)) {
      text += `[C]<B>--- ${kName} ---</B>\n`;
      text += DIV;
      groupItems.forEach((item, idx) => {
        text += _formatItem(item);
        if (idx < groupItems.length - 1) text += '[L]\n';
      });
      text += DIV;
    }
  } else {
    // KOT: group by kitchen section (same as KDS, for alignment)
    const kotGroups = {};
    items.forEach(item => {
      const k = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || 'KITCHEN').toUpperCase().trim();
      if (!kotGroups[k]) kotGroups[k] = [];
      kotGroups[k].push(item);
    });

    const kotGroupEntries = Object.entries(kotGroups);
    kotGroupEntries.forEach(([kName, groupItems], gIdx) => {
      // Only show section header if there are multiple kitchens
      if (kotGroupEntries.length > 1) {
        text += `[C]<B>--- ${kName} ---</B>\n`;
        text += DIV;
      }
      groupItems.forEach((item, idx) => {
        text += _formatItem(item);
        if (idx < groupItems.length - 1) text += '[L]\n';
      });
      text += DIV;
    });
  }

  // ── FOOTER ──────────────────────────────────────────────────────────
  text += `[L]<B>Order By : ${waiter}</B>\n`;
  text += `[L]<B>Order No : ${orderNo}</B>\n`;

  if (type !== 'KDS_PRINT') {
    // KOT: Kitchen Name + Table Number always at the very bottom
    const kotLabel = kitchenName && kitchenName !== 'KDS'
      ? (tableNo && tableNo !== 'N/A'
          ? `${kitchenName.toUpperCase()}  /  T.NO : ${tableNo}`
          : kitchenName.toUpperCase())
      : (tableNo && tableNo !== 'N/A'
          ? `T.NO : ${tableNo}`
          : '');
    if (kotLabel) {
      text += DIV;
      text += `[C]<B>${kotLabel}</B>\n`;
      text += DIV;
    }
  }

  // Minimal feed lines at end to prevent paper waste
  text += '[L]\n';

  return text;
}

/**
 * Word-wrap a string to fit within `maxChars` per line.
 * Returns an array of lines. Only wraps when truly needed.
 */
function _wrapText(str, maxChars) {
  const words = String(str || '').split(' ');
  const result = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxChars) {
      current += ' ' + word;
    } else {
      result.push(current);
      current = word;
    }
  }
  if (current) result.push(current);
  return result.length ? result : [''];
}

/**
 * Format a single item row for ESC/POS output.
 *
 * Width reference (80mm paper):
 *   Normal font : 48 chars/line
 *   Strategy    : QTY in bold, item name in bold (normal size)
 *                 Modifiers in bold with + / - prefix
 */
function _formatItem(item) {
  let text = '';
  const qtyNum   = item.quantity || item.qty || 1;
  const itemName = item.name     || item.DishName || '';

  // Item name: normal font size, bold, wrapped at 20 chars for big font
  const DISH_WRAP = 20;
  const BIG_MOD_WRAP = 20;

  _wrapText(itemName.replace(/\n/g, ' '), DISH_WRAP).forEach((chunk, idx) => {
    if (idx === 0) {
      text += `[L]<font size='big'><B>[${qtyNum}] ${chunk}</B></font>\n`;
    } else {
      text += `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
    }
  });

  // Song name
  const songName = item.songName || item.SongName || '';
  if (songName) text += `[L]<font size='big'><B>  ♪ ${songName}</B></font>\n`;

  // Takeaway flag
  const isTakeaway = !!(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
  if (isTakeaway) text += `[L]<font size='big'><B>  >> TAKEAWAY <<</B></font>\n`;

  // Modifiers
  if (item.modifiers && item.modifiers.length > 0) {
    item.modifiers.forEach(m => {
      const modName = m.ModifierName || m.modifierName || m.name || m.ModifierNameEn || '';
      if (modName) {
        _wrapText(modName, BIG_MOD_WRAP).forEach((chunk, idx) => {
          text += idx === 0
            ? `[L]<font size='big'><B>  + ${chunk}</B></font>\n`
            : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
        });
      }
    });
  }

  // Combo selections
  let comboSels = item.comboSelections || item.selectedCombos || item.combos;
  if (!comboSels || (Array.isArray(comboSels) && comboSels.length === 0)) {
    const rawCombo = item.ComboDetailsJSON || item.comboDetailsJSON || item.ComboDetails || item.comboDetails;
    if (rawCombo) {
      if (typeof rawCombo === 'string') {
        try {
          const parsed = JSON.parse(rawCombo);
          comboSels = Array.isArray(parsed) ? parsed : (parsed.groups || parsed.items || parsed.selections || []);
        } catch (e) {
          comboSels = [];
        }
      } else if (Array.isArray(rawCombo)) {
        comboSels = rawCombo;
      } else if (typeof rawCombo === 'object') {
        comboSels = rawCombo.groups || rawCombo.items || rawCombo.selections || [];
      }
    }
  }

  if (Array.isArray(comboSels) && comboSels.length > 0) {
    comboSels.forEach(g => {
      const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
      if (Array.isArray(choices)) {
        choices.forEach(opt => {
          const optName = opt.name || opt.DishName || opt.itemName || '';
          if (optName) {
            _wrapText(optName, BIG_MOD_WRAP).forEach((chunk, idx) => {
              text += idx === 0
                ? `[L]<font size='big'><B>  - ${chunk}</B></font>\n`
                : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
            });
          }
        });
      }
    });
  }

  // Remarks / Note
  const noteText = item.note || item.notes || item.Remarks || item.remarks;
  if (noteText) {
    _wrapText(noteText, BIG_MOD_WRAP).forEach((chunk, idx) => {
      text += idx === 0 
        ? `[L]<font size='big'><B>  * ${chunk}</B></font>\n` 
        : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
    });
  }

  return text;
}

/**
 * Queue KOT and KDS print jobs directly into PrintJobQueue for a QR order.
 * Called by the backend /send route after the order transaction commits.
 * This avoids the duplicate-print risk that comes from frontend-socket-triggered printing.
 *
 * @param {object} pool  - mssql connection pool
 * @param {object} sql   - mssql sql object
 * @param {object} opts  - { orderId, tableNo, sentItems, isAdditional }
 */
async function queueQRPrintJobs(pool, sql, opts) {
  const { orderId, tableNo, sentItems = [], isAdditional = false } = opts;
  const type = isAdditional ? 'ADDITIONAL' : 'NEW';
  const STORE_ID = 'STORE_001';

  // 1. Group items by KitchenTypeCode → one KOT job per kitchen
  const kitchenGroups = {};
  sentItems.forEach(item => {
    const kCode = String(item.KitchenTypeCode || item.kitchenTypeCode || '0');
    if (!kitchenGroups[kCode]) {
      kitchenGroups[kCode] = {
        items: [],
        kitchenName: item.KitchenTypeName || item.kitchenTypeName || 'KITCHEN',
        kitchenTypeValue: kCode,
      };
    }
    kitchenGroups[kCode].items.push(item);
  });

  for (const [kCode, group] of Object.entries(kitchenGroups)) {
    const kotData = {
      orderId,
      orderNo: orderId,
      tableNo,
      waiterName: 'QR Order',
      items: group.items,
      kitchenName: group.kitchenName,
    };
    const thermalText = formatKOTThermalText(kotData, type);

    // Resolve kitchen printer IP from PrintMaster
    let printerIp = '';
    let printerName = '';
    try {
      const printerRes = await pool.request()
        .input('KTN', sql.NVarChar(100), group.kitchenName || '')
        .query(`
          SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
          FROM PrintMaster
          WHERE PrinterType = 2
            AND LOWER(TRIM(KitchenTypeName)) = LOWER(TRIM(@KTN))
            AND IsActive = 1 AND IsEnabled = 1
            AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
        `);
      if (printerRes.recordset.length > 0) {
        printerIp   = printerRes.recordset[0].PrinterIP;
        printerName = printerRes.recordset[0].PrinterName;
      }
    } catch (err) {
      console.warn(`[PrintHelper] Could not resolve kitchen printer for name=${group.kitchenName}:`, err.message);
    }

    if (!printerIp) {
      console.warn(`[PrintHelper] No kitchen printer IP for KTV=${kCode} — skipping KOT`);
      continue;
    }

    const jobId = require('crypto').randomUUID();
    await pool.request()
      .input('JobId',       sql.UniqueIdentifier, jobId)
      .input('StoreId',     sql.NVarChar(50),     STORE_ID)
      .input('PrinterName', sql.NVarChar(100),    printerName)
      .input('PrinterIp',   sql.NVarChar(100),    printerIp)
      .input('PrinterPort', sql.Int,              9100)
      .input('Content',     sql.NVarChar(sql.MAX), thermalText)
      .query(`
        INSERT INTO PrintJobQueue
          (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
        VALUES
          (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
      `);
    console.log(`[PrintHelper] ✅ KOT queued for kitchen "${group.kitchenName}" → ${printerIp} [job: ${jobId}]`);
  }

  // 2. Queue KDS print (printerType = 4) — one job with ALL items grouped by kitchen
  try {
    const kdsRes = await pool.request()
      .query(`
        SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
        FROM PrintMaster
        WHERE PrinterType = 4 AND IsActive = 1
          AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
      `);

    if (kdsRes.recordset.length > 0) {
      const { PrinterIP, PrinterName } = kdsRes.recordset[0];
      const kdsData = {
        orderId,
        orderNo: orderId,
        tableNo,
        waiterName: 'QR Order',
        items: sentItems,
        kitchenName: 'KDS',
      };
      const kdsText = formatKOTThermalText(kdsData, 'KDS_PRINT');
      const kdsJobId = require('crypto').randomUUID();
      await pool.request()
        .input('JobId',       sql.UniqueIdentifier, kdsJobId)
        .input('StoreId',     sql.NVarChar(50),     STORE_ID)
        .input('PrinterName', sql.NVarChar(100),    PrinterName)
        .input('PrinterIp',   sql.NVarChar(100),    PrinterIP)
        .input('PrinterPort', sql.Int,              9100)
        .input('Content',     sql.NVarChar(sql.MAX), kdsText)
        .query(`
          INSERT INTO PrintJobQueue
            (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
          VALUES
            (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
        `);
      console.log(`[PrintHelper] ✅ KDS queued → ${PrinterIP} [job: ${kdsJobId}]`);
    }
  } catch (kdsErr) {
    console.warn('[PrintHelper] KDS print queue failed:', kdsErr.message);
  }
}

module.exports = { formatKOTThermalText, queueQRPrintJobs };
