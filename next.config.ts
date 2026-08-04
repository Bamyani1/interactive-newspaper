import type { NextConfig } from "next";

// Next's dev server (React Refresh) needs 'unsafe-eval'; production bundles do
// not, so drop it there to shrink the XSS blast radius. next.config.ts is
// evaluated per environment at build/start, so this resolves correctly.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // LAN ranges only, for on-device mobile testing against the dev server.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js hydration + Tailwind need inline scripts/styles.
              // 'unsafe-eval' is dev-only (React Refresh); omitted in prod.
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              // R2 images + data: for inline SVGs + blob: for next/image
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              // Gemini + any external HTTPS the front-end might call
              "connect-src 'self' https:",
              // Restrict framing to same-origin (matches X-Frame-Options: SAMEORIGIN)
              "frame-ancestors 'self'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 31_536_000,
    qualities: [75, 95],
    deviceSizes: [640, 828, 1200, 1920],
    imageSizes: [256, 384, 640],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      {
        protocol: "https",
        hostname: "pub-*.r2.dev",
      },
    ],
    localPatterns: [
      {
        pathname: '/api/editions/**',
        search: '',
      },
    ],
  },
};

export default nextConfig;
