const express = require("express");
const router = express.Router();
const { getSyncStats, triggerSyncProcess } = require("../services/syncService");
const { getPool } = require("../config/db");

// Get Hybrid DB & Sync status
router.get("/status", async (req, res) => {
  try {
    const stats = getSyncStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Force sync trigger from frontend
router.post("/trigger", async (req, res) => {
  try {
    triggerSyncProcess();
    res.json({
      success: true,
      message: "Sync process triggered successfully.",
      data: getSyncStats()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// View pending/failed items in sync queue
router.get("/queue", async (req, res) => {
  try {
    const localPool = getPool();
    if (!localPool) {
      return res.status(500).json({ success: false, error: "Local DB not connected" });
    }
    const result = await localPool.request().query(`
      SELECT TOP 100 SyncID, EntityName, EntityID, Action, Status, Retries, ErrorMessage, CreatedAt, SyncedAt
      FROM POS_SyncQueue
      ORDER BY SyncID DESC
    `);
    res.json({
      success: true,
      count: result.recordset.length,
      data: result.recordset
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
