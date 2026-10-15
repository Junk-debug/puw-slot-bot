import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

// Without STATE_DIR, state.json lives in the project root (next to src/ and dist/).
const STATE_FILE = config.stateDir
  ? join(config.stateDir, "state.json")
  : fileURLToPath(new URL("../state.json", import.meta.url));

if (config.stateDir) {
  mkdirSync(config.stateDir, { recursive: true });
}

export interface State {
  ownerId: number | null; // the only chat that can control the bot and receives notifications
  branchId: string;
  serviceId: string;
  active: boolean; // are notifications enabled?
  initialized: boolean; // has the baseline been seeded for the current branch/service?
  seenDates: string[]; // dates already reported, so a restart doesn't re-notify
}

function load(): State {
  const defaults: State = {
    ownerId: config.ownerId ?? null,
    branchId: config.branchId,
    serviceId: config.serviceId,
    active: true,
    initialized: false,
    seenDates: [],
  };
  try {
    if (!existsSync(STATE_FILE)) return defaults;
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>;
    const merged = { ...defaults, ...raw };
    // An owner pinned via env always wins over whatever is on disk.
    if (config.ownerId !== undefined) merged.ownerId = config.ownerId;
    return merged;
  } catch (err) {
    console.error("Failed to read state.json, starting from defaults:", (err as Error).message);
    return defaults;
  }
}

const state = load();

function persist(): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to persist state.json:", (err as Error).message);
  }
}

export function getState(): Readonly<State> {
  return state;
}

/** The first /start claims ownership. Returns false if an owner is already set. */
export function claimOwner(chatId: number): boolean {
  if (state.ownerId !== null) return false;
  state.ownerId = chatId;
  state.active = true;
  persist();
  return true;
}

export function isOwner(chatId: number): boolean {
  return state.ownerId === chatId;
}

export function setActive(active: boolean): void {
  state.active = active;
  persist();
}

export function setBranch(id: string): void {
  state.branchId = id;
  resetBaseline();
}

export function setService(id: string): void {
  state.serviceId = id;
  resetBaseline();
}

export function getSeen(): Set<string> {
  return new Set(state.seenDates);
}

/** Remember the currently available dates and mark the baseline as seeded. */
export function markSeen(dates: string[]): void {
  state.seenDates = dates;
  state.initialized = true;
  persist();
}

/** Forget seen dates so the next poll re-seeds silently (used after a branch/service change). */
export function resetBaseline(): void {
  state.initialized = false;
  state.seenDates = [];
  persist();
}

/**
 * Forget seen dates so the next poll notifies about everything currently available
 * (handy for testing). Unlike resetBaseline it keeps `initialized`, so the next poll
 * notifies instead of seeding silently. Branch, service and owner are kept.
 */
export function forgetSeen(): void {
  state.seenDates = [];
  state.initialized = true;
  state.active = true;
  persist();
}
