import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AlamatKu — Cari Alamat Lengkapmu, Siap untuk Shopee",
  description:
    "Web untuk mengetahui alamat lengkap tempat tinggalmu secara detail dan akurat: GPS, peta, kelurahan, kecamatan, kode pos, patokan, dan format siap tempel ke Shopee.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0F766E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
