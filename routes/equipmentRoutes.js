const express = require("express");
const pool = require("../db");
const router = express.Router();


router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        e.equ_id,
        e.name,
        e.dev_id,
        d.name AS device_name,
        e.created_at
      FROM equipment e
      LEFT JOIN device d
        ON e.dev_id = d.dev_id
      ORDER BY e.created_at DESC
    `);

    return res.json(rows);
  } catch (error) {
    console.error("Get equipment error:", error.message);

    return res.status(500).json({
      message: "Unable to fetch equipment.",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const { equ_id, name, dev_id } = req.body;

    if (
      typeof equ_id !== "string" ||
      !equ_id.trim() ||
      equ_id.trim().length > 30
    ) {
      return res.status(400).json({
        message: "Equipment ID is required (maximum 30 characters).",
      });
    }

    if (typeof name !== "string" || !name.trim() || name.trim().length > 150) {
      return res.status(400).json({
        message: "Equipment name is required.",
      });
    }

    if (
      typeof dev_id !== "string" ||
      !dev_id.trim() ||
      dev_id.trim().length > 30
    ) {
      return res.status(400).json({
        message: "A valid device ID is required.",
      });
    }

    const equipmentId = equ_id.trim();
    const equipmentName = name.trim();
    const deviceId = dev_id.trim();

    const [devices] = await pool.execute(
      "SELECT dev_id FROM device WHERE dev_id = ?",
      [deviceId],
    );

    if (devices.length === 0) {
      return res.status(400).json({
        message: "The selected device does not exist.",
      });
    }

    await pool.execute(
      `INSERT INTO equipment (equ_id, name, dev_id)
       VALUES (?, ?, ?)`,
      [equipmentId, equipmentName, deviceId],
    );

    const [rows] = await pool.execute(
      `SELECT
         e.equ_id,
         e.name,
         e.dev_id,
         d.name AS device_name,
         e.created_at
       FROM equipment e
       LEFT JOIN device d ON e.dev_id = d.dev_id
       WHERE e.equ_id = ?`,
      [equipmentId],
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    console.error("Create equipment error:", error.message);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This equipment ID already exists.",
      });
    }

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({
        message: "The selected device does not exist.",
      });
    }

    return res.status(500).json({
      message: "Unable to create equipment.",
    });
  }
});

module.exports = router;
