/**
 * One-time (or re-run-when-URL-changes) setup script: registers this app's
 * webhook URL with Telegram so the bot receives updates.
 *
 * Usage:
 *   npm run telegram:webhook -- https://yourdomain.com
 *
 * Requires TELEGRAM_BOT_TOKEN (and optionally TELEGRAM_WEBHOOK_SECRET) to be
 * set in .env.local / .env.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const baseUrl = process.argv[2];

async function main() {
  if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN is not set. Add it to .env.local first.");
    process.exit(1);
  }

  if (!baseUrl) {
    console.error("❌ Usage: npm run telegram:webhook -- https://yourdomain.com");
    process.exit(1);
  }

  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });

  const data = await res.json();

  if (!data.ok) {
    console.error("❌ Failed to set webhook:", data.description);
    process.exit(1);
  }

  console.log(`✅ Webhook registered: ${webhookUrl}`);
  if (!secret) {
    console.warn(
      "⚠️  TELEGRAM_WEBHOOK_SECRET is not set — anyone who discovers your webhook URL could POST fake " +
        "updates to it. Set TELEGRAM_WEBHOOK_SECRET and re-run this script before going to production."
    );
  }

  const infoRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = await infoRes.json();
  console.log("Webhook info:", JSON.stringify(info.result, null, 2));
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
