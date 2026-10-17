import type { Metadata } from "next";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "brief-desk",
  description: "CopilotKit + AG-UI desk for MCP-backed workspace and corpus briefings",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit
          runtimeUrl="/api/copilotkit"
          showDevConsole={process.env.NODE_ENV === "development"}
          useSingleEndpoint={true}
        >
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
