const express = require("express");
const pool = require("../db");
const router = express.Router();

const selectLogsSql = `
  SELECT
    l.log_id,
    l.equ_id,
    e.name AS equipment_name,
    l.dev_id,
    d.name AS device_name,
    l.created_at,
    l.pmtwofive,
    l.tvoc,
    l.temp,
    l.hum,
    l.cotwo,
    l.pmten
  FROM equipment_log_data l
  LEFT JOIN equipment e
    ON l.equ_id = e.equ_id
  LEFT JOIN device d
    ON l.dev_id = d.dev_id
`;

async function fetchEquipmentLogs(req, res, requireIds = false) {
  try {
    const { equ_id, dev_id } = req.query;
    const conditions = [];
    const params = [];

    if (equ_id !== undefined) {
      if (typeof equ_id !== "string" || !equ_id.trim()) {
        return res.status(400).json({
          message: "Invalid equipment ID.",
        });
      }
      conditions.push("l.equ_id = ?");
      params.push(equ_id.trim());
    }

    if (dev_id !== undefined) {
      if (typeof dev_id !== "string" || !dev_id.trim()) {
        return res.status(400).json({
          message: "Invalid device ID.",
        });
      }
      conditions.push("l.dev_id = ?");
      params.push(dev_id.trim());
    }

    if (requireIds && conditions.length === 0) {
      return res.status(400).json({
        message: "Provide an equipment ID or device ID.",
      });
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.execute(
      `${selectLogsSql} ${whereSql}`,
      params
    );
    return res.json(rows);
  } catch (error) {
    console.error("Get equipment logs error:", error);
    return res.status(500).json({
      message: "Unable to fetch equipment logs.",
    });
  }
}

router.get("/", (req, res) => {
  return fetchEquipmentLogs(req, res);
});

router.get("/by-ids", (req, res) => {
  return fetchEquipmentLogs(req, res, true);
});


router.post("/logs", async (req, res) => {
  try {
    const { equ_id, dev_id } = req.body;
    const fields = [
      "pmtwofive",
      "tvoc",
      "temp",
      "hum",
      "cotwo",
      "pmten",
    ];
    if (
      typeof equ_id !== "string" ||
      typeof dev_id !== "string" ||
      !equ_id.trim() ||
      !dev_id.trim()
    ) {
      return res.status(400).json({
        message: "Equipment ID and device ID are required.",
      });
    }

    const readings = {};
    for (const field of fields) {
      const value = req.body[field];

      if (
        value === null ||
        value === undefined ||
        value === "" ||
        !Number.isFinite(Number(value))
      ) {
        return res.status(400).json({
          message: `A valid ${field} reading is required.`,
        });
      }
      readings[field] = Number(value);
    }
    
    const [equipment] = await pool.execute(
      `SELECT equ_id
       FROM equipment
       WHERE equ_id = ? AND dev_id = ?`,
      [equ_id.trim(), dev_id.trim()]
    );

    if (equipment.length === 0) {
      return res.status(400).json({
        message: "The equipment and device association was not found.",
      });
    }

    const [result] = await pool.execute(
      `INSERT INTO equipment_log_data (
         equ_id,
         dev_id,
         pmtwofive,
         tvoc,
         temp,
         hum,
         cotwo,
         pmten
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        equ_id.trim(),
        dev_id.trim(),
        readings.pmtwofive,
        readings.tvoc,
        readings.temp,
        readings.hum,
        readings.cotwo,
        readings.pmten,
      ]
    );

    return res.status(201).json({
      message: "Sensor reading saved successfully.",
      log_id: result.insertId,
    });
  } catch (error) {
    console.error("Save sensor reading error:", error.message);

    return res.status(500).json({
      message: "Unable to save sensor reading.",
    });
  }
});

module.exports = router;
