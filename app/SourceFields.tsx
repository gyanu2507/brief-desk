"use client";

import type { SavedBrief } from "../lib/saved-shortcuts";
import {
  PACKAGE_REGISTRIES,
  TRENDING_LANGUAGES,
  TRENDING_SINCE,
} from "../lib/select-options";
import type { BriefMode, PackageRegistry, SourceKind } from "../lib/types";
import { ReleaseDiffPanel } from "./ReleaseDiffPanel";
import { RepoCombobox } from "./RepoCombobox";
import { TrendingPicker, type TrendingRow } from "./TrendingPicker";

type Since = "daily" | "weekly" | "monthly";

export type SourceFieldsProps = {
  source: SourceKind;
  setSource: (v: SourceKind) => void;
  /** Disables controls that start MCP work (backend down or a run in flight). */
  disabled: boolean;
  modes: { id: BriefMode; label: string }[];
  mode: BriefMode;
  setMode: (v: BriefMode) => void;
  goalInput: string;
  setGoalInput: (v: string) => void;
  languageInput: string;
  setLanguageInput: (v: string) => void;
  sinceInput: Since;
  setSinceInput: (v: Since) => void;
  trendingSeed: TrendingRow[];
  onDeepBrief: (repo: string, kind: "overview" | "risks") => void;
  packageRegistry: PackageRegistry;
  setPackageRegistry: (v: PackageRegistry) => void;
  packageInput: string;
  setPackageInput: (v: string) => void;
  repoInput: string;
  setRepoInput: (v: string) => void;
  /** repoInput after normalization, or null when it isn't owner/name. */
  repo: string | null;
  repoBInput: string;
  setRepoBInput: (v: string) => void;
  tagA: string;
  setTagA: (v: string) => void;
  tagB: string;
  setTagB: (v: string) => void;
  urlInput: string;
  setUrlInput: (v: string) => void;
  saved: SavedBrief[];
};

/** Source picker plus the inputs each source needs. */
export function SourceFields({
  source,
  setSource,
  disabled,
  modes,
  mode,
  setMode,
  goalInput,
  setGoalInput,
  languageInput,
  setLanguageInput,
  sinceInput,
  setSinceInput,
  trendingSeed,
  onDeepBrief,
  packageRegistry,
  setPackageRegistry,
  packageInput,
  setPackageInput,
  repoInput,
  setRepoInput,
  repo,
  repoBInput,
  setRepoBInput,
  tagA,
  setTagA,
  tagB,
  setTagB,
  urlInput,
  setUrlInput,
  saved,
}: SourceFieldsProps) {
  return (
    <>
      <p className="section-label">Source</p>
      <div className="source-grid">
        {(
          [
            ["auto", "Auto"],
            ["trending", "Trending"],
            ["package", "Package"],
            ["releases", "Releases"],
            ["github", "GitHub"],
            ["url", "Docs"],
            ["compare", "Compare"],
            ["corpus", "Corpus"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`chip${source === id ? " active" : ""}${id === "auto" ? " span-all" : ""}`}
            onClick={() => setSource(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "trending" ? (
        <>
          <p className="section-label">Language</p>
          <select
            className="field field-select"
            value={languageInput}
            onChange={(e) => setLanguageInput(e.target.value)}
            aria-label="Trending language"
          >
            {TRENDING_LANGUAGES.map((opt) => (
              <option key={opt.value || "any"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="section-label">Window</p>
          <select
            className="field field-select"
            value={sinceInput}
            onChange={(e) =>
              setSinceInput(e.target.value as "daily" | "weekly" | "monthly")
            }
            aria-label="Trending time window"
          >
            {TRENDING_SINCE.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <TrendingPicker
            language={languageInput}
            since={sinceInput}
            seedRepos={trendingSeed}
            disabled={disabled}
            onDeepBrief={onDeepBrief}
          />
        </>
      ) : null}

      {source === "auto" ? (
        <>
          <p className="section-label">Goal</p>
          <textarea
            className="field"
            style={{ minHeight: 80, resize: "vertical", lineHeight: 1.4 }}
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
            placeholder="Include owner/name or https://…"
          />
        </>
      ) : null}

      {source === "package" ? (
        <>
          <p className="section-label">Registry</p>
          <select
            className="field field-select"
            value={packageRegistry}
            onChange={(e) => setPackageRegistry(e.target.value as PackageRegistry)}
            aria-label="Package registry"
          >
            {PACKAGE_REGISTRIES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="section-label">Package name</p>
          <input
            className="field"
            value={packageInput}
            onChange={(e) => setPackageInput(e.target.value)}
            placeholder={packageRegistry === "npm" ? "zod or @scope/name" : "httpx"}
            spellCheck={false}
            aria-label="Package name"
          />
        </>
      ) : null}

      {source === "github" || source === "url" ? (
        <>
          <p className="section-label">Brief type</p>
          <select
            className="field field-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as BriefMode)}
            aria-label="Brief type"
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {source === "github" ||
      source === "url" ||
      source === "compare" ||
      source === "releases" ? (
        <RepoCombobox
          label={source === "compare" ? "Repo A" : "GitHub repo"}
          value={repoInput}
          onChange={(v) => {
            setRepoInput(v);
            if (source === "releases") {
              setTagA("");
              setTagB("");
            }
          }}
          savedRepos={saved
            .map((s) => s.repo)
            .filter((r): r is string => Boolean(r))}
        />
      ) : null}

      {source === "releases" ? (
        <ReleaseDiffPanel
          repo={repo}
          tagA={tagA}
          tagB={tagB}
          onTagA={setTagA}
          onTagB={setTagB}
          disabled={disabled}
        />
      ) : null}

      {source === "compare" ? (
        <RepoCombobox
          label="Repo B"
          value={repoBInput}
          onChange={setRepoBInput}
          savedRepos={saved
            .flatMap((s) => [s.repo, s.repoB])
            .filter((r): r is string => Boolean(r))}
        />
      ) : null}

      {source === "url" ? (
        <>
          <p className="section-label">Docs URL</p>
          <input
            className="field"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…"
            spellCheck={false}
          />
        </>
      ) : null}

      {source === "corpus" ? (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--muted)", lineHeight: 1.4 }}>
          Bundled sample docs in this repo (<code>mcp/corpus</code>).
        </p>
      ) : null}
    </>
  );
}
