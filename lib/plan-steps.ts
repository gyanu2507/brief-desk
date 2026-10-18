export type PlanStep = {
  id: string;
  label: string;
  state: "pending" | "active" | "done" | "error" | "skipped";
};

export function expectedSteps(
  source: string,
  hasBriefAuto: boolean,
  opts?: { packageRegistry?: "npm" | "pypi" | null },
): PlanStep[] {
  if (source === "auto") {
    if (hasBriefAuto) {
      return [
        { id: "gather", label: "brief_auto", state: "pending" },
        { id: "draft", label: "draft", state: "pending" },
        { id: "eval", label: "brief_eval", state: "pending" },
        { id: "revise", label: "revise (if needed)", state: "pending" },
      ];
    }
    return [
      { id: "plan", label: "brief_plan", state: "pending" },
      { id: "orch", label: "brief_orchestrate", state: "pending" },
      { id: "draft", label: "draft", state: "pending" },
      { id: "eval", label: "brief_eval", state: "pending" },
    ];
  }
  if (source === "corpus") {
    return [
      { id: "corpus", label: "brief_corpus", state: "pending" },
      { id: "draft", label: "draft", state: "pending" },
      { id: "eval", label: "brief_eval", state: "pending" },
    ];
  }
  if (source === "trending") {
    return [
      { id: "trend", label: "brief_github_trending", state: "pending" },
      { id: "draft", label: "draft", state: "pending" },
      { id: "eval", label: "brief_eval", state: "pending" },
    ];
  }
  if (source === "package") {
    const tool =
      opts?.packageRegistry === "pypi" ? "brief_pypi_package" : "brief_npm_package";
    return [
      { id: "pkg", label: tool, state: "pending" },
      { id: "draft", label: "draft", state: "pending" },
      { id: "eval", label: "brief_eval", state: "pending" },
    ];
  }
  return [
    { id: "orch", label: "brief_orchestrate", state: "pending" },
    { id: "draft", label: "draft", state: "pending" },
    { id: "eval", label: "brief_eval", state: "pending" },
  ];
}

export function stepsFromNames(names: string[]): PlanStep[] {
  return names.map((label, i) => ({
    id: `${label}-${i}`,
    label,
    state: "done" as const,
  }));
}
