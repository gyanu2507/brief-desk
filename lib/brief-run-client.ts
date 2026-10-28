import { CANCELLED_MESSAGE, isAbortError } from "./abort";
import type { BriefRunInput, BriefRunResult } from "./brief-run";

export type BriefRunStreamHandlers = {
  onStep?: (step: string, steps: string[]) => void;
  signal?: AbortSignal;
};

function cancelledResult(ms = 0): BriefRunResult {
  return { ok: false, answer: "", steps: [], error: CANCELLED_MESSAGE, ms };
}

/** Prefer SSE so the plan board can light up live; fall back to JSON. */
export async function runBriefViaApi(
  input: BriefRunInput,
  handlers?: BriefRunStreamHandlers,
): Promise<BriefRunResult> {
  try {
    const res = await fetch("/api/brief-run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
      },
      body: JSON.stringify({ ...input, stream: true }),
      signal: handlers?.signal,
    });

    const ctype = res.headers.get("content-type") || "";
    if (!ctype.includes("text/event-stream")) {
      const body = (await res.json()) as BriefRunResult;
      if (!res.ok && !body.error) {
        return { ...body, ok: false, error: body.error || "brief-run failed" };
      }
      return body;
    }

    if (!res.body) {
      return { ok: false, answer: "", steps: [], error: "empty stream", ms: 0 };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: BriefRunResult | null = null;

    const onAbort = () => {
      void reader.cancel().catch(() => undefined);
    };
    handlers?.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      while (true) {
        if (handlers?.signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          return cancelledResult();
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const chunk of parts) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type?: string;
              step?: string;
              steps?: string[];
              ok?: boolean;
              answer?: string;
              error?: string;
              ms?: number;
              eval?: unknown;
              repos?: BriefRunResult["repos"];
            };
            if (ev.type === "step" && typeof ev.step === "string") {
              handlers?.onStep?.(ev.step, Array.isArray(ev.steps) ? ev.steps : [ev.step]);
            }
            if (ev.type === "result") {
              finalResult = {
                ok: Boolean(ev.ok),
                answer: typeof ev.answer === "string" ? ev.answer : "",
                steps: Array.isArray(ev.steps) ? ev.steps : [],
                error: ev.error,
                ms: typeof ev.ms === "number" ? ev.ms : 0,
                eval: ev.eval,
                ...(ev.repos?.length ? { repos: ev.repos } : {}),
              };
            }
          } catch {
            // ignore malformed event
          }
        }
      }
    } finally {
      handlers?.signal?.removeEventListener("abort", onAbort);
    }

    if (handlers?.signal?.aborted) {
      return cancelledResult(finalResult?.ms ?? 0);
    }

    return (
      finalResult || {
        ok: false,
        answer: "",
        steps: [],
        error: "stream ended without result",
        ms: 0,
      }
    );
  } catch (e) {
    if (isAbortError(e) || handlers?.signal?.aborted) {
      return cancelledResult();
    }
    throw e;
  }
}
