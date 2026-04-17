import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * electron-vite config.
 *
 * Coexists with vite.config.ts during the migration — vite.config.ts is still
 * used by the old `bun run dev:hmr` / `bun run build` flow for Electrobun
 * until Phase 2 cuts that over. Once Electrobun is deleted (end of Phase 5)
 * we drop vite.config.ts and point everything here.
 *
 * Renderer root reuses the existing src/mainview layout so no React code moves.
 */
const trpcPort = process.env.AGENTSKILLS_TRPC_PORT ?? "17888";
const trpcUrl = `http://127.0.0.1:${trpcPort}`;

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "out/main",
			lib: {
				entry: resolve(__dirname, "src/electron-main/index.ts"),
			},
		},
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			outDir: "out/preload",
			lib: {
				entry: resolve(__dirname, "src/preload/index.ts"),
			},
		},
	},
	renderer: {
		root: resolve(__dirname, "src/mainview"),
		define: {
			"import.meta.env.VITE_TRPC_URL": JSON.stringify(
				process.env.VITE_TRPC_URL ?? trpcUrl,
			),
		},
		plugins: [react(), tailwindcss()],
		resolve: {
			alias: {
				"@": resolve(__dirname, "src"),
			},
		},
		clearScreen: false,
		server: {
			host: "127.0.0.1",
			// Same port as old vite.config.ts so anyone with it bookmarked keeps working.
			port: 5180,
			strictPort: true,
		},
		build: {
			outDir: resolve(__dirname, "out/renderer"),
			emptyOutDir: true,
			rollupOptions: {
				// Explicit because renderer root is src/mainview, not the
				// electron-vite default src/renderer.
				input: resolve(__dirname, "src/mainview/index.html"),
			},
		},
	},
});
