import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Instrument_Serif, Outfit } from "next/font/google";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const description = "A personal player for Kanye West, with albums, artwork, and official previews.";

export const metadata: Metadata = {
  metadataBase: new URL("https://mehplayer.vercel.app"),
  title: "Meh — Kanye West",
  description,
  applicationName: "Meh",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Meh — Kanye West",
    description,
    url: "/",
    siteName: "Meh",
    type: "website",
    images: [{ url: "/portrait.jpg", width: 160, height: 213, alt: "Kanye West" }],
  },
  twitter: {
    card: "summary",
    title: "Meh — Kanye West",
    description,
  },
  appleWebApp: {
    capable: true,
    title: "Meh",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#090909",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${outfit.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ClerkProvider
          appearance={{
            variables: {
              colorBackground: "#12110f",
              colorForeground: "#f6f1e8",
              colorPrimary: "#f3f0e8",
              colorPrimaryForeground: "#12110f",
              colorInput: "#1c1b19",
              colorInputForeground: "#f6f1e8",
              colorNeutral: "#f6f1e8",
              colorMutedForeground: "#b7b1a6",
              borderRadius: "14px",
              fontFamily: "var(--font-outfit), sans-serif",
            },
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
