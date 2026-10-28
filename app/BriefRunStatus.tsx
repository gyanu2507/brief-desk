"use client";

import type { RunObservability } from "../lib/run-observability";

type Props = {
  runId: string | null;
  observability: RunObservability | null;
  busyNote: string | null;
  pipelineBusy: boolean;
};

export function BriefRunStatus({
  runId,
  observability,
  busyNote,
  pipelineBusy,
}: Props) {
  if (!runId && !pipelineBusy && !observability) return null;

  const tools = observability?.toolTimings ?? [];
  const model = observability?.modelUsage;

  return (
    <section className="run-status-panel" aria-live="polite" aria-label="Run status">
      <p className="section-label">Run status</p>
      {pipelineBusy ? (
        <p className="run-status-summary">{busyNote || "Running…"}</p>
      ) : observability?.errorCategory ? (
        <p className="run-status-summary run-status-error">
          {observability.errorCategory}
          {runId ? ` · ${runId}` : ""}
        </p>
      ) : (
        <p className="run-status-summary">
          {runId ? runId : "idle"}
          {model ? ` · model ${model.model} · ${model.calls} call(s)` : ""}
        </p>
      )}

      {tools.length ? (
        <ul className="run-status-tools">
          {tools.map((t, i) => (
            <li key={`${t.tool}-${i}`} className={t.ok ? "ok" : "bad"}>
              <span>{t.tool}</span>
              <strong>{t.ms}ms</strong>
            </li>
          ))}
        </ul>
      ) : null}

      {model ? (
        <p className="run-status-model">
          Draft model {model.ms}ms · prompt {model.promptChars} chars · completion{" "}
          {model.completionChars} chars
        </p>
      ) : null}
    </section>
  );
}
