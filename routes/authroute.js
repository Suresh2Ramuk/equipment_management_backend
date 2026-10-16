const express = require("express");
const pool = require("../db");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const authenticateToken = require("../middleware/authmiddleware");
const router = express.Router();

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const [permissionRows] = await pool.execute(
      `SELECT p.permission_key
       FROM role_permissions rp
       INNER JOIN permissions p
         ON p.id = rp.permission_id
       WHERE rp.role_id = ?
       ORDER BY p.permission_key`,
      [req.user.role_id],
    );

    const permissions = permissionRows.map((row) => row.permission_key);

    return res.status(200).json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role_id: req.user.role_id,
        role: req.user.role,
        permissions,
      },
      permissions,
    });
  } catch (error) {
    console.error("Get current user error:", error.message);

    return res.status(500).json({
      message: "Unable to fetch current user.",
    });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};

    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Name, email and password are required.",
      });
    }

    if (name.trim().length < 3) {
      return res.status(400).json({
        message: "Name must be at least 3 characters long.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [existingUsers] = await pool.execute(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail],
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ message: "Email already exists." });
    }

    // Never accept role_id from public registration input. All new accounts
    // receive the viewer role selected by role name, not a hard-coded ID.
    const [viewerRoles] = await pool.execute(
      "SELECT id FROM roles WHERE name = 'viewer' LIMIT 1",
    );

    if (viewerRoles.length === 0) {
      console.error("Registration failed: the viewer role is missing.");
      return res.status(500).json({
        message:
          "Registration is not configured. Please contact an administrator.",
      });
    }

    const viewerRoleId = Number(viewerRoles[0].id);
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const [result] = await pool.execute(
        `INSERT INTO users (name, email, password_hash, role_id, is_active)
         VALUES (?, ?, ?, ?, 1)`,
        [name.trim(), normalizedEmail, passwordHash, viewerRoleId],
      );

      return res.status(201).json({
        message: "User registered successfully.",
        user: {
          id: Number(result.insertId),
          name: name.trim(),
          email: normalizedEmail,
          role_id: viewerRoleId,
          role: "viewer",
          is_active: true,
        },
      });
    } catch (insertError) {
      // Handles two registration requests arriving for the same email.
      if (insertError.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ message: "Email already exists." });
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Registration error:", error.message);
    return res
      .status(500)
      .json({ message: "Unable to register this account." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.execute(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role_id,
              u.is_active, u.last_login_at, r.name AS role
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE u.email = ?
       LIMIT 1`,
      [normalizedEmail],
    );

    if (users.length === 0) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // Check status at login as well as in authenticateToken middleware.
    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        message: "This account is disabled. Please contact an administrator.",
      });
    }

    // This was missing from the previous login route. Record successful login
    // in the database; never update the timestamp for a failed login attempt.
    const [loginUpdate] = await pool.execute(
      `UPDATE users
       SET last_login_at = CURRENT_TIMESTAMP
       WHERE id = ? AND is_active = 1`,
      [user.id],
    );

    if (loginUpdate.affectedRows !== 1) {
      return res.status(403).json({
        message:
          "This account is unavailable. Please contact an administrator.",
      });
    }

    const [timestampRows] = await pool.execute(
      "SELECT last_login_at FROM users WHERE id = ? LIMIT 1",
      [user.id],
    );

    const token = jwt.sign(
      {
        userId: Number(user.id),
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1h",
      },
    );

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: Number(user.id),
        name: user.name,
        email: user.email,
        role_id: Number(user.role_id),
        role: user.role,
        is_active: true,
        last_login_at: timestampRows[0]?.last_login_at ?? null,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ message: "Unable to login." });
  }
});

function hashResetOtp(userId, otp) {
  const secret = process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("OTP_HASH_SECRET is not configured.");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${otp}`)
    .digest("hex");
}

async function sendResetOtp(email, name, otp) {
  const {
    MAIL_HOST,
    MAIL_USER,
    MAIL_PASS,
    MAIL_PORT,
    MAIL_SECURE,
    MAIL_FROM,
    NODE_ENV,
  } = process.env;

  if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS) {
    if (NODE_ENV === "production") {
      throw new Error("SMTP email configuration is missing.");
    }
    console.warn(`[DEV ONLY] Password reset OTP generated for ${email}.`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: Number(MAIL_PORT || 587),
    secure: MAIL_SECURE === "true",
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASS,
    },
    family: 4,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  try {
    await transporter.sendMail({
      from: MAIL_FROM || MAIL_USER,
      to: email,
      subject: "Employee Portal - Password Reset Code",

      text: [
        `Hello ${name || "there"},`,
        "",
        `Your password reset code is: ${otp}`,
        "",
        "This code expires in 10 minutes.",
        "If you did not request this, you can ignore this email.",
      ].join("\n"),
    });
  } finally {
    transporter.close();
  }
}

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.execute(
      `SELECT id, name, email
       FROM users
       WHERE email = ?`,
      [normalizedEmail],
    );

    const genericMessage =
      "If an account exists for that email, a reset code has been sent.";
    if (users.length === 0) {
      return res.json({
        message: genericMessage,
      });
    }

    const user = users[0];
    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const otpHash = hashResetOtp(user.id, otp);

    await pool.execute(
      `UPDATE password_reset_codes
       SET used_at = NOW()
       WHERE user_id = ?
         AND used_at IS NULL`,
      [user.id],
    );
    await pool.execute(
      `INSERT INTO password_reset_codes
         (user_id, otp_hash, expires_at)
       VALUES (
         ?,
         ?,
         DATE_ADD(NOW(), INTERVAL 10 MINUTE)
       )`,
      [user.id, otpHash],
    );
    try {
      await sendResetOtp(user.email, user.name, otp);
    } catch (mailError) {
      await pool.execute(
        `UPDATE password_reset_codes
         SET used_at = NOW()
         WHERE user_id = ?
           AND used_at IS NULL`,
        [user.id],
      );
      throw mailError;
    }
    return res.json({
      message: genericMessage,
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      message: "Unable to send reset code right now. Please try again.",
    });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (
      typeof email !== "string" ||
      typeof otp !== "string" ||
      typeof newPassword !== "string" ||
      !email.trim() ||
      !otp.trim() ||
      !newPassword
    ) {
      return res.status(400).json({
        message: "Email, verification code and new password are required.",
      });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        message: "Enter the six-digit verification code.",
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [users] = await pool.execute(
      `SELECT id
       FROM users
       WHERE email = ?`,
      [normalizedEmail],
    );
    if (users.length === 0) {
      return res.status(400).json({
        message: "Invalid or expired reset code.",
      });
    }

    const userId = users[0].id;
    const [codes] = await pool.execute(
      `SELECT id, otp_hash, attempts
       FROM password_reset_codes
       WHERE user_id = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [userId],
    );
    if (codes.length === 0 || codes[0].attempts >= 5) {
      return res.status(400).json({
        message: "Invalid or expired reset code.",
      });
    }

    const resetCode = codes[0];
    const submittedHash = hashResetOtp(userId, otp);
    const storedBuffer = Buffer.from(resetCode.otp_hash, "hex");
    const submittedBuffer = Buffer.from(submittedHash, "hex");
    const matches =
      storedBuffer.length === submittedBuffer.length &&
      crypto.timingSafeEqual(storedBuffer, submittedBuffer);

    if (!matches) {
      await pool.execute(
        `UPDATE password_reset_codes
         SET attempts = attempts + 1
         WHERE id = ?
           AND used_at IS NULL`,
        [resetCode.id],
      );
      return res.status(400).json({
        message: "Invalid or expired reset code.",
      });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();
      const [consumeResult] = await connection.execute(
        `UPDATE password_reset_codes
           SET used_at = NOW()
           WHERE id = ?
             AND user_id = ?
             AND used_at IS NULL
             AND expires_at > NOW()
             AND attempts < 5`,
        [resetCode.id, userId],
      );
      if (consumeResult.affectedRows !== 1) {
        await connection.rollback();
        return res.status(400).json({
          message: "Invalid or expired reset code.",
        });
      }
      await connection.execute(
        `UPDATE users
         SET password_hash = ?
         WHERE id = ?`,
        [passwordHash, userId],
      );
      await connection.execute(
        `UPDATE password_reset_codes
         SET used_at = NOW()
         WHERE user_id = ?
           AND used_at IS NULL`,
        [userId],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return res.json({
      message:
        "Password reset successfully. Please sign in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      message: "Unable to reset password right now.",
    });
  }
});

module.exports = router;
