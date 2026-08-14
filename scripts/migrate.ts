// Explicit migration entry point for production deployments: run this
// before starting the server (see README "Production deployment").
import { runMigrations } from "../src/db/client";

runMigrations();
console.log("Migrations applied.");
