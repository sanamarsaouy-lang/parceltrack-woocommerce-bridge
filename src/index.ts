import { createApp } from "./app";
import { config } from "./config";
import { ensureBootstrapStore } from "./lib/store-service";

async function main() {
  // Validate required env early
  config.databaseUrl();
  config.directUrl();
  config.metaDatabaseUrl();
  config.adminApiKey();

  await ensureBootstrapStore();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`ParcelTrack Bridge API listening on port ${config.port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start Bridge API:", error instanceof Error ? error.message : error);
  process.exit(1);
});
