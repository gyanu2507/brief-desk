/**
 * Pure helpers for the desk page: input normalization, session notes and
 * links, and chat message shaping. Kept out of app/page.tsx so they can be
 * read and tested on their own.
 */
import type { BriefHistoryEntry } from "./brief-history";
import type { PlanStep } from "./plan-steps";
import { isKnownLanguage } from "./select-options";
import type { SessionLinkState } from "./session-link";
import { renderTemplate } from "./template";
import type { BriefMode, PackageRegistry, PromptUi, SourceKind } from "./types";

export type RunOverride = Partial<{
  source: SourceKind;
  mode: BriefMode;
  repo: string | null;
  repoB: string | null;
  url: string | null;
  goal: string | null;
  language: string | null;
  since: string | null;
  packageName: string | null;
  packageRegistry: PackageRegistry;
  tagA: string | null;
  tagB: string | null;
}>;

export function emitPlan(detail: { steps?: PlanStep[]; note?: string | null; active?: boolean }) {
  window.dispatchEvent(new CustomEvent("brief-desk-plan", { detail }));
}

export const STORE_KEY = "brief-desk-v4";
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const RUN_WATCHDOG_MS = 90_000;

export function normalizeRepo(value: string): string | null {
  const trimmed = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  return REPO_RE.test(trimmed) ? trimmed : null;
}

export function normalizeUrl(value: string): string | null {
  const t = value.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function sessionNote(
  ui: PromptUi,
  args: {
    source: SourceKind;
    mode: BriefMode;
    repo: string | null;
    repoB: string | null;
    url: string | null;
    packageName: string | null;
    packageRegistry: PackageRegistry;
    tagA: string | null;
    tagB: string | null;
  },
): string {
  const notes = ui.sessionNotes;
  if (args.source === "auto") return notes.auto;
  if (args.source === "trending") return notes.trending || "Use brief_github_trending, then brief_eval.";
  if (args.source === "package") {
    return args.packageName
      ? renderTemplate(notes.package_ready || "Call brief_{{registry}}_package name={{package}}.", {
          registry: args.packageRegistry,
          package: args.packageName,
        })
      : notes.package_missing || "Pick npm or PyPI and a package name.";
  }
  if (args.source === "releases") {
    return args.repo && args.tagA && args.tagB
      ? renderTemplate(
          notes.releases_ready ||
            "Call brief_repo_release_diff repo={{repo}} tag_a={{tag_a}} tag_b={{tag_b}}.",
          { repo: args.repo, tag_a: args.tagA, tag_b: args.tagB },
        )
      : notes.releases_missing || "Pick a repo and two release tags.";
  }
  if (args.source === "github") {
    return args.repo
      ? renderTemplate(notes.github_ready, { repo: args.repo, mode: args.mode })
      : notes.github_missing;
  }
  if (args.source === "url") {
    if (!args.url) return notes.url_missing;
    return renderTemplate(notes.url_ready, {
      url: args.url,
      mode: args.mode,
      repo_suffix: args.repo ? ` and repo=${args.repo}` : "",
    });
  }
  if (args.source === "compare") {
    return args.repo && args.repoB
      ? renderTemplate(notes.compare_ready, {
          repo: args.repo,
          repo_b: args.repoB,
        })
      : notes.compare_missing;
  }
  return notes.corpus;
}

export function applySessionLink(
  state: SessionLinkState,
  setters: {
    setSource: (v: SourceKind) => void;
    setMode: (v: BriefMode) => void;
    setRepoInput: (v: string) => void;
    setRepoBInput: (v: string) => void;
    setUrlInput: (v: string) => void;
    setGoalInput: (v: string) => void;
    setLanguageInput: (v: string) => void;
    setSinceInput: (v: "daily" | "weekly" | "monthly") => void;
    setPackageRegistry: (v: PackageRegistry) => void;
    setPackageInput: (v: string) => void;
    setTagA: (v: string) => void;
    setTagB: (v: string) => void;
  },
) {
  setters.setSource(state.source);
  if (state.mode) setters.setMode(state.mode);
  if (state.repo) setters.setRepoInput(state.repo);
  if (state.repoB) setters.setRepoBInput(state.repoB);
  if (state.url) setters.setUrlInput(state.url);
  if (state.goal) setters.setGoalInput(state.goal);
  if (state.language && isKnownLanguage(state.language)) {
    setters.setLanguageInput(state.language);
  }
  if (state.since) setters.setSinceInput(state.since);
  if (state.packageRegistry) setters.setPackageRegistry(state.packageRegistry);
  if (state.packageName) setters.setPackageInput(state.packageName);
  if (state.tagA) setters.setTagA(state.tagA);
  if (state.tagB) setters.setTagB(state.tagB);
}

export function messageRole(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const role = (msg as { role?: string }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

export function messageText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

export function chatMessagesFromHistory(entry: BriefHistoryEntry) {
  const q = entry.question || entry.label || "Brief";
  const stamp = entry.at || Date.now();
  return {
    question: q,
    messages: [
      {
        id: `hist-u-${entry.id}-${stamp}`,
        role: "user" as const,
        content: q,
      },
      {
        id: `hist-a-${entry.id}-${stamp}`,
        role: "assistant" as const,
        content: entry.markdown,
      },
    ],
  };
}
