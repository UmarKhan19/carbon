import "./global.css";
import "./editorial.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&family=Fira+Code:wght@400;500;600&display=swap"
        />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        {/* Light-only — the editorial design is a warm paper theme, no dark mode */}
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
