/**
 * electron-builder `afterSign` hook — submits the freshly-signed .app to
 * Apple's notary service, waits for the ticket, and staples it. Runs only on
 * macOS in production-signing configurations; bails out silently on win/linux
 * and in unsigned/dev builds.
 *
 * Credentials come from env (same certs/keys that worked under Electrobun,
 * just renamed to match electron-builder conventions):
 *
 *   CSC_NAME                — "Developer ID Application: Your Name (TEAMID)"
 *   APPLE_API_KEY_ID        — 10-char Key ID from App Store Connect
 *   APPLE_API_KEY_ISSUER    — Issuer UUID
 *   APPLE_API_KEY           — absolute path to the .p8 file (preferred for CI)
 *
 *   — or Apple ID fallback —
 *
 *   APPLE_ID                — developer Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — https://support.apple.com/en-us/102654
 *   APPLE_TEAM_ID           — 10-char team ID
 */
import { notarize } from "@electron/notarize";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadDotenv() {
  const envPath = join(process.cwd(), ".env");
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

export default async function afterSign(context) {
  loadDotenv();

  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  const hasApiKey =
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_KEY_ISSUER &&
    process.env.APPLE_API_KEY;
  const hasAppleId =
    process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID;

  if (!hasApiKey && !hasAppleId) {
    console.log(
      "[notarize] No Apple API key or Apple ID creds in env — skipping notarization.",
    );
    return;
  }

  console.log(`[notarize] Submitting ${appPath} to Apple notary…`);

  const opts = hasApiKey
    ? {
        appPath,
        tool: "notarytool",
        appleApiKeyId: process.env.APPLE_API_KEY_ID,
        appleApiIssuer: process.env.APPLE_API_KEY_ISSUER,
        appleApiKey: process.env.APPLE_API_KEY,
      }
    : {
        appPath,
        tool: "notarytool",
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      };

  await notarize(opts);
  console.log("[notarize] Stapled.");
}
