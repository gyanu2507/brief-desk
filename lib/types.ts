export type SourceKind = "auto" | "github" | "url" | "compare" | "corpus";
export type BriefMode =
  | "overview"
  | "risks"
  | "architecture"
  | "activity"
  | "code"
  | "docs"
  | "general";

export type PromptUi = {
  readableDescription: string;
  modes: { id: BriefMode; label: string }[];
  defaultQuestions: Record<BriefMode, string>;
  suggest: Record<SourceKind, string[]>;
  sessionNotes: Record<string, string>;
  demos: {
    label: string;
    source: SourceKind;
    mode: BriefMode;
    repo?: string;
    repoB?: string;
    url?: string;
    goal?: string;
    question: string;
  }[];
};
