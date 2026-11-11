import { startServer } from "./server.js";

const server = await startServer();
console.log(`Competitor tracker listening at ${server.url}`);
