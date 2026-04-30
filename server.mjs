#!/usr/bin/env node
import { createBridgeServer } from "./lib/http-api.mjs";

const port = Number(process.env.AG_PILOT_PORT ?? process.argv[2] ?? 4319);
const host = "127.0.0.1";

const server = createBridgeServer();
server.listen(port, host, () => {
  console.log(`AG Pilot card: http://${host}:${port}/`);
});
