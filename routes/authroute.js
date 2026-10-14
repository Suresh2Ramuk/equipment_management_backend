const express = require("express");
const pool = require("../db");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "All fields are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existingUser] = await pool.query(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail],
    );

    if (existingUser.length > 0) {
      return res.status(400).json({
        message: "Email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name.trim(), normalizedEmail, passwordHash],
    );

    res.status(201).json({
      message: "User registered successfully.",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      message: "Internal server error.",
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [users] = await pool.query(
      "SELECT id, name, email, password_hash FROM users WHERE email = ?",
      [normalizedEmail],
    );

    if (users.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "1h",
      },
    );

    res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      message: "Unable to login.",
    });
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
  const { MAIL_HOST, MAIL_USER, MAIL_PASS, MAIL_PORT, MAIL_SECURE, MAIL_FROM, NODE_ENV,} = process.env;

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
