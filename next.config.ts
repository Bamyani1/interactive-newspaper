import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
              // Next.js hydration + Tailwind need inline scripts/styles
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              // R2 images + data: for inline SVGs + blob: for next/image
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              // Gemini + any external HTTPS the front-end might call
              "connect-src 'self' https:",
              // Block frame embedding (equivalent to X-Frame-Options: DENY)
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
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
