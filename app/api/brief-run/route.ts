import { CANCELLED_MESSAGE } from "../../../lib/abort";
import { runBriefPipeline, type BriefRunInput } from "../../../lib/brief-run";

export const runtime = "nodejs";
export const maxDuration = 120;

function wantsStream(req: Request, body: BriefRunInput & { stream?: boolean }): boolean {
  if (body.stream === true) return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/event-stream");
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/** Abort when the client disconnects or cancels the fetch. */
function clientSignal(req: Request): AbortSignal {
  const ac = new AbortController();
  const upstream = req.signal;
  if (upstream.aborted) {
    ac.abort(upstream.reason);
    return ac.signal;
  }
  upstream.addEventListener(
    "abort",
    () => {
      if (!ac.signal.aborted) ac.abort(upstream.reason);
    },
    { once: true },
  );
  return ac.signal;
}

/** Deterministic Run agent path: gather → draft → eval (JSON or SSE). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BriefRunInput & { stream?: boolean };
    if (!body.source || !(body.question || body.goal)) {
      return Response.json(
        { ok: false, error: "source and question/goal are required" },
        { status: 400 },
      );
    }
    const input: BriefRunInput = {
      ...body,
      question: (body.goal || body.question || "").trim(),
    };
    const signal = clientSignal(req);

    if (!wantsStream(req, body)) {
      const result = await runBriefPipeline(input, { signal });
      const cancelled = result.error === CANCELLED_MESSAGE;
      return Response.json(result, {
        status: result.ok ? 200 : cancelled ? 499 : 502,
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (payload: unknown) => {
          try {
            controller.enqueue(enc.encode(sse(payload)));
          } catch {
            // client gone
          }
        };
        try {
          send({ type: "start" });
          const result = await runBriefPipeline(input, {
            signal,
            onStep: (step, stepsSoFar) => {
              if (signal.aborted) return;
              send({ type: "step", step, steps: stepsSoFar });
            },
          });
          send({ type: "result", ...result });
        } catch (e) {
          send({
            type: "result",
            ok: false,
            answer: "",
            steps: [],
            error: e instanceof Error ? e.message : "brief-run failed",
            ms: 0,
          });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        if (!signal.aborted) {
          // ReadableStream cancel when client drops; req.signal usually fires too.
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "brief-run failed" },
      { status: 500 },
    );
  }
}
