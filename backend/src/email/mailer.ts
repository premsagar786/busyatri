import nodemailer from "nodemailer";

// Driver token mailer. Any SMTP provider works (Gmail app password, Outlook,
// your college mail server, Amazon SES…). If SMTP is unconfigured the bus is
// still created and the token returned in the API response — mailing is
// best-effort and NEVER fails the request.
//
//   SMTP_HOST=smtp.gmail.com SMTP_PORT=587 SMTP_SECURE=false
//   SMTP_USER=you@gmail.com SMTP_PASS=<app-password>
//   SMTP_FROM="BusYatri Admin <you@gmail.com>"
//   APP_URL=https://your-dashboard.pages.dev   (links inside the mail)

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function mailConfig(): MailConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    user: SMTP_USER,
    pass: SMTP_PASS,
    from: process.env.SMTP_FROM || SMTP_USER,
  };
}

export interface TokenMail {
  to: string;
  busNumber: string;
  route: string;
  destination: string;
  token: string;
}

export async function sendDriverToken(mail: TokenMail): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  const cfg = mailConfig();
  if (!cfg) return { sent: false, error: "smtp_not_configured" };
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  const driverUrl = appUrl ? `${appUrl}/driver` : "";
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  const text =
    `BUSYATRI — your driver sign-in\n` +
    `================================\n\n` +
    `Bus: ${mail.busNumber}\n` +
    `Route: ${mail.route || "—"} → ${mail.destination || "—"}\n\n` +
    `Your device token (secret — do not share):\n${mail.token}\n\n` +
    (driverUrl
      ? `1. Open ${driverUrl} on your Android phone\n2. Tap SCAN BUS QR and scan the printout from your admin,\n   or type the bus number + token above.\n3. Allow GPS → START TRIP.\n`
      : `1. Open the driver link from your admin on your Android phone\n2. Tap SCAN BUS QR and scan the printout,\n   or type the bus number + token above.\n3. Allow GPS → START TRIP.\n`);
  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: mail.to,
      subject: `BusYatri driver sign-in — ${mail.busNumber}`,
      text,
    });
    console.log(`[mail] token mailed to ${mail.to} for ${mail.busNumber} (${info.messageId})`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send_failed";
    console.error(`[mail] failed for ${mail.to}:`, msg);
    return { sent: false, error: msg };
  }
}
