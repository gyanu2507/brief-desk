"use client";

import { Markdown } from "@copilotkit/react-ui";

type Props = {
  user: string;
  assistant: string;
};

/** Strip the trailing `--- _meta_` footer formatBriefMarkdown appends. */
function stripMetaFooter(markdown: string): string {
  return markdown.replace(/\n\n---\n_[^_\n]+_\s*$/u, "").trim();
}

/**
 * Stable History restore UI with real markdown (not raw **asterisks**).
 */
export function RestoredBrief({ user, assistant }: Props) {
  const body = stripMetaFooter(assistant);

  return (
    <div className="restored-brief" data-testid="restored-brief">
      <div className="restored-brief-user">
        <span className="restored-brief-label">You</span>
        <p className="restored-brief-text">{user}</p>
      </div>
      <div className="restored-brief-assistant">
        <span className="restored-brief-label">Brief</span>
        <div className="restored-brief-md">
          <Markdown content={body} />
        </div>
      </div>
      <p className="restored-brief-note">
        Restored from History · send a new message to continue chatting
      </p>
    </div>
  );
}
