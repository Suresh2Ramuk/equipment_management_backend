const jwt = require("jsonwebtoken");
const pool = require("../db");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Authentication token is required." });
  }
  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
  const userId = Number(decoded.userId ?? decoded.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({ message: "Invalid authentication token." });
  }
  try {
    const [rows] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.role_id, u.is_active, r.name AS role
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?
       LIMIT 1`,
      [userId],
    );
    if (rows.length === 0 || Number(rows[0].is_active) !== 1) {
      return res.status(401).json({
        message:
          "This account is unavailable. Please contact an administrator.",
      });
    }
    req.user = {
      id: Number(rows[0].id),
      userId: Number(rows[0].id),
      name: rows[0].name,
      email: rows[0].email,
      role_id: Number(rows[0].role_id),
      role: rows[0].role,
    };
    return next();
  } catch (error) {
    console.error("Authentication database error:", error.message);
    return res
      .status(500)
      .json({ message: "Unable to verify the user session." });
  }
}

function requirePermission(permissionKey) {
  if (typeof permissionKey !== "string" || !permissionKey.trim()) {
    throw new TypeError("requirePermission needs a permission key.");
  }
  return async function permissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication is required." });
    }
    try {
      const [rows] = await pool.execute(
        `SELECT 1
         FROM role_permissions rp
         INNER JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = ? AND p.permission_key = ?
         LIMIT 1`,
        [req.user.role_id, permissionKey],
      );
      if (rows.length === 0) {
        return res.status(403).json({
          message: `You do not have permission to perform this action (${permissionKey}).`,
          requiredPermission: permissionKey,
        });
      }
      return next();
    } catch (error) {
      console.error("Permission check error:", error.message);
      return res.status(500).json({ message: "Unable to verify permissions." });
    }
  };
}

module.exports = authenticateToken;
module.exports.requirePermission = requirePermission;
