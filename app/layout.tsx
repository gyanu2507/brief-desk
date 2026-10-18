import type { Metadata } from "next";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "brief-desk",
  description: "One-repo CopilotKit + AG-UI briefing desk with MCP tools",
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
