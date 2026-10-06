/**
 * SQLite adapter: gives the app the small { run, get, all, transaction } API.
 * Uses better-sqlite3; falls back to the built-in node:sqlite (Node 22+).
 */

const fs = require("fs");
const path = require("path");

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let raw;
  let kind;
  try {
    const Database = require("better-sqlite3");
    raw = new Database(file);
    kind = "better";
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    const { DatabaseSync } = require("node:sqlite");
    raw = new DatabaseSync(file);
    kind = "node";
  }
  try { raw.exec("PRAGMA journal_mode = WAL"); } catch (e) { /* ignore */ }
  try { raw.exec("PRAGMA busy_timeout = 5000"); } catch (e) { /* ignore */ }

  let depth = 0;
  const api = {
    kind,
    run(sql, params = []) { return raw.prepare(sql).run(...params); },
    get(sql, params = []) { return raw.prepare(sql).get(...params); },
    all(sql, params = []) { return raw.prepare(sql).all(...params); },
    transaction(fn) {
      if (depth > 0) return fn();
      depth += 1;
      raw.exec("BEGIN");
      try {
        const result = fn();
        raw.exec("COMMIT");
        return result;
      } catch (error) {
        try { raw.exec("ROLLBACK"); } catch (e) { /* ignore */ }
        throw error;
      } finally {
        depth -= 1;
      }
    },
    close() { raw.close(); },
  };
  return api;
}

module.exports = { open };
