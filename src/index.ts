import { Bot } from "grammy";
import { config } from "./config.js";
import { BOOKING_URL, fetchAvailability, type AvailableDay } from "./qmatic.js";
import {
  claimOwner,
  forgetSeen,
  getSeen,
  getState,
  isOwner,
  markSeen,
  setActive,
  setBranch,
  setService,
} from "./state.js";

const QMATIC_ID_RE = /^[0-9a-fA-F]{64}$/;
const RESTART_DELAY_MS = 10_000;

const COMMANDS = [
  { command: "start", description: "Enable notifications (first use claims the bot)" },
  { command: "stop", description: "Pause notifications" },
  { command: "status", description: "Show notification status and target" },
  { command: "check", description: "Check free slots right now" },
  { command: "config", description: "Show full branch and service IDs" },
  { command: "setbranch", description: "Change the branch ID: /setbranch <64-hex id>" },
  { command: "setservice", description: "Change the service ID: /setservice <64-hex id>" },
  { command: "reset", description: "Re-notify about all currently free dates (for testing)" },
];

const COMMAND_LIST = COMMANDS.map((c) => `/${c.command}`).join(" ");

const bot = new Bot(config.botToken);

// Never let a single failed handler crash the whole process.
bot.catch((err) => {
  const e = err.error;
  console.error("Bot error:", e instanceof Error ? e.message : e);
});

const shortId = (id: string) => `…${id.slice(-8)}`;

function formatDays(days: AvailableDay[]): string {
  if (days.length === 0) return "No free slots. 😴";
  return days
    .map((day) => {
      const times = day.times.length ? day.times.join(", ") : "(times unavailable — check the website)";
      return `📅 *${day.date}*\n${times}`;
    })
    .join("\n\n");
}

async function notifyOwner(text: string): Promise<void> {
  const { ownerId } = getState();
  if (ownerId === null) return;
  try {
    await bot.api.sendMessage(ownerId, text, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(`Failed to message owner ${ownerId}:`, err);
  }
}

// --- Polling ---

async function poll(): Promise<void> {
  let days: AvailableDay[];
  try {
    days = await fetchAvailability();
  } catch (err) {
    console.error("Poll error:", (err as Error).message);
    return;
  }

  const current = days.map((d) => d.date);
  const state = getState();

  // First poll ever, or right after a branch/service change: record silently, don't notify.
  if (!state.initialized) {
    markSeen(current);
    console.log(`Baseline seeded: ${current.length} date(s).`);
    return;
  }

  const seen = getSeen();
  const fresh = new Set(current.filter((d) => !seen.has(d)));
  markSeen(current);

  if (fresh.size === 0 || !state.active || state.ownerId === null) {
    console.log(`Poll OK: ${current.length} date(s), nothing new.`);
    return;
  }

  console.log(`New dates: ${[...fresh].join(", ")}`);
  const freshDays = days.filter((d) => fresh.has(d.date));
  await notifyOwner(`🟢 *New free slots!*\n\n${formatDays(freshDays)}\n\n👉 [Book now](${BOOKING_URL})`);
}

// Schedule the next poll only after the previous one finishes, so slow responses never overlap.
async function pollLoop(): Promise<void> {
  try {
    await poll();
  } finally {
    setTimeout(pollLoop, config.pollIntervalSec * 1000);
  }
}

// --- Owner gate: only the owner may talk to the bot. Until someone claims it, only /start passes. ---

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const { ownerId } = getState();

  if (ownerId === null) {
    if (ctx.message?.text?.startsWith("/start")) return next();
    return;
  }
  if (chatId !== ownerId) return; // silently ignore strangers
  return next();
});

// --- Commands ---

bot.command("start", async (ctx) => {
  if (claimOwner(ctx.chat.id)) {
    await ctx.reply(`✅ You now own this bot. I'll message you when free slots appear.\n\nCommands: ${COMMAND_LIST}`);
  } else if (isOwner(ctx.chat.id)) {
    setActive(true);
    await ctx.reply(`✅ Notifications enabled.\n\nCommands: ${COMMAND_LIST}`);
  }
});

bot.command("stop", async (ctx) => {
  setActive(false);
  await ctx.reply("🛑 Notifications paused. Send /start to resume.");
});

bot.command("status", async (ctx) => {
  const state = getState();
  await ctx.reply(
    `Notifications: ${state.active ? "enabled ✅" : "paused 🛑"}\n` +
      `Poll interval: ${config.pollIntervalSec}s\n` +
      `Branch: ${shortId(state.branchId)}\n` +
      `Service: ${shortId(state.serviceId)}`,
  );
});

bot.command("config", async (ctx) => {
  const state = getState();
  await ctx.reply(
    `*Current target:*\n\n` +
      `Branch ID:\n\`${state.branchId}\`\n\n` +
      `Service ID:\n\`${state.serviceId}\`\n\n` +
      `Change with /setbranch or /setservice`,
    { parse_mode: "Markdown" },
  );
});

bot.command("setbranch", async (ctx) => {
  const id = ctx.match.trim();
  if (!QMATIC_ID_RE.test(id)) {
    await ctx.reply("❌ Expected a 64-character hex ID.\nExample: /setbranch 1cf1e3e6…");
    return;
  }
  setBranch(id);
  await ctx.reply(`✅ Branch ID set to:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("setservice", async (ctx) => {
  const id = ctx.match.trim();
  if (!QMATIC_ID_RE.test(id)) {
    await ctx.reply("❌ Expected a 64-character hex ID.\nExample: /setservice 2c5251d5…");
    return;
  }
  setService(id);
  await ctx.reply(`✅ Service ID set to:\n\`${id}\``, { parse_mode: "Markdown" });
});

bot.command("reset", async (ctx) => {
  forgetSeen();
  await ctx.reply(
    `♻️ Memory cleared. Within ${config.pollIntervalSec}s you'll get a notification about ` +
      "every date that is currently free. Useful for testing.\n\nBranch and service are unchanged.",
  );
});

bot.command("check", async (ctx) => {
  await ctx.reply("Checking… ⏳");
  try {
    const days = await fetchAvailability();
    await ctx.reply(`${formatDays(days)}\n\n👉 [Book now](${BOOKING_URL})`, { parse_mode: "Markdown" });
  } catch (err) {
    await ctx.reply(`Check failed: ${(err as Error).message}`);
  }
});

// --- Boot ---

// getUpdates fails with 409 while another instance is still polling (e.g. during a redeploy).
// bot.catch doesn't cover the polling loop itself, so restart it instead of crashing.
function startBot(): void {
  bot.start({ onStart: () => console.log("Bot started.") }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Polling stopped (${message}). Retrying in ${RESTART_DELAY_MS / 1000}s…`);
    setTimeout(startBot, RESTART_DELAY_MS);
  });
}

// Stop long polling cleanly so the next instance doesn't hit a 409.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await bot.stop();
    process.exit(0);
  });
}

const state = getState();
console.log(
  `Polling every ${config.pollIntervalSec}s. Owner=${state.ownerId ?? "(unclaimed)"} ` +
    `Branch=${shortId(state.branchId)} Service=${shortId(state.serviceId)}`,
);

bot.api.setMyCommands(COMMANDS).catch((err) => console.error("Failed to register commands:", err.message));
void pollLoop(); // seed the baseline right away instead of waiting one interval
startBot();
