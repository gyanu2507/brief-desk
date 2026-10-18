import type { BriefMode, PackageRegistry, SourceKind } from "./types";

export const HISTORY_STORE_KEY = "brief-desk-history-v1";
export const HISTORY_MAX = 20;

export type BriefHistoryEntry = {
  id: string;
  at: number;
  source: SourceKind;
  mode: BriefMode;
  label: string;
  question: string;
  answer: string;
  markdown: string;
  meta?: string;
  repo?: string;
  repoB?: string;
  url?: string;
  goal?: string;
  packageName?: string;
  packageRegistry?: PackageRegistry;
  tagA?: string;
  tagB?: string;
  steps?: string[];
  evalScore?: number | null;
  ms?: number;
};

export function loadBriefHistory(): BriefHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BriefHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.id === "string" && typeof e.markdown === "string");
  } catch {
    return [];
  }
}

export function saveBriefHistory(entries: BriefHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_STORE_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    // ignore quota
  }
}

export function pushBriefHistory(
  prev: BriefHistoryEntry[],
  entry: Omit<BriefHistoryEntry, "id" | "at"> & { id?: string; at?: number },
): BriefHistoryEntry[] {
  const next: BriefHistoryEntry = {
    ...entry,
    id: entry.id || `h-${Date.now()}`,
    at: entry.at || Date.now(),
  };
  return [next, ...prev.filter((e) => e.markdown !== next.markdown)].slice(0, HISTORY_MAX);
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".md") ? filename : `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function historyLabel(args: {
  source: SourceKind;
  repo?: string | null;
  goal?: string | null;
  question: string;
  packageName?: string | null;
  packageRegistry?: PackageRegistry | null;
  tagA?: string | null;
  tagB?: string | null;
}): string {
  if (args.source === "auto" || args.source === "trending") {
    return (args.goal || args.question).slice(0, 56);
  }
  if (args.source === "package" && args.packageName) {
    return `${args.packageRegistry || "npm"} · ${args.packageName}`.slice(0, 56);
  }
  if (args.source === "releases" && args.repo) {
    const tags =
      args.tagA && args.tagB ? `${args.tagA}→${args.tagB}` : "releases";
    return `${args.repo} · ${tags}`.slice(0, 56);
  }
  if (args.repo) return `${args.source} · ${args.repo}`;
  return (args.question || args.source).slice(0, 56);
}
