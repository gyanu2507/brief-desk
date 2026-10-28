/** Allow only safe href schemes for rendered Markdown / grounding links. */

export function isSafeHref(href: string | null | undefined): boolean {
  if (!href || typeof href !== "string") return false;
  const trimmed = href.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  try {
    const u = new URL(trimmed, "https://example.invalid");
    if (u.protocol === "http:" || u.protocol === "https:") {
      return Boolean(u.hostname);
    }
    if (u.protocol === "mailto:") {
      return trimmed.toLowerCase().startsWith("mailto:") && trimmed.includes("@");
    }
    return false;
  } catch {
    return false;
  }
}

export function safeHref(href: string | null | undefined): string | undefined {
  return isSafeHref(href) ? href!.trim() : undefined;
}
