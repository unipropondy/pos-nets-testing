const nodemailer = require("nodemailer");

/** @param {string} [u] */
function maskUser(u) {
  if (!u || u.length < 4) return "(hidden)";
  return `${u.slice(0, 2)}***${u.slice(-2)}`;
}

/**
 * Builds a nodemailer transport from environment variables.
 *
 * Option A — Gmail (app password): set `EMAIL_USER` and `EMAIL_PASS`.
 * Optional: `EMAIL_SERVICE` (default `gmail`), `EMAIL_FROM`.
 *
 * Option B — Custom SMTP: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
 * Optional: `SMTP_SECURE` (`true` / `1` for TLS on connect, e.g. port 465), `EMAIL_FROM`.
 *
 * @returns {{ transporter: import('nodemailer').Transporter, from: string }}
 */
function createMailTransporter() {
  const smtpHost = (process.env.SMTP_HOST || "").trim();
  const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || "").trim();

  if (!smtpUser || !smtpPass) {
    const err = new Error("Email is not enabled on this server.");
    err.code = "MAIL_NOT_CONFIGURED";
    err.hint =
      "Set EMAIL_USER and EMAIL_PASS (Gmail: use an App Password, not your normal password), or set SMTP_HOST, SMTP_USER, and SMTP_PASS for custom SMTP. On Railway: Project → your service → Variables → add the keys → redeploy.";
    throw err;
  }

  const from =
    (process.env.EMAIL_FROM || "").trim() ||
    smtpUser;

  let transporter;
  if (smtpHost) {
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const secureEnv = process.env.SMTP_SECURE;
    const secure =
      secureEnv === "true" ||
      secureEnv === "1" ||
      port === 465;
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port,
      secure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    console.log(
      `[mail] SMTP transport: host=${smtpHost} port=${port} secure=${secure} user=${maskUser(smtpUser)}`
    );
  } else {
    const service = (process.env.EMAIL_SERVICE || "gmail").trim();
    transporter = nodemailer.createTransport({
      service,
      auth: { user: smtpUser, pass: smtpPass },
    });
    console.log(
      `[mail] Well-known service transport: service=${service} user=${maskUser(smtpUser)}`
    );
  }

  return { transporter, from };
}

module.exports = { createMailTransporter };
