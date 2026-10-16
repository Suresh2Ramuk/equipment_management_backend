const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authmiddleware");
const requirePermission = authenticateToken.requirePermission;

const router = express.Router();

function validId(value) {
  return (
    typeof value === "string" && /^[A-Za-z0-9._-]{1,30}$/.test(value.trim())
  );
}

function validName(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 150
  );
}

// Read devices. A user needs devices.view even if they call the API directly.
router.get(
  "/",
  authenticateToken,
  requirePermission("devices.view"),
  async (req, res) => {
    try {
      const [rows] = await pool.execute(`
      SELECT dev_id, name, created_at
      FROM device
      ORDER BY created_at DESC, dev_id ASC
    `);
      return res.json(rows);
    } catch (error) {
      console.error("Get devices error:", error.message);
      return res.status(500).json({ message: "Unable to fetch devices." });
    }
  },
);

// Create a device. dev_id is a stable key because equipment references it.
router.post(
  "/",
  authenticateToken,
  requirePermission("devices.create"),
  async (req, res) => {
    try {
      const { dev_id, name } = req.body ?? {};
      if (!validId(dev_id)) {
        return res.status(400).json({
          message:
            "Device ID is required, may contain letters, numbers, dot, underscore or hyphen, and must be at most 30 characters.",
        });
      }
      if (!validName(name)) {
        return res
          .status(400)
          .json({
            message:
              "Device name is required and must not exceed 150 characters.",
          });
      }

      const deviceId = dev_id.trim();
      const deviceName = name.trim();
      await pool.execute("INSERT INTO device (dev_id, name) VALUES (?, ?)", [
        deviceId,
        deviceName,
      ]);
      const [rows] = await pool.execute(
        "SELECT dev_id, name, created_at FROM device WHERE dev_id = ? LIMIT 1",
        [deviceId],
      );
      return res
        .status(201)
        .json({ message: "Device created successfully.", device: rows[0] });
    } catch (error) {
      console.error("Create device error:", error.message);
      if (error.code === "ER_DUP_ENTRY") {
        return res
          .status(409)
          .json({ message: "This device ID already exists." });
      }
      return res.status(500).json({ message: "Unable to create device." });
    }
  },
);

// Update the device name only. The ID stays stable so equipment/log references are preserved.
router.put(
  "/:devId",
  authenticateToken,
  requirePermission("devices.update"),
  async (req, res) => {
    try {
      const deviceId = req.params.devId;
      const { name } = req.body ?? {};
      if (!validId(deviceId)) {
        return res.status(400).json({ message: "Invalid device ID." });
      }
      if (!validName(name)) {
        return res
          .status(400)
          .json({
            message:
              "Device name is required and must not exceed 150 characters.",
          });
      }

      const [result] = await pool.execute(
        "UPDATE device SET name = ? WHERE dev_id = ?",
        [name.trim(), deviceId.trim()],
      );
      if (result.affectedRows === 0) {
        const [existing] = await pool.execute(
          "SELECT dev_id FROM device WHERE dev_id = ? LIMIT 1",
          [deviceId.trim()],
        );
        if (existing.length === 0)
          return res.status(404).json({ message: "Device not found." });
      }

      const [rows] = await pool.execute(
        "SELECT dev_id, name, created_at FROM device WHERE dev_id = ? LIMIT 1",
        [deviceId.trim()],
      );
      return res.json({
        message: "Device updated successfully.",
        device: rows[0],
      });
    } catch (error) {
      console.error("Update device error:", error.message);
      return res.status(500).json({ message: "Unable to update device." });
    }
  },
);

// A device with assigned equipment cannot be deleted; keep history/references intact.
router.delete(
  "/:devId",
  authenticateToken,
  requirePermission("devices.delete"),
  async (req, res) => {
    try {
      const deviceId = req.params.devId;
      if (!validId(deviceId))
        return res.status(400).json({ message: "Invalid device ID." });

      const [result] = await pool.execute(
        "DELETE FROM device WHERE dev_id = ?",
        [deviceId.trim()],
      );
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "Device not found." });
      return res.json({ message: "Device deleted successfully." });
    } catch (error) {
      console.error("Delete device error:", error.message);
      if (
        ["ER_ROW_IS_REFERENCED_2", "ER_ROW_IS_REFERENCED"].includes(error.code)
      ) {
        return res.status(409).json({
          message:
            "This device is assigned to equipment. Reassign or remove its equipment first; the device was not deleted.",
        });
      }
      return res.status(500).json({ message: "Unable to delete device." });
    }
  },
);

module.exports = router;
