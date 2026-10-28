/** Present brief_eval scores with explicit limitations. */

export type EvalScores = {
  groundedness: number;
  completeness: number;
  citation: number;
  overall: number;
};

export type EvalView = {
  pass: boolean | null;
  scores: EvalScores | null;
  revisions: string[];
  note: string;
  limitations: string[];
};

const DEFAULT_LIMITATIONS = [
  "Heuristic rubric only: no paid LLM-as-judge.",
  "Citation checks match draft tokens against the evidence pack text.",
  "Overall score is not a guarantee of factual correctness.",
];

export function parseEvalView(evalObj: unknown): EvalView | null {
  if (!evalObj || typeof evalObj !== "object") return null;
  const raw = evalObj as {
    pass?: unknown;
    scores?: Record<string, unknown>;
    revisions?: unknown;
    note?: unknown;
  };

  const scoresRaw = raw.scores;
  const scores =
    scoresRaw && typeof scoresRaw === "object"
      ? {
          groundedness: num(scoresRaw.groundedness),
          completeness: num(scoresRaw.completeness),
          citation: num(scoresRaw.citation),
          overall: num(scoresRaw.overall),
        }
      : null;

  const usable =
    scores &&
    scores.overall != null &&
    scores.groundedness != null &&
    scores.completeness != null &&
    scores.citation != null;

  if (!usable && raw.pass === undefined) return null;

  const revisions = Array.isArray(raw.revisions)
    ? raw.revisions.filter((r): r is string => typeof r === "string" && r.trim().length > 0)
    : [];

  const note =
    typeof raw.note === "string" && raw.note.trim()
      ? raw.note.trim()
      : "Free heuristic rubric (no paid eval API).";

  return {
    pass: typeof raw.pass === "boolean" ? raw.pass : null,
    scores: usable
      ? {
          groundedness: scores!.groundedness!,
          completeness: scores!.completeness!,
          citation: scores!.citation!,
          overall: scores!.overall!,
        }
      : null,
    revisions,
    note,
    limitations: DEFAULT_LIMITATIONS,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function formatEvalMarkdown(view: EvalView): string {
  const lines = ["", "---", "### Evaluation"];
  if (view.pass != null) {
    lines.push("", view.pass ? "**Result:** pass" : "**Result:** needs revision");
  }
  if (view.scores) {
    lines.push(
      "",
      `**Scores:** overall ${view.scores.overall} · groundedness ${view.scores.groundedness} · completeness ${view.scores.completeness} · citation ${view.scores.citation}`,
    );
  }
  if (view.revisions.length) {
    lines.push("", "**Suggested revisions**");
    for (const r of view.revisions.slice(0, 6)) lines.push(`- ${r}`);
  }
  lines.push("", "**Limitations**");
  for (const lim of view.limitations) lines.push(`- ${lim}`);
  lines.push(`- ${view.note}`);
  return lines.join("\n");
}
