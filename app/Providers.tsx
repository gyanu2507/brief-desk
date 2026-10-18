"use client";

import { useCallback, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { ThemeProvider } from "./theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);

  const onError = useCallback((event: { error?: { message?: string }; message?: string }) => {
    const message =
      event?.error?.message ||
      event?.message ||
      (typeof event === "object" ? JSON.stringify(event).slice(0, 240) : "Unknown CopilotKit error");
    setError(message);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("brief-desk-error", { detail: message }));
    }
  }, []);

  return (
    <ThemeProvider>
      <CopilotKit
        runtimeUrl="/api/copilotkit"
        showDevConsole={process.env.NODE_ENV === "development"}
        useSingleEndpoint={true}
        onError={onError as never}
      >
        {error ? (
          <div
            role="alert"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 50,
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "10px 16px",
              background: "#7f1d1d",
              color: "#fecaca",
              fontSize: 13,
              lineHeight: 1.4,
              borderBottom: "1px solid #991b1b",
            }}
          >
            <span>
              <strong style={{ color: "#fff" }}>Agent error:</strong> {error}
            </span>
            <button
              type="button"
              onClick={() => setError(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "#fecaca",
                cursor: "pointer",
                fontSize: 13,
                textDecoration: "underline",
              }}
            >
              dismiss
            </button>
          </div>
        ) : null}
        {children}
      </CopilotKit>
    </ThemeProvider>
  );
}
