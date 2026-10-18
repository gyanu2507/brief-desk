/** Turn a plain brief-run answer into chat-friendly markdown. */
export function formatBriefMarkdown(answer: string, meta?: string | null): string {
  let text = answer.replace(/\r\n/g, "\n").trim();
  if (!text) return text;

  if (!/^#{1,3}\s/m.test(text)) {
    text = text.replace(/^Plan:\s*(.+)$/im, "**Plan:** $1\n");
    // Promote bare section labels like "Risks" / "Sources" into headings.
    text = text.replace(
      /^(Risks?|Sources?|Summary|Overview|Architecture|Activity|Recommendations?)\s*$/gim,
      "### $1",
    );
    // Ensure list markers have a blank line before them when stuck to a paragraph.
    text = text.replace(/([^\n])\n([-*]\s+)/g, "$1\n\n$2");
  }

  if (meta?.trim()) {
    text += `\n\n---\n_${meta.trim()}_`;
  }
  return text;
}
