import type { Metadata } from "next";
import "@copilotkit/react-ui/styles.css";
import "./globals.css";
import { Providers } from "./Providers";

export const metadata: Metadata = {
  title: "brief-desk",
  description: "Python MCP + CopilotKit + AG-UI engineering briefing desk",
  applicationName: "brief-desk",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
  },
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
