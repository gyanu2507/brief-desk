"use client";

import type { EvalView } from "../lib/eval-display";

function pct(score: number): string {
  // overall is 0-100; others are 0-1
  if (score > 1) return `${Math.round(score)}`;
  return score.toFixed(2);
}

export function BriefEvalPanel({ evalView }: { evalView: EvalView | null }) {
  if (!evalView) return null;

  return (
    <section className="eval-panel" aria-label="Brief evaluation">
      <p className="section-label">Evaluation</p>
      <p className="eval-summary">
        {evalView.pass == null ? "scored" : evalView.pass ? "pass" : "needs revision"}
        {evalView.scores ? ` · overall ${pct(evalView.scores.overall)}` : ""}
      </p>

      {evalView.scores ? (
        <ul className="eval-scores">
          <li>
            <span>Groundedness</span>
            <strong>{pct(evalView.scores.groundedness)}</strong>
          </li>
          <li>
            <span>Completeness</span>
            <strong>{pct(evalView.scores.completeness)}</strong>
          </li>
          <li>
            <span>Citation</span>
            <strong>{pct(evalView.scores.citation)}</strong>
          </li>
          <li>
            <span>Overall</span>
            <strong>{pct(evalView.scores.overall)}</strong>
          </li>
        </ul>
      ) : null}

      {evalView.revisions.length ? (
        <div className="eval-block">
          <p className="eval-block-title">Suggested revisions</p>
          <ul>
            {evalView.revisions.slice(0, 5).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="eval-block eval-limits">
        <p className="eval-block-title">Limitations</p>
        <ul>
          {evalView.limitations.map((lim) => (
            <li key={lim}>{lim}</li>
          ))}
          <li>{evalView.note}</li>
        </ul>
      </div>
    </section>
  );
}
