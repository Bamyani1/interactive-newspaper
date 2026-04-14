import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    environmentMatchGlobs: [
      // Component tests use jsdom
      ["tests/**", "jsdom"],
    ],
  },
  resolve: {
    alias: {
      "@/src": resolve(__dirname, "./src"),
      "@/features": resolve(__dirname, "./src/features"),
      "@/shared": resolve(__dirname, "./src/components"),
      "@/styles": resolve(__dirname, "./src/styles"),
      "@/font-color": resolve(__dirname, "./font-color"),
      "@": resolve(__dirname, "./src"),
      // `server-only` is a Next.js build-time guard that throws if imported
      // from a client component. In Vitest there is no client/server split,
      // so we stub it out to a no-op and let module logic run normally.
      "server-only": resolve(__dirname, "./tests/stubs/server-only.ts"),
    },
  },
});
