/** Shared abort helpers for brief-run (API, MCP, UI). */

export function isAbortError(e: unknown): boolean {
  if (!e) return false;
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  }
  if (e instanceof Error) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return true;
    if (/aborted|AbortError|TimeoutError|timed out|cancelled|canceled/i.test(e.message)) {
      return true;
    }
  }
  return false;
}

/** Combine signals. AbortSignal.any when available; otherwise manual link. */
export function linkAbortSignals(
  ...signals: Array<AbortSignal | undefined | null>
): AbortSignal | undefined {
  const list = signals.filter((s): s is AbortSignal => Boolean(s));
  if (list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn.call(AbortSignal, list);
  }
  const controller = new AbortController();
  const onAbort = (s: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(s.reason);
    }
  };
  for (const s of list) {
    if (s.aborted) {
      onAbort(s);
      return controller.signal;
    }
    s.addEventListener("abort", () => onAbort(s), { once: true });
  }
  return controller.signal;
}

/**
 * Abort after `ms`. Uses setTimeout (keeps the event loop alive) instead of
 * AbortSignal.timeout, which can drop timers under tsx/node:test.
 */
export function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  const timer = setTimeout(() => {
    if (!c.signal.aborted) {
      c.abort(new DOMException(`Timed out after ${ms}ms`, "TimeoutError"));
    }
  }, ms);
  return c.signal;
}

/** Timeout linked with optional parent; call clear() when the work finishes. */
export function withTimeout(
  ms: number,
  parent?: AbortSignal | null,
): { signal: AbortSignal; clear: () => void } {
  const c = new AbortController();
  const timer = setTimeout(() => {
    if (!c.signal.aborted) {
      c.abort(new DOMException(`Timed out after ${ms}ms`, "TimeoutError"));
    }
  }, ms);
  const clear = () => clearTimeout(timer);

  if (parent) {
    if (parent.aborted) {
      clear();
      c.abort(parent.reason);
    } else {
      parent.addEventListener(
        "abort",
        () => {
          clear();
          if (!c.signal.aborted) c.abort(parent.reason);
        },
        { once: true },
      );
    }
  }

  return { signal: c.signal, clear };
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("brief-run cancelled", "AbortError");
  }
}

export const CANCELLED_MESSAGE = "Run cancelled.";
export const TIMEOUT_MESSAGE = "Timed out waiting for a tool or model response.";
