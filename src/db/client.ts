import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

const DATABASE_URL = process.env.DATABASE_URL ?? "./data/dev.db";

function ensureDataDir(dbPath: string) {
  if (dbPath === ":memory:") return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDataDir(DATABASE_URL);

const sqlite = new Database(DATABASE_URL);
// Wait instead of immediately erroring when another process/connection
// briefly holds a write lock (e.g. concurrent Next.js build workers, or a
// scheduler tick overlapping a request) rather than failing fast.
sqlite.pragma("busy_timeout = 10000");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export const rawSqlite = sqlite;

let migrated = false;
export function runMigrations() {
  if (migrated) return;
  migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
  applyFtsSetup(sqlite);
  migrated = true;
}

// FTS5 virtual table + triggers are managed outside Drizzle's schema (it has
// no first-class virtual-table support) but are idempotent and safe to run
// on every startup.
function applyFtsSetup(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
      title, author, content_text, feed_title,
      content='articles', content_rowid='id', tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
      INSERT INTO articles_fts(rowid, title, author, content_text, feed_title)
      VALUES (
        new.id, new.title, new.author, new.content_text,
        (SELECT title FROM feeds WHERE feeds.id = new.feed_id)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, author, content_text, feed_title)
      VALUES ('delete', old.id, old.title, old.author, old.content_text, '');
    END;

    CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE ON articles BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, author, content_text, feed_title)
      VALUES ('delete', old.id, old.title, old.author, old.content_text, '');
      INSERT INTO articles_fts(rowid, title, author, content_text, feed_title)
      VALUES (
        new.id, new.title, new.author, new.content_text,
        (SELECT title FROM feeds WHERE feeds.id = new.feed_id)
      );
    END;

    CREATE TRIGGER IF NOT EXISTS articles_fts_feed_title_au AFTER UPDATE OF title ON feeds BEGIN
      INSERT INTO articles_fts(articles_fts, rowid, title, author, content_text, feed_title)
      SELECT 'delete', id, title, author, content_text, old.title FROM articles WHERE feed_id = new.id;
      INSERT INTO articles_fts(rowid, title, author, content_text, feed_title)
      SELECT id, title, author, content_text, new.title FROM articles WHERE feed_id = new.id;
    END;
  `);
}

// Run automatically on first import (dev server, `next start`, scripts) so
// every entry point gets a ready-to-use database without an extra manual
// step. Skipped specifically during `next build`: that phase spawns several
// worker processes that all import this module against the same on-disk
// file, and racing them through migration DDL at once produces spurious
// SQLITE_BUSY errors. Production deployments should still run migrations as
// an explicit step (`npm run db:migrate`) before starting the server — see
// README — rather than relying on this implicit convenience.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  runMigrations();
}
