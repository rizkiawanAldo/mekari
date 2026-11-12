import "./load-env";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

/**
 * Applies the SQL files under prisma/migrations to the hosted libSQL (Turso) database.
 * Idempotent: skips DDL for tables that already exist.
 */
async function main() {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url) {
        throw new Error(
            "TURSO_DATABASE_URL is not set. Add it to .env (or the Vercel project settings)."
        );
    }

    console.log(`Target database: ${url.replace(/\/\/([^.]+)/, "//***")}`);
    const client = createClient({ url, authToken });

    const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
    const sqlPath = fs
        .readdirSync(migrationsDir)
        .filter((d) => d !== "migration_lock.toml")
        .sort()
        .map((d) => path.join(migrationsDir, d, "migration.sql"))
        .pop();

    if (!sqlPath || !fs.existsSync(sqlPath)) {
        throw new Error("No migration.sql found under prisma/migrations.");
    }
    console.log(`Using migration: ${path.relative(process.cwd(), sqlPath)}`);

    const sql = fs.readFileSync(sqlPath, "utf8");
    const statements = sql
        .split(";")
        .map((s) => s.replace(/--.*$/gm, "").trim())
        .filter(Boolean);

    const existing = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    );
    const existingTables = new Set(existing.rows.map((r) => String(r.name)));

    for (const statement of statements) {
        const created = statement.match(/^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+"?([A-Za-z_]+)"?/i);
        const target = created?.[1];
        if (target && existingTables.has(target) && /^CREATE\s+TABLE/i.test(statement)) {
            console.log(`- skip: table "${target}" already exists`);
            continue;
        }
        await client.execute(statement);
        console.log(`- ok: ${statement.split("\n")[0].slice(0, 70)}`);
    }

    const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    console.log(
        "Tables now present:",
        tables.rows.map((r) => String(r.name)).join(", ") || "(none)"
    );

    client.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
