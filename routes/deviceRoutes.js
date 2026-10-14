const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET all devices
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT dev_id, name, created_at
      FROM device
      ORDER BY created_at DESC, dev_id ASC
    `);

    return res.json(rows);
  } catch (error) {
    console.error("Get devices error:", error.message);

    return res.status(500).json({
      message: "Unable to fetch devices.",
    });
  }
});

// CREATE a device
router.post("/", async (req, res) => {
  try {
    const { dev_id, name } = req.body;

    if (
      typeof dev_id !== "string" ||
      !dev_id.trim() ||
      dev_id.trim().length > 30
    ) {
      return res.status(400).json({
        message: "Device ID is required and must not exceed 30 characters.",
      });
    }

    if (typeof name !== "string" || !name.trim() || name.trim().length > 150) {
      return res.status(400).json({
        message: "Device name is required and must not exceed 150 characters.",
      });
    }

    const deviceId = dev_id.trim();
    const deviceName = name.trim();

    await pool.execute(
      `INSERT INTO device (dev_id, name)
       VALUES (?, ?)`,
      [deviceId, deviceName],
    );

    const [rows] = await pool.execute(
      `SELECT dev_id, name, created_at
       FROM device
       WHERE dev_id = ?`,
      [deviceId],
    );

    return res.status(201).json({
      message: "Device created successfully.",
      device: rows[0],
    });
  } catch (error) {
    console.error("Create device error:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This device ID already exists.",
      });
    }

    return res.status(500).json({
      message: "Unable to create device.",
    });
  }
});

module.exports = router;
