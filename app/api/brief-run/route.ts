import { CANCELLED_MESSAGE } from "../../../lib/abort";
import { runBriefPipeline, type BriefRunInput } from "../../../lib/brief-run";
import { briefRunGate, rateLimit } from "../../../lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const RATE_LIMIT = Math.max(1, Number(process.env.BRIEF_RUN_RATE_LIMIT || 8));
const RATE_WINDOW_MS = Math.max(1_000, Number(process.env.BRIEF_RUN_RATE_WINDOW_MS || 60_000));

function wantsStream(req: Request, body: BriefRunInput & { stream?: boolean }): boolean {
  if (body.stream === true) return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/event-stream");
}

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "anon";
  return req.headers.get("x-real-ip") || "anon";
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

function isCancelledError(error?: string): boolean {
  return Boolean(error && error.startsWith(CANCELLED_MESSAGE));
}

/** Deterministic Run agent path: gather → draft → eval (JSON or SSE). */
export async function POST(req: Request) {
  const limited = rateLimit({
    key: `brief-run:${clientKey(req)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_WINDOW_MS,
  });
  if (!limited.ok) {
    return Response.json(
      {
        ok: false,
        error: `Rate limit exceeded. Retry in ${limited.retryAfterSec}s.`,
        errorCategory: "rate_limit",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limited.retryAfterSec),
          "X-RateLimit-Limit": String(RATE_LIMIT),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let release: (() => void) | null = null;
  try {
    release = await briefRunGate.acquire();
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
      const cancelled = isCancelledError(result.error);
      return Response.json(result, {
        status: result.ok ? 200 : cancelled ? 499 : 502,
        headers: {
          "X-RateLimit-Limit": String(RATE_LIMIT),
          "X-RateLimit-Remaining": String(limited.remaining),
        },
      });
    }

    // Hold the concurrency slot until the stream finishes.
    const heldRelease = release;
    release = null;

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
          heldRelease();
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        // req.signal abort usually covers cancel; slot released in finally.
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-RateLimit-Limit": String(RATE_LIMIT),
        "X-RateLimit-Remaining": String(limited.remaining),
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "brief-run failed" },
      { status: 500 },
    );
  } finally {
    release?.();
  }
}
