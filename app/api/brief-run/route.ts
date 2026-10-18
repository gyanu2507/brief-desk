import { NextResponse } from "next/server";
import { runBriefPipeline, type BriefRunInput } from "../../../lib/brief-run";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Deterministic Run agent path: gather → draft → eval (no CopilotKit tool loop). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BriefRunInput;
    if (!body.source || !(body.question || body.goal)) {
      return NextResponse.json(
        { ok: false, error: "source and question/goal are required" },
        { status: 400 },
      );
    }
    const result = await runBriefPipeline({
      ...body,
      question: (body.goal || body.question || "").trim(),
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "brief-run failed" },
      { status: 500 },
    );
  }
}
