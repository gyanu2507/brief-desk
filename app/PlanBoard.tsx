"use client";

import { useEffect, useState } from "react";
import type { PlanStep } from "../lib/plan-steps";

export type { PlanStep };
export { expectedSteps, stepsFromNames } from "../lib/plan-steps";

type PlanEvent = {
  steps?: PlanStep[];
  note?: string | null;
  active?: boolean;
};

const EMPTY: PlanStep[] = [];

export function PlanBoard() {
  const [steps, setSteps] = useState<PlanStep[]>(EMPTY);
  const [note, setNote] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const onPlan = (ev: Event) => {
      const detail = (ev as CustomEvent<PlanEvent>).detail;
      if (!detail) return;
      if (Array.isArray(detail.steps)) setSteps(detail.steps);
      if (detail.note !== undefined) setNote(detail.note ?? null);
      if (typeof detail.active === "boolean") setActive(detail.active);
    };
    window.addEventListener("brief-desk-plan", onPlan);
    return () => window.removeEventListener("brief-desk-plan", onPlan);
  }, []);

  if (!steps.length && !active) return null;

  return (
    <div className="plan-board" aria-live="polite">
      <p className="section-label" style={{ marginBottom: 8 }}>
        Live plan
      </p>
      {note ? (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>
          {note}
        </p>
      ) : null}
      <ol className="plan-steps">
        {steps.map((s) => (
          <li key={s.id} className={`plan-step plan-step-${s.state}`}>
            <span className="plan-dot" aria-hidden="true" />
            <span className="plan-label">{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
