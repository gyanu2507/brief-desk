/** Parse brief_eval grounding fields for UI and markdown. */

export type BriefCitation = {
  kind: string;
  text: string;
  verified?: boolean;
  matched?: string;
  url?: string;
};

export type EvidenceLink = {
  label: string;
  url: string;
};

export type BriefGrounding = {
  citations: BriefCitation[];
  warnings: string[];
  evidenceLinks: EvidenceLink[];
  verifiedCount: number;
  unverifiedCount: number;
};

export function parseGrounding(evalObj: unknown): BriefGrounding | null {
  if (!evalObj || typeof evalObj !== "object") return null;
  const raw = evalObj as {
    citations?: unknown;
    warnings?: unknown;
    evidence_links?: unknown;
  };

  const citations: BriefCitation[] = Array.isArray(raw.citations)
    ? raw.citations
        .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
        .map((c) => ({
          kind: typeof c.kind === "string" ? c.kind : "ref",
          text: typeof c.text === "string" ? c.text : "",
          verified: Boolean(c.verified),
          matched: typeof c.matched === "string" ? c.matched : undefined,
          url: typeof c.url === "string" ? c.url : undefined,
        }))
        .filter((c) => c.text)
    : [];

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    : [];

  const evidenceLinks: EvidenceLink[] = Array.isArray(raw.evidence_links)
    ? raw.evidence_links
        .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === "object")
        .map((l) => ({
          label: typeof l.label === "string" ? l.label : typeof l.url === "string" ? l.url : "",
          url: typeof l.url === "string" ? l.url : "",
        }))
        .filter((l) => l.url.startsWith("http"))
    : [];

  if (!citations.length && !warnings.length && !evidenceLinks.length) return null;

  const verifiedCount = citations.filter((c) => c.verified).length;
  return {
    citations,
    warnings,
    evidenceLinks,
    verifiedCount,
    unverifiedCount: citations.length - verifiedCount,
  };
}

/** Append a grounding section to chat markdown. */
export function formatGroundingMarkdown(grounding: BriefGrounding): string {
  const lines: string[] = ["", "---", "### Grounding"];

  const verified = grounding.citations.filter((c) => c.verified);
  const unverified = grounding.citations.filter((c) => !c.verified);

  if (verified.length) {
    lines.push("", "**Verified findings**");
    for (const c of verified) {
      const href = c.url || (c.kind === "repo" ? `https://github.com/${c.text}` : null);
      lines.push(href ? `- [${c.text}](${href}) · ${c.kind}` : `- ${c.text} · ${c.kind}`);
    }
  }

  if (unverified.length || grounding.warnings.length) {
    lines.push("", "**Warnings** (not matched in evidence)");
    for (const c of unverified) {
      lines.push(`- ${c.text} · ${c.kind}`);
    }
    for (const w of grounding.warnings) {
      lines.push(`- ${w}`);
    }
  }

  if (grounding.evidenceLinks.length) {
    lines.push("", "**Evidence links**");
    for (const link of grounding.evidenceLinks.slice(0, 8)) {
      lines.push(`- [${link.label}](${link.url})`);
    }
  }

  return lines.join("\n");
}
