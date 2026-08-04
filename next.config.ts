import type { NextConfig } from "next";

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
          // Content-Security-Policy is set per-request in middleware.ts so
          // script-src can carry a fresh nonce (no 'unsafe-inline').
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
