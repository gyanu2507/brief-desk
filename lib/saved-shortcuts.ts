import type { BriefMode, PackageRegistry, SourceKind } from "./types";

export const SAVED_MAX = 8;

export type SavedBrief = {
  id: string;
  at: number;
  label: string;
  source: SourceKind;
  mode: BriefMode;
  repo?: string;
  repoB?: string;
  url?: string;
  goal?: string;
  packageName?: string;
  packageRegistry?: PackageRegistry;
  tagA?: string;
  tagB?: string;
};

export function isSavedBrief(value: unknown): value is SavedBrief {
  if (!value || typeof value !== "object") return false;
  const v = value as SavedBrief;
  return (
    typeof v.id === "string" &&
    typeof v.at === "number" &&
    typeof v.label === "string" &&
    typeof v.source === "string" &&
    typeof v.mode === "string"
  );
}
