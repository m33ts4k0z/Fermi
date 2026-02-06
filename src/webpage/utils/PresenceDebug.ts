/**
 * Presence debug logging when developer setting logPresenceDebug is true.
 * Logs to console with [PresenceDebug] prefix.
 */

import { getDeveloperSettings } from "./storage/devSettings.js";

export function presenceLog(...args: unknown[]): void {
	if (!getDeveloperSettings().logPresenceDebug) return;
	const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
	console.log(`[PresenceDebug] ${new Date().toISOString()} ${msg}`);
}
