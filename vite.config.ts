import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Base path: root for Cloudflare Pages / custom domain.
// For GitHub Pages project sites, set SKYWATCH_BASE=/skywatch/ at build time.
const base = process.env.SKYWATCH_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [tailwindcss()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
