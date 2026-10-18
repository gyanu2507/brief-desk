import type { BriefMode, PackageRegistry, SourceKind } from "./types";

const SOURCES: SourceKind[] = [
  "auto",
  "github",
  "url",
  "compare",
  "corpus",
  "trending",
  "package",
  "releases",
];

const MODES: BriefMode[] = [
  "overview",
  "risks",
  "architecture",
  "activity",
  "code",
  "docs",
  "general",
];

export type SessionLinkState = {
  source: SourceKind;
  mode?: BriefMode;
  repo?: string;
  repoB?: string;
  url?: string;
  goal?: string;
  language?: string;
  since?: "daily" | "weekly" | "monthly";
  packageRegistry?: PackageRegistry;
  packageName?: string;
  tagA?: string;
  tagB?: string;
};

function isSource(v: string | null): v is SourceKind {
  return Boolean(v && (SOURCES as string[]).includes(v));
}

function isMode(v: string | null): v is BriefMode {
  return Boolean(v && (MODES as string[]).includes(v));
}

/** Parse shareable query params. Returns null when `source` is missing. */
export function parseSessionSearch(search: string): SessionLinkState | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const sourceRaw = params.get("source");
  if (!isSource(sourceRaw)) return null;

  const state: SessionLinkState = { source: sourceRaw };
  const mode = params.get("mode");
  if (isMode(mode)) state.mode = mode;

  const repo = params.get("repo")?.trim();
  if (repo) state.repo = repo;
  const repoB = params.get("repoB")?.trim();
  if (repoB) state.repoB = repoB;
  const url = params.get("url")?.trim();
  if (url) state.url = url;
  const goal = params.get("goal")?.trim();
  if (goal) state.goal = goal;

  const language = params.get("lang")?.trim();
  if (language) state.language = language;
  const since = params.get("since");
  if (since === "daily" || since === "weekly" || since === "monthly") {
    state.since = since;
  }

  const registry = params.get("registry");
  if (registry === "npm" || registry === "pypi") state.packageRegistry = registry;
  const pkg = params.get("pkg")?.trim();
  if (pkg) state.packageName = pkg;

  const tagA = params.get("tagA")?.trim();
  if (tagA) state.tagA = tagA;
  const tagB = params.get("tagB")?.trim();
  if (tagB) state.tagB = tagB;

  return state;
}

/** Build query string (no leading `?`) for the current session. */
export function buildSessionSearch(state: SessionLinkState): string {
  const params = new URLSearchParams();
  params.set("source", state.source);
  if ((state.source === "github" || state.source === "url") && state.mode) {
    params.set("mode", state.mode);
  }

  if (state.repo) params.set("repo", state.repo);
  if (state.repoB) params.set("repoB", state.repoB);
  if (state.url) params.set("url", state.url);
  if (state.goal && (state.source === "auto" || state.source === "trending")) {
    params.set("goal", state.goal);
  }
  if (state.source === "trending") {
    if (state.language) params.set("lang", state.language);
    if (state.since) params.set("since", state.since);
  }
  if (state.source === "package") {
    if (state.packageRegistry) params.set("registry", state.packageRegistry);
    if (state.packageName) params.set("pkg", state.packageName);
  }
  if (state.source === "releases") {
    if (state.tagA) params.set("tagA", state.tagA);
    if (state.tagB) params.set("tagB", state.tagB);
  }

  return params.toString();
}

export function buildSessionUrl(
  origin: string,
  pathname: string,
  state: SessionLinkState,
): string {
  const q = buildSessionSearch(state);
  const base = `${origin.replace(/\/$/, "")}${pathname || "/"}`;
  return q ? `${base}?${q}` : base;
}
