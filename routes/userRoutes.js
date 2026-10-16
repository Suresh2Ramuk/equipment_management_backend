const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authmiddleware");
const requirePermission = authenticateToken.requirePermission;

const router = express.Router();

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function writeAudit({ actorId, targetId = null, action, oldValue = null, newValue = null }) {
  await pool.execute(
    `INSERT INTO user_admin_audit
       (actor_user_id, target_user_id, action, old_value, new_value)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId, targetId, action, oldValue, newValue]
  );
}

router.get("/", authenticateToken, requirePermission("users.view"), async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role_id, r.name AS role,
              u.is_active, u.created_at, u.last_login_at
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at DESC, u.id DESC`
    );
    return res.json({ users });
  } catch (error) {
    console.error("List users error:", error.message);
    return res.status(500).json({ message: "Unable to load users." });
  }
});

// GET /api/users/roles — roles and the full permission catalogue.
router.get("/roles", authenticateToken, requirePermission("users.manage_roles"), async (req, res) => {
  try {
    const [[roles], [permissions], [assignments]] = await Promise.all([
      pool.execute("SELECT id, name, description FROM roles ORDER BY id"),
      pool.execute("SELECT permission_key, description FROM permissions ORDER BY permission_key"),
      pool.execute(
        `SELECT rp.role_id, p.permission_key
         FROM role_permissions rp
         INNER JOIN permissions p ON p.id = rp.permission_id`
      ),
    ]);

    const roleList = roles.map((role) => ({
      ...role,
      id: Number(role.id),
      permissions: assignments
        .filter((entry) => Number(entry.role_id) === Number(role.id))
        .map((entry) => entry.permission_key),
    }));

    return res.json({ roles: roleList, permissions });
  } catch (error) {
    console.error("List roles error:", error.message);
    return res.status(500).json({ message: "Unable to load roles." });
  }
});

// PATCH /api/users/:userId/role — assign a role to a user.
router.patch("/:userId/role", authenticateToken, requirePermission("users.manage_roles"), async (req, res) => {
  const userId = positiveInt(req.params.userId);
  const roleId = positiveInt(req.body?.role_id);

  if (!userId || !roleId) {
    return res.status(400).json({ message: "Valid user ID and role_id are required." });
  }

  try {
    const [[targets], [roles]] = await Promise.all([
      pool.execute(
        `SELECT u.id, u.role_id, u.is_active, r.name AS role
         FROM users u INNER JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? LIMIT 1`, [userId]
      ),
      pool.execute("SELECT id, name FROM roles WHERE id = ? LIMIT 1", [roleId]),
    ]);

    if (!targets.length) return res.status(404).json({ message: "User not found." });
    if (!roles.length) return res.status(400).json({ message: "Selected role does not exist." });

    const target = targets[0];
    const newRole = roles[0];
    if (Number(target.role_id) === roleId) {
      return res.json({ message: "User already has this role." });
    }

    if (userId === req.user.id && newRole.name !== "admin") {
      return res.status(400).json({ message: "You cannot remove your own administrator role." });
    }

    if (target.role === "admin" && Number(target.is_active) === 1 && newRole.name !== "admin") {
      const [[countRow]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'admin' AND u.is_active = 1`
      );
      if (Number(countRow.total) <= 1) {
        return res.status(409).json({ message: "You cannot demote the last active administrator." });
      }
    }

    await pool.execute("UPDATE users SET role_id = ? WHERE id = ?", [roleId, userId]);
    await writeAudit({
      actorId: req.user.id,
      targetId: userId,
      action: "ROLE_CHANGED",
      oldValue: target.role,
      newValue: newRole.name,
    });

    return res.json({ message: "User role updated successfully.", user_id: userId, role_id: roleId, role: newRole.name });
  } catch (error) {
    console.error("Assign user role error:", error.message);
    return res.status(500).json({ message: "Unable to update user role." });
  }
});

// PATCH /api/users/:userId/status — activate/deactivate an account.
router.patch("/:userId/status", authenticateToken, requirePermission("users.manage_status"), async (req, res) => {
  const userId = positiveInt(req.params.userId);
  const isActive = req.body?.is_active;

  if (!userId || typeof isActive !== "boolean") {
    return res.status(400).json({ message: "A valid user ID and boolean is_active are required." });
  }
  if (userId === req.user.id && !isActive) {
    return res.status(400).json({ message: "You cannot disable your own account." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.is_active, r.name AS role FROM users u
       INNER JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1`, [userId]
    );
    if (!rows.length) return res.status(404).json({ message: "User not found." });

    const target = rows[0];
    if (Number(target.is_active) === Number(isActive)) {
      return res.json({ message: "User status is unchanged.", is_active: isActive });
    }

    if (!isActive && target.role === "admin" && Number(target.is_active) === 1) {
      const [[countRow]] = await pool.execute(
        `SELECT COUNT(*) AS total FROM users u
         INNER JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'admin' AND u.is_active = 1`
      );
      if (Number(countRow.total) <= 1) {
        return res.status(409).json({ message: "You cannot disable the last active administrator." });
      }
    }

    await pool.execute("UPDATE users SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, userId]);
    await writeAudit({
      actorId: req.user.id,
      targetId: userId,
      action: isActive ? "USER_ENABLED" : "USER_DISABLED",
      oldValue: String(Boolean(Number(target.is_active))),
      newValue: String(isActive),
    });
    return res.json({ message: `User ${isActive ? "enabled" : "disabled"} successfully.`, is_active: isActive });
  } catch (error) {
    console.error("Update user status error:", error.message);
    return res.status(500).json({ message: "Unable to update user status." });
  }
});

// PUT /api/users/roles/:roleId/permissions — edit permissions for a role.
router.put("/roles/:roleId/permissions", authenticateToken, requirePermission("users.manage_roles"), async (req, res) => {
  const roleId = positiveInt(req.params.roleId);
  const permissionKeys = req.body?.permissions;
  if (!roleId || !Array.isArray(permissionKeys) || permissionKeys.some((key) => typeof key !== "string")) {
    return res.status(400).json({ message: "A valid role ID and permissions array are required." });
  }

  const keys = [...new Set(permissionKeys)];
  try {
    const [roleRows] = await pool.execute("SELECT id, name FROM roles WHERE id = ? LIMIT 1", [roleId]);
    if (!roleRows.length) return res.status(404).json({ message: "Role not found." });

    // Ensure an edit cannot accidentally lock all admins out of user administration.
    if (roleRows[0].name === "admin") {
      const required = ["users.view", "users.manage_roles", "users.manage_status"];
      if (!required.every((key) => keys.includes(key))) {
        return res.status(400).json({
          message: "The admin role must retain users.view, users.manage_roles and users.manage_status.",
        });
      }
    }

    const [permissionRows] = keys.length
      ? await pool.execute(
          `SELECT id, permission_key FROM permissions WHERE permission_key IN (${keys.map(() => "?").join(",")})`, keys
        )
      : [[]];

    if (permissionRows.length !== keys.length) {
      return res.status(400).json({ message: "One or more permission keys are unknown." });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
      for (const permission of permissionRows) {
        await connection.execute(
          "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
          [roleId, permission.id]
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    await writeAudit({
      actorId: req.user.id,
      action: "ROLE_PERMISSIONS_CHANGED",
      oldValue: roleRows[0].name,
      newValue: JSON.stringify(keys),
    });

    return res.json({ message: "Role permissions updated successfully.", role: roleRows[0].name, permissions: keys });
  } catch (error) {
    console.error("Update role permissions error:", error.message);
    return res.status(500).json({ message: "Unable to update role permissions." });
  }
});

// GET /api/users/audit — recent administrative changes.
router.get("/audit", authenticateToken, requirePermission("users.manage_roles"), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.audit_id, a.action, a.old_value, a.new_value, a.created_at,
              actor.name AS actor_name, target.name AS target_name
       FROM user_admin_audit a
       LEFT JOIN users actor ON actor.id = a.actor_user_id
       LEFT JOIN users target ON target.id = a.target_user_id
       ORDER BY a.audit_id DESC LIMIT 100`
    );
    return res.json({ audit: rows });
  } catch (error) {
    console.error("Get user administration audit error:", error.message);
    return res.status(500).json({ message: "Unable to load audit history." });
  }
});

module.exports = router;
