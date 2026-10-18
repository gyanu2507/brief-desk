"use client";

import { useEffect, useState } from "react";

export type ReleaseTag = {
  tag: string;
  name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
};

type Props = {
  repo: string | null;
  tagA: string;
  tagB: string;
  onTagA: (tag: string) => void;
  onTagB: (tag: string) => void;
  disabled?: boolean;
};

export function ReleaseDiffPanel({
  repo,
  tagA,
  tagB,
  onTagA,
  onTagB,
  disabled,
}: Props) {
  const [tags, setTags] = useState<ReleaseTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repo) {
      setTags([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/releases?repo=${encodeURIComponent(repo)}&max=20`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          ok?: boolean;
          releases?: ReleaseTag[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setTags([]);
          setError(body.error || "Could not load releases");
          return;
        }
        const list = Array.isArray(body.releases) ? body.releases : [];
        setTags(list);
        if (list.length >= 2) {
          if (!tagA) onTagA(list[1]!.tag);
          if (!tagB) onTagB(list[0]!.tag);
        } else if (list.length === 1) {
          if (!tagB) onTagB(list[0]!.tag);
        }
      } catch (e) {
        if (!cancelled) {
          setTags([]);
          setError(e instanceof Error ? e.message : "releases fetch failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (!repo) {
    return (
      <p className="release-diff-hint">Pick a GitHub repo to load release tags.</p>
    );
  }

  return (
    <div className="release-diff">
      <div className="release-diff-head">
        <p className="section-label" style={{ marginBottom: 0 }}>
          Release tags
        </p>
        {loading ? <span className="release-diff-status">loading…</span> : null}
        {!loading && tags.length ? (
          <span className="release-diff-status">{tags.length} tags</span>
        ) : null}
      </div>
      {error ? <p className="release-diff-error">{error}</p> : null}
      {!loading && !error && tags.length === 0 ? (
        <p className="release-diff-hint">No published releases for this repo.</p>
      ) : null}
      {tags.length > 0 ? (
        <>
          <p className="section-label">From (older)</p>
          <select
            className="field field-select"
            value={tagA}
            disabled={disabled || loading}
            onChange={(e) => onTagA(e.target.value)}
            aria-label="Older release tag"
          >
            <option value="">Select tag…</option>
            {tags.map((t) => (
              <option key={`a-${t.tag}`} value={t.tag}>
                {t.tag}
                {t.name && t.name !== t.tag ? ` · ${t.name}` : ""}
                {t.prerelease ? " (pre)" : ""}
              </option>
            ))}
          </select>
          <p className="section-label">To (newer)</p>
          <select
            className="field field-select"
            value={tagB}
            disabled={disabled || loading}
            onChange={(e) => onTagB(e.target.value)}
            aria-label="Newer release tag"
          >
            <option value="">Select tag…</option>
            {tags.map((t) => (
              <option key={`b-${t.tag}`} value={t.tag}>
                {t.tag}
                {t.name && t.name !== t.tag ? ` · ${t.name}` : ""}
                {t.prerelease ? " (pre)" : ""}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
