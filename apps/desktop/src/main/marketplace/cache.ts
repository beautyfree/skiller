import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { MarketplaceSkill } from "../marketplace-types";

/**
 * Marketplace HTTP cache. Moved from `bun:sqlite` to `better-sqlite3` so the
 * module runs under both Bun (legacy Electrobun build) and Node (Electron
 * main process). API surface (`readCache`, `writeCache`, etc.) is unchanged.
 *
 * `better-sqlite3` is a native addon; electron-builder rebuilds it against the
 * Electron ABI on packaging via `@electron/rebuild`, and the `.node` file is
 * `asarUnpack`-ed — see Phase 5 notes in docs/DEVELOPMENT.md.
 */

function appCacheDir(): string {
	const h = homedir();
	if (process.platform === "darwin") {
		return join(h, "Library", "Caches", "skiller");
	}
	if (process.platform === "win32") {
		return join(h, "AppData", "Local", "skiller");
	}
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return join(xdg, "skiller");
	return join(h, ".cache", "skiller");
}

export function marketplaceCacheDbPath(): string {
	const base = appCacheDir();
	if (!existsSync(base)) mkdirSync(base, { recursive: true });
	return join(base, "marketplace.db");
}

function nowEpoch(): number {
	return Math.floor(Date.now() / 1000);
}

type DbInstance = Database.Database;

function openCache(): DbInstance {
	const db = new Database(marketplaceCacheDbPath());
	db.exec(`
    CREATE TABLE IF NOT EXISTS marketplace_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
	return db;
}

function openCacheSafe(): DbInstance | null {
	try {
		return openCache();
	} catch (err) {
		console.warn("[marketplace-cache] open failed:", err);
		return null;
	}
}

export function readCache(key: string): MarketplaceSkill[] | null {
	try {
		const db = openCacheSafe();
		if (!db) return null;
		const row = db
			.prepare(
				"SELECT payload, expires_at FROM marketplace_cache WHERE cache_key = ?",
			)
			.get(key) as { payload: string; expires_at: number } | undefined;
		if (!row) return null;
		if (row.expires_at < nowEpoch()) return null;
		try {
			return JSON.parse(row.payload) as MarketplaceSkill[];
		} catch {
			return null;
		}
	} catch (err) {
		console.warn("[marketplace-cache] read failed:", err);
		return null;
	}
}

export function readCacheStale(key: string): MarketplaceSkill[] | null {
	try {
		const db = openCacheSafe();
		if (!db) return null;
		const row = db
			.prepare("SELECT payload FROM marketplace_cache WHERE cache_key = ?")
			.get(key) as { payload: string } | undefined;
		if (!row) return null;
		try {
			const parsed = JSON.parse(row.payload) as MarketplaceSkill[];
			if (!parsed.length) return null;
			return parsed;
		} catch {
			return null;
		}
	} catch (err) {
		console.warn("[marketplace-cache] read stale failed:", err);
		return null;
	}
}

export function writeCache(
	key: string,
	skills: MarketplaceSkill[],
	ttlSeconds: number,
): void {
	try {
		const db = openCacheSafe();
		if (!db) return;
		const payload = JSON.stringify(skills);
		const expires = nowEpoch() + ttlSeconds;
		db.prepare(
			`INSERT INTO marketplace_cache(cache_key, payload, expires_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       payload = excluded.payload,
       expires_at = excluded.expires_at`,
		).run(key, payload, expires);
	} catch (err) {
		console.warn("[marketplace-cache] write failed:", err);
	}
}

export function clearMarketplaceCacheDb(): void {
	try {
		const db = openCacheSafe();
		if (!db) return;
		db.exec("DELETE FROM marketplace_cache");
	} catch (err) {
		console.warn("[marketplace-cache] clear failed:", err);
	}
}
