"use client";

import type { BriefGrounding } from "../lib/citations";
import { safeHref } from "../lib/safe-url";

export function BriefGroundingPanel({ grounding }: { grounding: BriefGrounding | null }) {
  if (!grounding) return null;

  const verified = grounding.citations.filter((c) => c.verified);
  const unverified = grounding.citations.filter((c) => !c.verified);
  const hasWarnings = unverified.length > 0 || grounding.warnings.length > 0;

  return (
    <section className="grounding-panel" aria-label="Brief grounding">
      <p className="section-label">Grounding</p>
      <p className="grounding-summary">
        {grounding.verifiedCount} verified
        {grounding.unverifiedCount ? ` · ${grounding.unverifiedCount} unverified` : ""}
        {grounding.warnings.length ? ` · ${grounding.warnings.length} warning(s)` : ""}
      </p>

      {verified.length ? (
        <div className="grounding-block grounding-verified">
          <p className="grounding-block-title">Verified findings</p>
          <ul>
            {verified.map((c) => {
              const href = safeHref(
                c.url || (c.kind === "repo" ? `https://github.com/${c.text}` : undefined),
              );
              return (
                <li key={`v-${c.kind}-${c.text}`}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {c.text}
                    </a>
                  ) : (
                    <span>{c.text}</span>
                  )}
                  <span className="grounding-kind">{c.kind}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hasWarnings ? (
        <div className="grounding-block grounding-warnings" role="status">
          <p className="grounding-block-title">Warnings</p>
          <ul>
            {unverified.map((c) => (
              <li key={`u-${c.kind}-${c.text}`}>
                {c.text}
                <span className="grounding-kind">not in evidence</span>
              </li>
            ))}
            {grounding.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {grounding.evidenceLinks.length ? (
        <div className="grounding-block grounding-links">
          <p className="grounding-block-title">Evidence links</p>
          <ul>
            {grounding.evidenceLinks.slice(0, 8).map((link) => {
              const href = safeHref(link.url);
              return (
                <li key={link.url}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {link.label}
                    </a>
                  ) : (
                    <span>{link.label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
