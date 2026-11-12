import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;

  // Production (e.g. Vercel) has no writable filesystem, so all reads/writes
  // must go to a hosted libSQL database. When TURSO_DATABASE_URL is present we
  // route the client through the libSQL driver adapter.
  if (tursoUrl) {
    const adapter = new PrismaLibSQL(
      createClient({
        url: tursoUrl,
        authToken: process.env.TURSO_AUTH_TOKEN,
      })
    );

    return new PrismaClient({ adapter, log: ["error"] });
  }

  // Local development: plain SQLite file at prisma/dev.db.
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
export default prisma;
