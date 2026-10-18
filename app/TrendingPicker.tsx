"use client";

import { useEffect, useState } from "react";

export type TrendingRow = {
  repo: string;
  description?: string | null;
  stars_delta?: string | null;
  stars_period?: string | null;
  language?: string | null;
};

type Props = {
  language: string;
  since: string;
  /** Prefill from a completed brief-run (optional). */
  seedRepos?: TrendingRow[];
  disabled?: boolean;
  onDeepBrief: (repo: string, kind: "overview" | "risks") => void;
};

export function TrendingPicker({
  language,
  since,
  seedRepos,
  disabled,
  onDeepBrief,
}: Props) {
  const [repos, setRepos] = useState<TrendingRow[]>(seedRepos || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    if (seedRepos && seedRepos.length) {
      setRepos(seedRepos);
    }
  }, [seedRepos]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      since,
      max: "10",
    });
    if (language) params.set("language", language);

    void (async () => {
      try {
        const res = await fetch(`/api/trending?${params}`, { cache: "no-store" });
        const body = (await res.json()) as {
          ok?: boolean;
          repos?: TrendingRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          setError(body.error || "Could not load trending");
          return;
        }
        setRepos(Array.isArray(body.repos) ? body.repos : []);
        setFetchedAt(Date.now());
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "trending fetch failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [language, since]);

  return (
    <div className="trending-picker">
      <div className="trending-picker-head">
        <p className="section-label" style={{ marginBottom: 0 }}>
          Trending now
        </p>
        {loading ? <span className="trending-picker-status">loading…</span> : null}
        {!loading && fetchedAt ? (
          <span className="trending-picker-status">live</span>
        ) : null}
      </div>
      {error ? <p className="trending-picker-error">{error}</p> : null}
      {repos.length === 0 && !loading ? (
        <p className="trending-picker-empty">
          No repos yet. Rank trending, or check MCP is on 0.10.0+.
        </p>
      ) : (
        <ul className="trending-picker-list">
          {repos.map((row) => (
            <li key={row.repo} className="trending-picker-row">
              <div className="trending-picker-main">
                <a
                  className="trending-picker-repo"
                  href={`https://github.com/${row.repo}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {row.repo}
                </a>
                {row.stars_delta ? (
                  <span className="trending-picker-stars">
                    +{row.stars_delta}
                    {row.stars_period ? ` ${row.stars_period}` : ""}
                  </span>
                ) : null}
              </div>
              {row.description ? (
                <p className="trending-picker-desc">{row.description}</p>
              ) : null}
              <div className="trending-picker-actions">
                <button
                  type="button"
                  className="chip trending-action"
                  disabled={disabled}
                  onClick={() => onDeepBrief(row.repo, "overview")}
                >
                  Deep brief
                </button>
                <button
                  type="button"
                  className="chip trending-action"
                  disabled={disabled}
                  onClick={() => onDeepBrief(row.repo, "risks")}
                >
                  Risks
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
