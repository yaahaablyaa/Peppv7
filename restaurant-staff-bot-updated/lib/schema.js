/**
 * Database schema + initial seed (manager account).
 */

const OWNER_TELEGRAM_ID = 665671753;
const OWNER_PHONE = "+998904760501";
// sha256 of the owner-chosen manager password (plaintext is never stored)
const OWNER_PASSWORD_HASH =
  "8d00d22e8e7e789c7c3d74ab997dfd934f4f6b7d8bbdf1c596f1173073296b7f";

const HOURLY_RATE = 20000;

function addColumn(db, table, column, definition) {
  if (!db.all(`PRAGMA table_info(${table})`).some((field) => field.name === column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateBranches(db) {
  db.transaction(() => {
    db.run(`CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      code TEXT,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      telegram_chat_id TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
      currency TEXT NOT NULL DEFAULT 'UZS',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(organization_id, code)
    )`);
    db.run("INSERT OR IGNORE INTO organizations (id, name) VALUES (1, 'Ресторан')");
    db.run("INSERT OR IGNORE INTO branches (id, organization_id, name, code) VALUES (1, 1, 'Основной филиал', 'MAIN')");

    // Legacy records all belong to the same original restaurant. Dependent rows
    // inherit the branch through employee_id or checklist_id; no copied tenant ids.
    addColumn(db, "employees", "organization_id", "INTEGER NOT NULL DEFAULT 1");
    addColumn(db, "employees", "branch_id", "INTEGER NOT NULL DEFAULT 1");
    for (const table of ["posts", "trainings", "checklists"]) {
      addColumn(db, table, "branch_id", "INTEGER NOT NULL DEFAULT 1");
    }
    addColumn(db, "posts", "audience_branches", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "posts", "audience_positions", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "posts", "audience_employees", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "trainings", "audience_branches", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "trainings", "audience_positions", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, "trainings", "audience_employees", "TEXT NOT NULL DEFAULT '[]'");
    db.run("CREATE INDEX IF NOT EXISTS idx_branches_organization_active ON branches (organization_id, is_active)");
    db.run("CREATE INDEX IF NOT EXISTS idx_employees_branch_active ON employees (branch_id, active, role)");
    db.run("CREATE INDEX IF NOT EXISTS idx_posts_branch_kind ON posts (branch_id, kind, id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_trainings_branch ON trainings (branch_id, id)");
    db.run("CREATE INDEX IF NOT EXISTS idx_checklists_branch ON checklists (branch_id, id)");
  });
}

function init(db, log) {
  db.run(`CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE,
    username TEXT,
    full_name TEXT NOT NULL,
    phone TEXT UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'waiter',
    hourly_rate INTEGER NOT NULL DEFAULT ${HOURLY_RATE},
    position TEXT DEFAULT '',
    theme TEXT DEFAULT 'auto',
    notifications_on INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    is_day_off INTEGER NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_id, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    worked_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    late_reason TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(employee_id, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS qr_codes (
    employee_id INTEGER PRIMARY KEY,
    file_id TEXT NOT NULL,
    code TEXT,
    uploaded_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'news',
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS trainings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS checklists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS checklist_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checklist_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    done TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(checklist_id, employee_id, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'other',
    body TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT 'application/octet-stream',
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_menu_files_branch ON menu_files (branch_id, id)");

  migrateBranches(db);

  // Training progress, per-item checklist log and checklist audience.
  db.run(`CREATE TABLE IF NOT EXISTS training_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    training_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    completed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(training_id, employee_id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_training_progress_employee ON training_progress (employee_id)");
  addColumn(db, "checklist_runs", "log", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, "checklists", "positions", "TEXT NOT NULL DEFAULT '[]'");
  db.run("CREATE INDEX IF NOT EXISTS idx_checklist_runs_date ON checklist_runs (date, checklist_id)");

  const correctedAttendance = require("./attendance").recalculateClosedRows(db);
  if (correctedAttendance) log.info(`Recalculated worked minutes for ${correctedAttendance} attendance records`);

  // Inventory: items, movements journal, counts (инвентаризация) with per-item lines.
  db.run(`CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL DEFAULT 1,
    department TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'шт',
    qty REAL NOT NULL DEFAULT 0,
    min_qty REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory_moves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL,
    qty REAL NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    employee_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL DEFAULT 1,
    department TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    started_by INTEGER,
    started_at TEXT DEFAULT (datetime('now')),
    finished_by INTEGER,
    finished_at TEXT,
    shortage REAL NOT NULL DEFAULT 0,
    surplus REAL NOT NULL DEFAULT 0,
    diff_items INTEGER NOT NULL DEFAULT 0,
    counted_items INTEGER NOT NULL DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory_count_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,
    expected REAL NOT NULL DEFAULT 0,
    actual REAL,
    unit_cost REAL NOT NULL DEFAULT 0
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_inventory_items_branch ON inventory_items (branch_id, department)");
  db.run("CREATE INDEX IF NOT EXISTS idx_inventory_moves_item ON inventory_moves (item_id, id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_inventory_lines_count ON inventory_count_lines (count_id)");

  // There is no "Администратор" any more: only "Менеджер".
  db.run("UPDATE employees SET position = 'Менеджер' WHERE position = 'Администратор'");
  db.run("UPDATE employees SET role = 'manager' WHERE role = 'admin'");
  // Only "Бариста" exists (no separate "Бармен").
  db.run("UPDATE employees SET position = 'Бариста' WHERE position = 'Бармен'");
  // Inventory department "Зал" became "Посуда".
  db.run("UPDATE inventory_items SET department = 'Посуда' WHERE department = 'Зал'");
  db.run("UPDATE inventory_counts SET department = 'Посуда' WHERE department = 'Зал'");

  seedManager(db, log);
  // Promote only the pre-existing account already linked to the approved Telegram identity.
  db.run("UPDATE employees SET role = 'owner', position = 'Владелец' WHERE phone = ? AND telegram_id = ? AND role = 'manager'", [OWNER_PHONE, OWNER_TELEGRAM_ID]);
}

function seedManager(db, log) {
  const existing = db.get("SELECT id FROM employees WHERE phone = ?", [OWNER_PHONE]);
  if (existing) return;

  db.run(
    `INSERT INTO employees (telegram_id, full_name, phone, password_hash, role, position)
     VALUES (?, ?, ?, ?, 'manager', 'Менеджер')`,
    [OWNER_TELEGRAM_ID, "Менеджер", OWNER_PHONE, OWNER_PASSWORD_HASH]
  );
  log.info("Seeded manager account");
}

module.exports = { init, HOURLY_RATE, OWNER_TELEGRAM_ID, OWNER_PHONE };
