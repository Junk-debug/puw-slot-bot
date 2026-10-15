import { config } from "./config.js";
import { getState } from "./state.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface AvailableDay {
  date: string; // YYYY-MM-DD
  times: string[]; // ["08:00", "08:40", ...]
}

export const BOOKING_URL = `${config.base}/#/`;

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  referer: `${config.base}/`,
};

// Qmatic passes options as matrix params (;key=value) on the last path segment.
// Branch/service come from runtime state so /setbranch and /setservice apply without a restart.
function scheduleUrl(path: string): string {
  const { branchId, serviceId } = getState();
  return (
    `${config.base}/rest/schedule/branches/${branchId}/${path}` +
    `;servicePublicId=${serviceId};customSlotLength=${config.customSlotLength}`
  );
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (path or session may have changed): ${text.slice(0, 120)}`);
  }
}

/**
 * Qmatic versions disagree on the response shape: `{ [listKey]: [...] }` or a bare array,
 * whose items are either strings or objects carrying the value under one of `fields`.
 */
function extractStrings(payload: unknown, listKey: string, fields: string[]): string[] {
  const list = Array.isArray(payload) ? payload : (payload as Record<string, unknown> | null)?.[listKey];
  if (!Array.isArray(list)) return [];

  return list.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const value = fields.map((f) => record[f]).find((v) => typeof v === "string");
      return typeof value === "string" ? [value] : [];
    }
    return [];
  });
}

export async function fetchAvailableDates(): Promise<string[]> {
  const payload = await getJson(scheduleUrl("dates"));
  return extractStrings(payload, "dates", ["date", "publicId", "value"]);
}

export async function fetchTimes(date: string): Promise<string[]> {
  const payload = await getJson(scheduleUrl(`dates/${date}/times`));
  return extractStrings(payload, "times", ["time", "date", "value"]);
}

/** Fetch every available date together with its concrete time slots. */
export async function fetchAvailability(): Promise<AvailableDay[]> {
  const dates = await fetchAvailableDates();
  const days: AvailableDay[] = [];
  for (const date of dates) {
    try {
      days.push({ date, times: await fetchTimes(date) });
    } catch {
      days.push({ date, times: [] }); // the date is free even if the times request fails
    }
  }
  return days;
}
