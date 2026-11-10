"use client";

import type { SavedBrief } from "../lib/saved-shortcuts";
import type { PromptUi } from "../lib/types";

type Demo = PromptUi["demos"][number];

/** Demo prompts that run at once, and saved shortcuts that refill the form. */
export function ShortcutLists({
  demos,
  saved,
  demosDisabled,
  onDemo,
  onSaved,
}: {
  demos: Demo[];
  saved: SavedBrief[];
  demosDisabled: boolean;
  onDemo: (d: Demo) => void;
  onSaved: (s: SavedBrief) => void;
}) {
  return (
    <>
      <p className="section-label" style={{ marginTop: 18 }}>
        Demos
      </p>
      <div className="demo-list">
        {demos.map((d) => (
          <button
            key={d.label}
            type="button"
            className="chip"
            disabled={demosDisabled}
            onClick={() => onDemo(d)}
          >
            {d.label}
          </button>
        ))}
      </div>

      {saved.length ? (
        <>
          <p className="section-label">Saved</p>
          <div className="demo-list">
            {saved.map((s) => (
              <button
                key={s.id}
                type="button"
                className="chip"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 11,
                }}
                onClick={() => onSaved(s)}
              >
                {s.source} · {s.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
