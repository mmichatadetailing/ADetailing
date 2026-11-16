import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import "./globals.css";

const montserrat = localFont({ src: "../../public/brand/montserrat.woff2", variable: "--font-montserrat", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  title: { default: "ADetailing Pilotage", template: "%s · ADetailing" },
  description: "Pilotage opérationnel et financier d’ADetailing Orange.",
  applicationName: "ADetailing Pilotage",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/brand/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f2",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={montserrat.variable} data-scroll-behavior="smooth">
      <body>
        {children}
        <Toaster theme="light" richColors closeButton position="bottom-right" />
      </body>
    </html>
  );
}
