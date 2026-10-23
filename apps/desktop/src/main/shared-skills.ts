import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { userHomePath } from "./fsutil";

/** Canonical shared skills directory for Skiller (~/.agents/skills). */
export function sharedSkillsDir(): string {
	return join(userHomePath(), ".agents", "skills");
}

/** Root whose `.dotagents/` folder stores device-local history for shared skill updates. */
export function sharedSkillHistoryRoot(): string {
	return userHomePath();
}

/** Move legacy global update history out of the directory Codex scans for skills. */
export function migrateLegacySharedSkillHistory(home = userHomePath()): "none" | "moved" | "pending-recovery" {
	const legacyState = join(home, ".agents", "skills", ".dotagents");
	const legacyHistory = join(legacyState, "history");
	const canonicalState = join(home, ".dotagents");
	const canonicalHistory = join(canonicalState, "history");
	const legacyJournal = join(legacyState, "library-update-journal.json");

	if (!existsSync(legacyHistory)) return "none";
	// Keep old history beside the journal until recovery has consumed it.
	if (existsSync(legacyJournal)) return "pending-recovery";
	if (!lstatSync(legacyHistory).isDirectory() || lstatSync(legacyHistory).isSymbolicLink()) {
		throw new Error("Legacy shared skill history must be a real directory");
	}
	if (existsSync(canonicalState) && (!lstatSync(canonicalState).isDirectory() || lstatSync(canonicalState).isSymbolicLink())) {
		throw new Error("User-level dotagents state must be a real directory");
	}

	const entries = readdirSync(legacyHistory);
	if (entries.length === 0) {
		rmSync(legacyHistory);
		try { rmdirSync(legacyState); } catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
		}
		return "none";
	}

	mkdirSync(canonicalState, { recursive: true });
	if (existsSync(canonicalHistory)) {
		if (!lstatSync(canonicalHistory).isDirectory() || lstatSync(canonicalHistory).isSymbolicLink()) {
			throw new Error("User-level dotagents history must be a real directory");
		}
		const existing = new Set(readdirSync(canonicalHistory));
		const collisions = entries.filter(entry => existing.has(entry));
		if (collisions.length > 0) {
			throw new Error(`Cannot migrate shared skill history because records already exist: ${collisions.join(", ")}`);
		}
		for (const entry of entries) renameSync(join(legacyHistory, entry), join(canonicalHistory, entry));
		rmSync(legacyHistory);
	} else {
		renameSync(legacyHistory, canonicalHistory);
	}

	try { rmdirSync(legacyState); } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
	}
	return "moved";
}
