import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RescueMesh | Emergency Communication Network",
  description: "Infrastructure-independent emergency communication using LoRa mesh networking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>{children}</body></html>;
}
