"use client";

import { memo, type ReactNode } from "react";
import { Markdown } from "@copilotkit/react-ui";
import { safeHref } from "../lib/safe-url";

type Props = {
  content: string;
  className?: string;
};

type AnchorProps = {
  href?: string;
  children?: ReactNode;
};

function SafeAnchor({ href, children }: AnchorProps) {
  const ok = safeHref(href);
  if (!ok) return <span>{children}</span>;
  return (
    <a href={ok} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * CopilotKit Markdown already sanitizes with rehype-sanitize.
 * We harden links (http/https/mailto only) and drop images.
 */
function SafeMarkdownInner({ content, className }: Props) {
  return (
    <div className={className || "safe-markdown"}>
      <Markdown
        content={content || ""}
        components={{
          a: SafeAnchor as never,
          img: (() => null) as never,
        }}
      />
    </div>
  );
}

export const SafeMarkdown = memo(SafeMarkdownInner);
