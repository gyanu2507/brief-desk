import type { Metadata } from "next";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "brief-desk",
  description: "CopilotKit + AG-UI desk for MCP-backed workspace and corpus briefings",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
