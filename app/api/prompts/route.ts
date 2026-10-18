import { NextResponse } from "next/server";
import { getPromptsBundle, renderStartBrief, type BriefMode, type SourceKind } from "../../../lib/prompts";

export const runtime = "nodejs";

/** Expose prompt-file pack to the UI (demos, suggests, start-brief template). */
export async function GET() {
  try {
    return NextResponse.json(getPromptsBundle());
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** Render start-brief.md or auto-brief.md from prompt files. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      source?: SourceKind;
      mode?: BriefMode;
      repo?: string | null;
      repoB?: string | null;
      url?: string | null;
      question?: string;
      goal?: string;
    };
    const text = (body.goal || body.question || "").trim();
    if (!body.source || !text) {
      return NextResponse.json(
        { error: "source and question/goal are required" },
        { status: 400 },
      );
    }
    const content = renderStartBrief({
      source: body.source,
      mode: body.mode ?? "general",
      repo: body.repo,
      repoB: body.repoB,
      url: body.url,
      question: text,
      goal: body.goal || text,
    });
    return NextResponse.json({ content });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
