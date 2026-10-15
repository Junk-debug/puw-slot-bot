import "dotenv/config";

const MIN_POLL_INTERVAL_SEC = 30;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`Env var ${name} must be a number, got "${raw}".`);
    process.exit(1);
  }
  return value;
}

export const config = {
  botToken: required("BOT_TOKEN"),
  /** Pins the owner so it survives redeploys. If unset, the first /start claims ownership. */
  ownerId: process.env.OWNER_CHAT_ID ? optionalNumber("OWNER_CHAT_ID", 0) : undefined,
  /** Clamped to a polite minimum so we don't hammer the booking server. */
  pollIntervalSec: Math.max(MIN_POLL_INTERVAL_SEC, optionalNumber("POLL_INTERVAL_SEC", 60)),
  /** Directory for state.json. Point it at a mounted volume on ephemeral hosts (e.g. Railway). */
  stateDir: process.env.STATE_DIR || undefined,
  base: process.env.PUW_BASE || "https://rezerwacja.gdansk.uw.gov.pl:8445/qmaticwebbooking",
  branchId: process.env.BRANCH_ID || "1cf1e3e60eeb96dae2bb572487249bd48cc5bed0024960eaee0c893ce4918569",
  serviceId: process.env.SERVICE_ID || "2c5251d564aaf0b09c2a39d69cf7ed4cb1e142ab3a501b4b688e1e7c2d80b8e0",
  customSlotLength: optionalNumber("CUSTOM_SLOT_LENGTH", 40),
};
