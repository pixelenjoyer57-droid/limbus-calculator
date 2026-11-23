/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps every asset path relative, so the same build works on
// GitHub Pages (https://<user>.github.io/<repo>/), on a custom domain, or
// opened from a local folder. Navigation uses the URL hash, so no server
// rewrites are needed.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: {
    format: "es",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
