import { defineConfig } from "@playwright/test";

/**
 * Config for the automated video demo (scripts/demo-video.ts).
 *
 * Records a real browser session against a running app and annotates every
 * action with an outline + title subtitle, so the output needs no editing.
 *
 *   npm run demo:record                    # http://localhost:3000
 *   set DEMO_URL=https://your-app.vercel.app && npm run demo:record
 *
 * Output: demo/raw/<test title>/video.webm
 */
const baseURL = process.env.DEMO_URL ?? "http://localhost:3000";
const size = { width: 1280, height: 800 };

export default defineConfig({
    testDir: "scripts",
    testMatch: "demo-video.ts",
    outputDir: "demo/raw",
    timeout: 240_000,
    workers: 1,
    fullyParallel: false,
    reporter: [["list"]],
    use: {
        baseURL,
        viewport: size,    // `show.actions` draws the click outline and an action-title subtitle.
        video: { mode: "on", size, show: { actions: { duration: 900 } } },
        trace: "off",
    },
});
