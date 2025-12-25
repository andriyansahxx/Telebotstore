import "dotenv/config";
import { startBot } from "./bot.js";

process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));
process.on("unhandledRejection", (reason) => console.error("UNHANDLED:", reason));

startBot();
