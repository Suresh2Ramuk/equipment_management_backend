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

async function findEquipment(equipmentId) {
  const [rows] = await pool.execute(
    `SELECT e.equ_id, e.name, e.dev_id, d.name AS device_name, e.created_at
     FROM equipment e
     LEFT JOIN device d ON d.dev_id = e.dev_id
     WHERE e.equ_id = ? LIMIT 1`,
    [equipmentId],
  );
  return rows[0] ?? null;
}

router.get(
  "/",
  authenticateToken,
  requirePermission("equipment.view"),
  async (req, res) => {
    try {
      const [rows] = await pool.execute(`
      SELECT e.equ_id, e.name, e.dev_id, d.name AS device_name, e.created_at
      FROM equipment e
      LEFT JOIN device d ON e.dev_id = d.dev_id
      ORDER BY e.created_at DESC, e.equ_id ASC
    `);
      return res.json(rows);
    } catch (error) {
      console.error("Get equipment error:", error.message);
      return res.status(500).json({ message: "Unable to fetch equipment." });
    }
  },
);

router.post(
  "/",
  authenticateToken,
  requirePermission("equipment.create"),
  async (req, res) => {
    try {
      const { equ_id, name, dev_id } = req.body ?? {};
      if (!validId(equ_id)) {
        return res.status(400).json({
          message:
            "Equipment ID is required, may contain letters, numbers, dot, underscore or hyphen, and must be at most 30 characters.",
        });
      }
      if (!validName(name)) {
        return res
          .status(400)
          .json({
            message:
              "Equipment name is required and must not exceed 150 characters.",
          });
      }
      if (!validId(dev_id))
        return res
          .status(400)
          .json({ message: "A valid device ID is required." });

      const equipmentId = equ_id.trim();
      const deviceId = dev_id.trim();
      const [devices] = await pool.execute(
        "SELECT dev_id FROM device WHERE dev_id = ? LIMIT 1",
        [deviceId],
      );
      if (devices.length === 0)
        return res
          .status(400)
          .json({ message: "The selected device does not exist." });

      await pool.execute(
        "INSERT INTO equipment (equ_id, name, dev_id) VALUES (?, ?, ?)",
        [equipmentId, name.trim(), deviceId],
      );
      return res.status(201).json({
        message: "Equipment created successfully.",
        equipment: await findEquipment(equipmentId),
      });
    } catch (error) {
      console.error("Create equipment error:", error.message);
      if (error.code === "ER_DUP_ENTRY")
        return res
          .status(409)
          .json({ message: "This equipment ID already exists." });
      if (
        ["ER_NO_REFERENCED_ROW_2", "ER_NO_REFERENCED_ROW"].includes(error.code)
      ) {
        return res
          .status(400)
          .json({ message: "The selected device does not exist." });
      }
      return res.status(500).json({ message: "Unable to create equipment." });
    }
  },
);

// Equipment ID is immutable after creation, preserving historical log relationships.
router.put(
  "/:equId",
  authenticateToken,
  requirePermission("equipment.update"),
  async (req, res) => {
    try {
      const equipmentId = req.params.equId;
      const { name, dev_id } = req.body ?? {};
      if (!validId(equipmentId))
        return res.status(400).json({ message: "Invalid equipment ID." });
      if (!validName(name))
        return res
          .status(400)
          .json({
            message:
              "Equipment name is required and must not exceed 150 characters.",
          });
      if (!validId(dev_id))
        return res
          .status(400)
          .json({ message: "A valid device ID is required." });

      const existing = await findEquipment(equipmentId.trim());
      if (!existing)
        return res.status(404).json({ message: "Equipment not found." });

      const [devices] = await pool.execute(
        "SELECT dev_id FROM device WHERE dev_id = ? LIMIT 1",
        [dev_id.trim()],
      );
      if (devices.length === 0)
        return res
          .status(400)
          .json({ message: "The selected device does not exist." });

      try {
        await pool.execute(
          "UPDATE equipment SET name = ?, dev_id = ? WHERE equ_id = ?",
          [name.trim(), dev_id.trim(), equipmentId.trim()],
        );
      } catch (error) {
        if (
          ["ER_ROW_IS_REFERENCED_2", "ER_ROW_IS_REFERENCED"].includes(
            error.code,
          )
        ) {
          return res.status(409).json({
            message:
              "This equipment already has sensor history. Its linked device cannot be changed without migrating the historical records; you can still update its name.",
          });
        }
        throw error;
      }

      return res.json({
        message: "Equipment updated successfully.",
        equipment: await findEquipment(equipmentId.trim()),
      });
    } catch (error) {
      console.error("Update equipment error:", error.message);
      return res.status(500).json({ message: "Unable to update equipment." });
    }
  },
);

router.delete(
  "/:equId",
  authenticateToken,
  requirePermission("equipment.delete"),
  async (req, res) => {
    try {
      const equipmentId = req.params.equId;
      if (!validId(equipmentId))
        return res.status(400).json({ message: "Invalid equipment ID." });

      const [result] = await pool.execute(
        "DELETE FROM equipment WHERE equ_id = ?",
        [equipmentId.trim()],
      );
      if (result.affectedRows === 0)
        return res.status(404).json({ message: "Equipment not found." });
      return res.json({ message: "Equipment deleted successfully." });
    } catch (error) {
      console.error("Delete equipment error:", error.message);
      if (
        ["ER_ROW_IS_REFERENCED_2", "ER_ROW_IS_REFERENCED"].includes(error.code)
      ) {
        return res.status(409).json({
          message:
            "This equipment has sensor log records. It was not deleted so the historical data remains intact.",
        });
      }
      return res.status(500).json({ message: "Unable to delete equipment." });
    }
  },
);

module.exports = router;
