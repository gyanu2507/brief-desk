import type { BriefHistoryEntry } from "./brief-history";
import type { SavedBrief } from "./saved-shortcuts";

export type SyncFetchResult<T> =
  | { ok: true; entries: T[] }
  | { ok: false; status: number; error?: string };

async function fetchEntries<T>(
  path: string,
): Promise<SyncFetchResult<T>> {
  const res = await fetch(path, { cache: "no-store" });
  let body: { entries?: T[]; error?: string } = {};
  try {
    body = (await res.json()) as { entries?: T[]; error?: string };
  } catch {
    // ignore
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: body.error || res.statusText };
  }
  return { ok: true, entries: Array.isArray(body.entries) ? body.entries : [] };
}

export async function fetchRemoteHistory(): Promise<SyncFetchResult<BriefHistoryEntry>> {
  return fetchEntries<BriefHistoryEntry>("/api/me/history");
}

export async function pushRemoteHistory(entries: BriefHistoryEntry[]): Promise<boolean> {
  const res = await fetch("/api/me/history", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return res.ok;
}

export async function clearRemoteHistory(): Promise<boolean> {
  const res = await fetch("/api/me/history", { method: "DELETE" });
  return res.ok;
}

export async function fetchRemoteSaved(): Promise<SyncFetchResult<SavedBrief>> {
  return fetchEntries<SavedBrief>("/api/me/saved");
}

export async function pushRemoteSaved(entries: SavedBrief[]): Promise<boolean> {
  const res = await fetch("/api/me/saved", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return res.ok;
}
