import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader for standalone scripts run through `tsx`.
 * (The Next.js dev server loads .env automatically; plain scripts do not.)
 * Variables already present in the real environment win.
 */
function loadEnv() {
    const envPath = path.join(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;

    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const eq = line.indexOf("=");
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key && process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}

loadEnv();
