const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { getPool, sql } = require("../config/db");

let isWorkerRunning = false;
let workerIntervalId = null;
let lastHeartbeatUpdate = 0;

function parseFormatting(content) {
  const chunks = [];
  const tagRegex = /(\[C\]|\[L\]|\[R\]|<\/?B>|<font size='big'>|<font size='normal'>|<\/font>)/gi;
  const parts = content.split(tagRegex);

  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === "[c]") {
      chunks.push(Buffer.from([0x1B, 0x61, 0x01]));
    } else if (lower === "[l]") {
      chunks.push(Buffer.from([0x1B, 0x61, 0x00]));
    } else if (lower === "[r]") {
      chunks.push(Buffer.from([0x1B, 0x61, 0x02]));
    } else if (lower === "<b>") {
      chunks.push(Buffer.from([0x1B, 0x45, 0x01]));
    } else if (lower === "</b>") {
      chunks.push(Buffer.from([0x1B, 0x45, 0x00]));
    } else if (lower === "<font size='big'>" || lower === '<font size="big">') {
      chunks.push(Buffer.from([0x1D, 0x21, 0x11]));
    } else if (lower === "<font size='normal'>" || lower === '<font size="normal">' || lower === "</font>") {
      chunks.push(Buffer.from([0x1D, 0x21, 0x00]));
    } else {
      chunks.push(Buffer.from(part, "utf-8"));
    }
  }

  chunks.push(Buffer.from([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00]));
  return Buffer.concat(chunks);
}

const CASH_DRAWER_PAYLOADS = new Set(["G3AAGRk=", "EBQBAAU="]);

async function sendToPrinter(ip, port, content) {
  const targetPort = port || 9100;
  const trimmed = (content || "").trim();
  const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && (trimmed.length % 4 === 0);
  const isCashDrawer = CASH_DRAWER_PAYLOADS.has(trimmed);

  let payload;
  if (isCashDrawer || isBase64) {
    payload = Buffer.from(trimmed, "base64");
  } else {
    payload = parseFormatting(content);
  }

  const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip.trim());
  if (!isIp && ip.trim().length > 0) {
    try {
      await sendToWindowsPrinter(ip.trim(), payload);
      return;
    } catch (winErr) {
      console.warn(`⚠️ [PrintWorker] Windows Spooler print for '${ip}' failed: ${winErr.message}. Attempting network fallback...`);
      let fallbackIp = null;
      try {
        const pool = getPool();
        if (pool && pool.connected) {
          const csRes = await pool.request().query("SELECT TOP 1 PrinterIP FROM CompanySettings WHERE Id = '1'").catch(() => ({ recordset: [] }));
          if (csRes.recordset && csRes.recordset.length > 0 && csRes.recordset[0].PrinterIP) {
            const cand = csRes.recordset[0].PrinterIP.trim();
            if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cand)) {
              fallbackIp = cand;
            }
          }
          if (!fallbackIp) {
            const pmRes = await pool.request().query("SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP FROM PrintMaster WHERE IsActive = 1 AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')").catch(() => ({ recordset: [] }));
            if (pmRes.recordset && pmRes.recordset.length > 0 && pmRes.recordset[0].PrinterIP) {
              const cand = pmRes.recordset[0].PrinterIP.trim();
              if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cand)) {
                fallbackIp = cand;
              }
            }
          }
        }
      } catch (dbErr) {
        console.warn(`⚠️ [PrintWorker] Fallback IP lookup error:`, dbErr.message);
      }

      if (fallbackIp) {
        console.log(`🖨️ [PrintWorker] Sending to fallback network printer: ${fallbackIp}:${targetPort}`);
        return sendViaTcp(fallbackIp, targetPort, payload);
      }
      throw winErr;
    }
  }

  return sendViaTcp(ip.trim(), targetPort, payload);
}

function sendViaTcp(ip, port, payload) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error(`Connection to printer at ${ip}:${port} timed out`));
      }
    }, 4000);

    client.connect(port, ip, () => {
      clearTimeout(timer);
      client.write(payload, () => {
        client.end();
      });
    });

    client.on("close", () => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(err);
      }
    });
  });
}

function _sendViaPowerShell(cleanName, payload) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `unipro_print_ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.bin`);
    fs.writeFileSync(tmpFile, payload);

    const safePrinterName = cleanName.replace(/'/g, "''");
    const safeFilePath = tmpFile.replace(/'/g, "''");

    const psScript = `
$p = '${safePrinterName}';
$f = '${safeFilePath}';
if (-not (Test-Path $f)) { exit 1 }
$b = [System.IO.File]::ReadAllBytes($f);
$c = @'
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public class DOCINFO1 { public string pDocName; public string pOutputFile; public string pDataType; }
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", CharSet=CharSet.Unicode, ExactSpelling=false, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, DOCINFO1 pDocInfo);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.drv", ExactSpelling=true, CallingConvention=CallingConvention.StdCall, SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static bool SendBytes(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        DOCINFO1 di = new DOCINFO1(); di.pDocName = "UniPro POS Receipt"; di.pDataType = "RAW";
        if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
        if (!StartPagePrinter(hPrinter)) { EndDocPrinter(hPrinter); ClosePrinter(hPrinter); return false; }
        int written = 0; bool ok = WritePrinter(hPrinter, bytes, bytes.Length, out written);
        EndPagePrinter(hPrinter); EndDocPrinter(hPrinter); ClosePrinter(hPrinter);
        return ok && (written == bytes.Length);
    }
}
'@;
if (-not ([System.Management.Automation.PSTypeName]'RawPrinter').Type) { Add-Type -TypeDefinition $c }
if ([RawPrinter]::SendBytes($p, $b)) { Write-Host "SUCCESS" } else { Write-Host "FAILED"; exit 1 }
`;

    const encodedScript = Buffer.from(psScript, "utf16le").toString("base64");
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err || stdout.trim() !== "SUCCESS") {
        reject(new Error(`Windows Printer '${cleanName}' print failed: ${err ? err.message : stdout}`));
      } else {
        resolve();
      }
    });
  });
}

function sendToWindowsPrinter(printerName, payload) {
  return new Promise((resolve, reject) => {
    let cleanName = printerName.trim();
    if (cleanName.toLowerCase().startsWith("\\\\localhost\\")) {
      cleanName = cleanName.substring(13);
    }
    const tmpFile = path.join(os.tmpdir(), `unipro_print_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.bin`);
    fs.writeFileSync(tmpFile, payload);

    // Look for ultra-fast native rawprint.exe (< 100ms)
    const possiblePaths = [
      path.join(__dirname, "..", "bin", "rawprint.exe"),
      path.join(__dirname, "bin", "rawprint.exe"),
      path.join(process.cwd(), "bin", "rawprint.exe"),
      path.join(process.cwd(), "backend", "bin", "rawprint.exe"),
      path.join(process.resourcesPath || "", "backend", "bin", "rawprint.exe"),
      path.join(process.resourcesPath || "", "bin", "rawprint.exe"),
    ];
    const rawPrintExe = possiblePaths.find((p) => p && fs.existsSync(p));

    if (rawPrintExe) {
      const { execFile } = require("child_process");
      execFile(rawPrintExe, [cleanName, tmpFile], { timeout: 4000 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        if (err || !stdout || !stdout.includes("SUCCESS")) {
          const detail = err ? err.message : (stdout || stderr || "Unknown error");
          console.warn(`⚠️ [PrintWorker] Native rawprint failed for '${cleanName}': ${detail}. Falling back to PowerShell...`);
          _sendViaPowerShell(cleanName, payload).then(resolve).catch(reject);
        } else {
          resolve();
        }
      });
      return;
    }

    _sendViaPowerShell(cleanName, payload).then(resolve).catch(reject);
  });
}

async function processPrintQueue() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    const pool = getPool();
    if (!pool || !pool.connected) {
      isWorkerRunning = false;
      return;
    }

    // Update heartbeat every 3 seconds (threshold in bridge-status is 8 seconds) to eliminate redundant SQL queries
    const now = Date.now();
    if (now - lastHeartbeatUpdate >= 3000) {
      lastHeartbeatUpdate = now;
      await pool.request().query("UPDATE CompanySettings SET LastBridgeHeartbeat = GETDATE() WHERE Id = '1'").catch(() => {});
    }

    // 🚀 ATOMIC JOB CLAIMING (ROWLOCK, READPAST, UPDLOCK):
    // Atomically transition up to 3 pending jobs into PROCESSING with Attempts incremented.
    // READPAST guarantees that multiple concurrent workers or processes NEVER block or collide on the same job.
    const claimRes = await pool.request().query(`
      WITH NextJobs AS (
        SELECT TOP 3 JobId, Status, ProcessedOn, Attempts, PrinterIp, PrinterPort, PrinterName, Content
        FROM PrintJobQueue WITH (ROWLOCK, READPAST, UPDLOCK)
        WHERE Status = 'PENDING' AND (Attempts < 3)
        ORDER BY CreatedOn ASC
      )
      UPDATE NextJobs
      SET Status = 'PROCESSING',
          ProcessedOn = GETDATE(),
          Attempts = Attempts + 1
      OUTPUT 
        inserted.JobId, 
        inserted.Status, 
        inserted.Attempts, 
        inserted.PrinterIp, 
        inserted.PrinterPort, 
        inserted.PrinterName, 
        inserted.Content;
    `).catch((err) => {
      console.warn("⚠️ [PrintWorker] Atomic claim error:", err.message);
      return { recordset: [] };
    });

    const jobs = claimRes.recordset || [];
    for (const job of jobs) {
      const { JobId, PrinterIp, PrinterPort, Content, Attempts } = job;
      if (!Content || !PrinterIp || PrinterIp.trim() === "") {
        await pool.request()
          .input("JobId", sql.UniqueIdentifier, JobId)
          .query("UPDATE PrintJobQueue SET Status = 'FAILED', ErrorMessage = 'Missing printer target IP or name' WHERE JobId = @JobId")
          .catch(() => {});
        continue;
      }

      try {
        await sendToPrinter(PrinterIp, PrinterPort, Content);
        await pool.request()
          .input("JobId", sql.UniqueIdentifier, JobId)
          .query("UPDATE PrintJobQueue SET Status = 'COMPLETED', CompletedOn = GETDATE() WHERE JobId = @JobId")
          .catch(() => {});
        console.log(`🖨️ [PrintWorker] Print job ${JobId} completed successfully on ${PrinterIp}:${PrinterPort || 9100}`);
      } catch (err) {
        console.warn(`⚠️ [PrintWorker] Print job ${JobId} attempt ${Attempts} failed on ${PrinterIp}: ${err.message}`);
        const nextStatus = (Attempts >= 3) ? 'FAILED' : 'PENDING';
        await pool.request()
          .input("JobId", sql.UniqueIdentifier, JobId)
          .input("ErrMsg", sql.NVarChar(sql.MAX), err.message)
          .query(`UPDATE PrintJobQueue SET Status = '${nextStatus}', ErrorMessage = @ErrMsg WHERE JobId = @JobId`)
          .catch(() => {});
      }
    }
  } catch (err) {
    console.warn("⚠️ [PrintWorker] Loop error:", err.message);
  } finally {
    isWorkerRunning = false;
  }
}

// 🔄 CRASH RECOVERY: On backend startup, safely recover abandoned PROCESSING jobs older than 60 seconds back to PENDING
async function recoverAbandonedPrintJobs() {
  try {
    const pool = getPool();
    if (!pool || !pool.connected) return;
    const res = await pool.request().query(`
      UPDATE PrintJobQueue
      SET Status = 'PENDING'
      WHERE Status = 'PROCESSING'
        AND (ProcessedOn < DATEADD(SECOND, -60, GETDATE()) OR ProcessedOn IS NULL)
        AND Attempts < 3;
    `);
    const recovered = res.rowsAffected[0] || 0;
    if (recovered > 0) {
      console.log(`🖨️ [PrintWorker] Recovered ${recovered} abandoned PROCESSING jobs back to PENDING.`);
    }
  } catch (err) {
    console.warn("⚠️ [PrintWorker] Abandoned job recovery error:", err.message);
  }
}

function startPrintQueueWorker() {
  if (workerIntervalId) return;
  console.log("🖨️ [PrintWorker] Starting Local Background Print Queue Worker with Atomic Claiming (every 500ms)...");
  recoverAbandonedPrintJobs();
  workerIntervalId = setInterval(processPrintQueue, 500);
  processPrintQueue();
}

module.exports = {
  startPrintQueueWorker,
  processPrintQueue,
  sendToPrinter
};
