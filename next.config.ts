import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    qualities: [75, 95],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
    ],
    localPatterns: [
      {
        pathname: '/api/golden-image/**',
        search: '',
      },
      {
        pathname: '/api/editions/**',
        search: '',
      },
    ],
  },
};

export default nextConfig;
