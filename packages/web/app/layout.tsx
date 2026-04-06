import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Quiz",
  description: "Party music quiz game with DJ Mode",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: "/apple-touch-icon.png",
  },
  other: [
    { rel: "icon", type: "image/svg+xml", href: "/favicon.svg", media: "(prefers-color-scheme: dark)" },
    { rel: "icon", type: "image/svg+xml", href: "/favicon-light.svg", media: "(prefers-color-scheme: light)" },
  ] as any,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="da">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-background text-foreground font-sans min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
