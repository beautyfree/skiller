import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const trpcPort = process.env.AGENTSKILLS_TRPC_PORT ?? "17888";
const trpcUrl = `http://127.0.0.1:${trpcPort}`;

// https://vite.dev/config/ — layout aligned with official electrobun react-tailwind-vite template (root under src/mainview).
export default defineConfig({
  root: path.resolve(__dirname, "src/mainview"),
  base: "./",
  define: {
    "import.meta.env.VITE_TRPC_URL": JSON.stringify(
      process.env.VITE_TRPC_URL ?? trpcUrl,
    ),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
