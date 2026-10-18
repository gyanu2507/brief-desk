import type { BriefHistoryEntry } from "./brief-history";
import type { SavedBrief } from "./saved-shortcuts";

async function readJson<T>(res: Response): Promise<T | null> {
  if (res.status === 401 || res.status === 503) return null;
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function fetchRemoteHistory(): Promise<BriefHistoryEntry[] | null> {
  const res = await fetch("/api/me/history", { cache: "no-store" });
  const body = await readJson<{ entries?: BriefHistoryEntry[] }>(res);
  return body?.entries ?? null;
}

export async function pushRemoteHistory(entries: BriefHistoryEntry[]): Promise<boolean> {
  const res = await fetch("/api/me/history", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return res.ok;
}

export async function fetchRemoteSaved(): Promise<SavedBrief[] | null> {
  const res = await fetch("/api/me/saved", { cache: "no-store" });
  const body = await readJson<{ entries?: SavedBrief[] }>(res);
  return body?.entries ?? null;
}

export async function pushRemoteSaved(entries: SavedBrief[]): Promise<boolean> {
  const res = await fetch("/api/me/saved", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return res.ok;
}
