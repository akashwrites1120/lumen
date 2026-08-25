import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { ThemeProvider, themeScript } from "@/components/theme-context";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lumen — Accessible content, validated by humans",
    template: "%s · Lumen",
  },
  description:
    "AI-powered accessibility platform: alt-text generation, image extraction, and multi-format conversion to EPUB, Excel, JSON and MOBI — human-validated for WCAG, ADA, EPUB Accessibility and PDF/UA.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans`}>
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
