/**
 * Staff directory — creating employees, positions and roles.
 * Only managers may call these (checked in the handler layer).
 */

const employees = require("./employees");

const roles = require("./roles");

/** Preset positions offered to the manager, keyed by callback suffix. */
const POSITIONS = [
  { key: "waiter", title: "Официант", role: "waiter" },
  { key: "barista", title: "Бариста", role: "waiter" },
  { key: "hostess", title: "Хостес", role: "waiter" },
  { key: "cashier", title: "Кассир", role: "waiter" },
  { key: "cook", title: "Повар", role: "waiter" },
  { key: "tech", title: "Тех персонал", role: "waiter" },
  { key: "chef", title: "Шеф-повар", role: "chef" },
  { key: "barmanager", title: "Бар-менеджер", role: "bar_manager" },
  { key: "finance", title: "Финансовый директор", role: "finance" },
  { key: "manager", title: "Менеджер", role: "manager" },
];

const DEFAULT_RATE = 20000;

function positionByKey(key) {
  return POSITIONS.find((p) => p.key === key) || null;
}

/** Role is derived from the position title (no "администратор" role: only manager). */
function roleForPosition(title) {
  return roles.roleForPosition(title);
}

function generatePassword(sdk) {
  const n = sdk.crypto.randomBytes(2).readUInt16BE(0) % 9000;
  return String(1000 + n);
}

function list(db, branchId) {
  if (branchId !== undefined) {
    return db.all(
      `SELECT id, full_name, phone, position, role, hourly_rate, telegram_id, active, branch_id, notifications_on
         FROM employees WHERE active = 1 AND branch_id = ? ORDER BY role DESC, full_name ASC`,
      [branchId]
    );
  }
  return db.all(
    `SELECT id, full_name, phone, position, role, hourly_rate, telegram_id, active, branch_id, notifications_on
       FROM employees WHERE active = 1 ORDER BY role DESC, full_name ASC`
  );
}

function byId(db, id, branchId) {
  if (branchId !== undefined) {
    return db.get("SELECT * FROM employees WHERE id = ? AND branch_id = ?", [id, branchId]);
  }
  return db.get("SELECT * FROM employees WHERE id = ?", [id]);
}

/**
 * Creates an employee and returns the generated login password once.
 * The password itself is never stored — only its sha256 hash.
 */
function validRate(rate) {
  return typeof rate === "number" && Number.isSafeInteger(rate) && rate > 0 && rate <= 2147483647;
}

function create(sdk, db, draft) {
  if (!validRate(draft.rate)) return { ok: false, reason: "bad_pay" };
  const phone = employees.normalizePhone(draft.phone);
  if (!phone) return { ok: false, reason: "bad_phone" };

  const existing = employees.byPhone(db, phone);
  if (existing) return { ok: false, reason: "duplicate", employee: existing };

  const password = draft.password || generatePassword(sdk);
  const role = draft.role || roleForPosition(draft.position);
  const rate = draft.rate;

  db.run(
    `INSERT INTO employees (full_name, phone, password_hash, role, hourly_rate, position, active, branch_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [draft.full_name, phone, employees.sha256(sdk, password), role, rate, draft.position, draft.branch_id || 1]
  );

  const employee = employees.byPhone(db, phone);
  return { ok: true, employee, password };
}

function setPosition(db, id, position, role) {
  db.run("UPDATE employees SET position = ?, role = ? WHERE id = ? AND role != 'owner'", [position, role, id]);
}

function update(sdk, db, id, draft) {
  const employee = byId(db, id);
  if (!employee) return { ok: false, reason: "not_found" };

  const phone = employees.normalizePhone(draft.phone);
  if (!phone) return { ok: false, reason: "bad_phone" };
  const duplicate = db.get("SELECT id FROM employees WHERE phone = ? AND id != ?", [phone, id]);
  if (duplicate) return { ok: false, reason: "duplicate" };

  const position = String(draft.position || "").trim();
  const rate = draft.rate;
  if (draft.full_name.length < 2 || draft.full_name.length > 100) return { ok: false, reason: "bad_name" };
  if (!position || position.length > 60) return { ok: false, reason: "bad_data" };
  if (!validRate(rate)) return { ok: false, reason: "bad_pay" };

  const role = roleForPosition(position);
  const active = draft.active ? 1 : 0;
  const password = String(draft.password || "");
  if (password && (password.length < 4 || password.length > 64)) return { ok: false, reason: "bad_password" };

  if (password) {
    db.run(
      "UPDATE employees SET full_name = ?, phone = ?, position = ?, role = ?, hourly_rate = ?, active = ?, branch_id = ?, password_hash = ? WHERE id = ?",
      [draft.full_name, phone, position, role, Math.round(rate), active, draft.branch_id || employee.branch_id || 1, employees.sha256(sdk, password), id]
    );
  } else {
    db.run(
      "UPDATE employees SET full_name = ?, phone = ?, position = ?, role = ?, hourly_rate = ?, active = ?, branch_id = ? WHERE id = ?",
      [draft.full_name, phone, position, role, Math.round(rate), active, draft.branch_id || employee.branch_id || 1, id]
    );
  }

  return { ok: true, employee: byId(db, id) };
}

function saveQrCode(db, employeeId, image) {
  db.run(
    `INSERT INTO qr_codes (employee_id, file_id, code, uploaded_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id) DO UPDATE SET file_id = excluded.file_id, code = excluded.code, uploaded_at = excluded.uploaded_at`,
    [employeeId, "uploaded", image]
  );
}

function deactivate(db, id) {
  db.run("UPDATE employees SET active = 0, telegram_id = NULL WHERE id = ?", [id]);
}

module.exports = {
  POSITIONS,
  DEFAULT_RATE,
  validRate,
  positionByKey,
  roleForPosition,
  generatePassword,
  list,
  byId,
  create,
  setPosition,
  update,
  saveQrCode,
  deactivate,
};
