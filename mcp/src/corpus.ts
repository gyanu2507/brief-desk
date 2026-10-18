import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export type CorpusHit = {
  path: string;
  score: number;
  excerpt: string;
};

function corpusRoot(custom?: string): string {
  if (custom && existsSync(custom)) return custom;
  return path.join(process.cwd(), "mcp", "corpus");
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^\w\s./+-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 12);
}

/** Local markdown corpus search (bundled under mcp/corpus). No external package. */
export function searchCorpus(question: string, corpusDir?: string): {
  question: string;
  corpus: string;
  hits: CorpusHit[];
  guidance: string;
} {
  const root = corpusRoot(corpusDir);
  const terms = tokenize(question);
  const files = existsSync(root)
    ? readdirSync(root).filter((f) => /\.(md|txt)$/i.test(f))
    : [];
  const hits: CorpusHit[] = [];

  for (const file of files) {
    const full = path.join(root, file);
    const text = readFileSync(full, "utf8");
    const lower = text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 1;
      if (file.toLowerCase().includes(t)) score += 1;
    }
    if (score === 0 && terms.length === 0) score = 1;
    if (score === 0) continue;
    hits.push({
      path: file,
      score,
      excerpt: text.trim().slice(0, 600),
    });
  }

  hits.sort((a, b) => b.score - a.score);
  return {
    question,
    corpus: root,
    hits: hits.slice(0, 6),
    guidance:
      hits.length > 0
        ? "Answer from these local corpus hits only. Cite file paths."
        : "No local hits. Say the bundled sample does not cover the question.",
  };
}
