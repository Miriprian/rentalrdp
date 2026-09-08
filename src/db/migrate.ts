import { initDb, closeDb } from "./index";
import { runSeed } from "./seed";

const mode = process.argv[2] ?? "migrate";

if (import.meta.main) {
  if (mode === "seed") {
    await runSeed();
  } else {
    await initDb();
    console.log("[MIGRATE] schema OK");
    if (process.argv.includes("--seed")) await runSeed();
  }
  await closeDb();
  process.exit(0);
}
