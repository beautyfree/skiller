import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectrobunConfig } from "electrobun";

const configDir = dirname(fileURLToPath(import.meta.url));

/** Load `.env` from project root so `electrobun build` sees signing vars without manual `export`. */
function loadProjectDotenv() {
	const envPath = join(configDir, ".env");
	if (!existsSync(envPath)) return;
	const raw = readFileSync(envPath, "utf-8");
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let val = trimmed.slice(eq + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		if (key && process.env[key] === undefined) {
			process.env[key] = val;
		}
	}
}

loadProjectDotenv();

const pkg = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { name: string; version: string; description?: string };

/** macOS signing/notarization: set env vars in `.env`, then `bun run build && bunx electrobun build --env=stable`. See docs/DEVELOPMENT.md */
function macReleaseSigning(): { codesign: boolean; notarize: boolean } {
	const hasDeveloperId = Boolean(process.env.ELECTROBUN_DEVELOPER_ID?.trim());
	const hasNotarizeAppleId =
		Boolean(process.env.ELECTROBUN_APPLEID?.trim()) &&
		Boolean(process.env.ELECTROBUN_APPLEIDPASS?.trim()) &&
		Boolean(process.env.ELECTROBUN_TEAMID?.trim());
	const hasNotarizeApiKey =
		Boolean(process.env.ELECTROBUN_APPLEAPIISSUER?.trim()) &&
		Boolean(process.env.ELECTROBUN_APPLEAPIKEY?.trim()) &&
		Boolean(process.env.ELECTROBUN_APPLEAPIKEYPATH?.trim());
	return {
		codesign: hasDeveloperId,
		notarize: hasDeveloperId && (hasNotarizeAppleId || hasNotarizeApiKey),
	};
}

const macSign = macReleaseSigning();

const config: ElectrobunConfig = {
	app: {
		name: "Skiller",
		identifier: "com.beautyfree.skiller",
		version: pkg.version,
		description: pkg.description,
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	// Auto-updates — Electrobun's built-in Updater fetches
	//   <baseUrl>/{stable-macos-arm64,stable-win-x64,stable-linux-x64}-update.json
	// and compares the bundled hash (version.json) to the remote hash. GitHub's
	// /releases/latest/download redirect serves assets from the most recent
	// published release (see README — the CI workflow publishes them via release.yml).
	release: {
		baseUrl:
			process.env.ELECTROBUN_UPDATE_BASE_URL ||
			"https://github.com/beautyfree/skiller-skills-desktop-manager/releases/latest/download",
	},
	build: {
		bun: {
			entrypoint: "src/bun/index.ts",
		},
		// Vite output → views/mainview (views://mainview/index.html). Explicit paths like official react-tailwind-vite template.
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			agents: "../agents",
			// Native NSVisualEffectView bridge is only meaningful on macOS (built by scripts/build-macos-effects.sh).
			// On Linux/Windows the file is a placeholder — bundling it is a no-op and the code guards on process.platform.
			...(process.platform === "darwin"
				? { "src/bun/libMacWindowEffects.dylib": "bun/libMacWindowEffects.dylib" }
				: {}),
		},
		// Ignore Vite output in watch — HMR rebuilds the view separately when using dev:hmr.
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: false,
			icons: "assets/icons/AppIcon.iconset",
			// We repack the DMG ourselves via scripts/repack-dmg.sh so it has a
			// proper drag-to-Applications layout. Electrobun's built-in DMG is
			// unstyled (tiny icons, no background) — disable it to skip the
			// double notarize.
			createDmg: false,
			...macSign,
		},
		linux: {
			bundleCEF: false,
			icon: "assets/icons/app/icon-512.png",
		},
		win: {
			bundleCEF: false,
			icon: "assets/icons/app.ico",
		},
	},
};

export default config;
