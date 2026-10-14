const express = require("express");
const pool = require("../db");
const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    const [[devices]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM device",
    );
    const [[equipment]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM equipment",
    );
    const [[logs]] = await pool.execute(
      "SELECT COUNT(*) AS total FROM equipment_log_data",
    );
    res.json({
      totalDevices: devices.total,
      totalEquipment: equipment.total,
      totalLogs: logs.total,
    });
  } catch (error) {
    console.error("Dashboard summary error:", error.message);
    res.status(500).json({
      message: "Unable to load dashboard summary.",
    });
  }
});

module.exports = router;
