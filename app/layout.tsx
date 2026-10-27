import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "環境觀測資料平台 | Environmental Observation Data Hub",
  description: "整合環境感測資料、設備追蹤與校正管理。Environmental sensor data, device tracking, and calibration management.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">
        <Script id="translation-dom-compat" strategy="beforeInteractive" dangerouslySetInnerHTML={{
          __html: `
            if (typeof Node === 'function' && Node.prototype) {
              const originalRemoveChild = Node.prototype.removeChild;
              Node.prototype.removeChild = function(child) {
                if (child.parentNode !== this) {
                  return child;
                }
                return originalRemoveChild.apply(this, arguments);
              };
              const originalInsertBefore = Node.prototype.insertBefore;
              Node.prototype.insertBefore = function(newNode, referenceNode) {
                if (referenceNode && referenceNode.parentNode !== this) {
                  return newNode;
                }
                return originalInsertBefore.apply(this, arguments);
              };
            }
          `
        }} />
        {children}
      </body>
    </html>
  );
}
