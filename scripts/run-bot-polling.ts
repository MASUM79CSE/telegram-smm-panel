/**
 * Local/sandbox development runner: starts the bot in long-polling mode
 * instead of webhooks. Useful when the app isn't reachable from the public
 * internet (e.g. sandboxed preview environments) or for quick local testing.
 *
 * In production, prefer webhooks (see scripts/setup-telegram-webhook.ts and
 * app/api/telegram/webhook/route.ts) — polling keeps an open connection and
 * doesn't scale across multiple server instances.
 *
 * Usage: npm run telegram:poll
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { getBot } = await import("../lib/telegram/client");
  const { registerHandlers } = await import("../lib/telegram/bot");

  const bot = await getBot();
  if (!bot) {
    console.error("❌ TELEGRAM_BOT_TOKEN is not set. Add it to .env.local first.");
    process.exit(1);
  }

  await registerHandlers();

  console.log("🤖 Bot starting in long-polling mode... (Ctrl+C to stop)");

  bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is now polling for updates.`);
    },
  });
}

main().catch((err) => {
  console.error("Unexpected error starting bot:", err);
  process.exit(1);
});
