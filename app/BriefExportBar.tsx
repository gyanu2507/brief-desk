"use client";

import { useState } from "react";
import { downloadMarkdown } from "../lib/brief-history";

type Props = {
  markdown: string | null;
  filename?: string;
};

export function BriefExportBar({ markdown, filename = "brief" }: Props) {
  const [copied, setCopied] = useState(false);
  if (!markdown) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  return (
    <div className="brief-export-bar">
      <span className="brief-export-label">Last brief</span>
      <div className="brief-export-actions">
        <button type="button" className="chip history-action" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy markdown"}
        </button>
        <button
          type="button"
          className="chip history-action"
          onClick={() => downloadMarkdown(filename, markdown)}
        >
          Download .md
        </button>
      </div>
    </div>
  );
}
