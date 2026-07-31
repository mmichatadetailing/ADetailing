import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ADetailing Pilotage", template: "%s · ADetailing" },
  description: "Pilotage opérationnel et financier d’ADetailing Orange.",
  applicationName: "ADetailing Pilotage",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#f8f7fc",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" data-scroll-behavior="smooth">
      <body>
        {children}
        <Toaster theme="light" richColors closeButton position="bottom-right" />
      </body>
    </html>
  );
}
