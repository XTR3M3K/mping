import { pool, query } from "./db.js";
import { STATEMENTS } from "./schema.js";
import { seedSettings } from "./settings.js";

export async function migrate(): Promise<void> {
  for (const [i, stmt] of STATEMENTS.entries()) {
    try {
      await query(stmt.sql);
    } catch (err) {
      const msg = (err as Error).message.toLowerCase();
      const ignorable = (stmt.ignoreIfContains ?? []).some((s) => msg.includes(s.toLowerCase()));
      if (ignorable) continue;
      console.error(`Migration statement #${i} failed:\n${stmt.sql}\n`);
      throw err;
    }
  }
  await seedSettings();
  console.log(`✓ migrations applied (${STATEMENTS.length} statements)`);
}

// Allow running standalone: `pnpm migrate`
const isMain = process.argv[1]?.endsWith("migrate.ts") || process.argv[1]?.endsWith("migrate.js");
if (isMain) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
