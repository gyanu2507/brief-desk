"use client";

import type { BriefHistoryEntry } from "../lib/brief-history";
import { downloadMarkdown } from "../lib/brief-history";

type Props = {
  entries: BriefHistoryEntry[];
  onOpen: (entry: BriefHistoryEntry) => void;
  onClear: () => void;
  onCopy: (markdown: string) => void;
};

function fmtWhen(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function BriefHistory({ entries, onOpen, onClear, onCopy }: Props) {
  if (!entries.length) {
    return (
      <div className="brief-history">
        <p className="section-label">History</p>
        <p className="brief-history-empty">Finished briefs show up here for reopen / export.</p>
      </div>
    );
  }

  return (
    <div className="brief-history">
      <div className="brief-history-head">
        <p className="section-label" style={{ marginBottom: 0 }}>
          History
        </p>
        <button type="button" className="brief-history-clear" onClick={onClear}>
          Clear
        </button>
      </div>
      <ul className="brief-history-list">
        {entries.map((e) => (
          <li key={e.id} className="brief-history-item">
            <button type="button" className="brief-history-main" onClick={() => onOpen(e)}>
              <span className="brief-history-label">{e.label}</span>
              <span className="brief-history-meta">
                {e.source}
                {e.evalScore != null ? ` · eval ${e.evalScore}` : ""}
                {` · ${fmtWhen(e.at)}`}
              </span>
            </button>
            <div className="brief-history-actions">
              <button type="button" className="chip history-action" onClick={() => onCopy(e.markdown)}>
                Copy
              </button>
              <button
                type="button"
                className="chip history-action"
                onClick={() =>
                  downloadMarkdown(
                    `brief-${e.source}-${e.at}`,
                    e.markdown,
                  )
                }
              >
                .md
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
