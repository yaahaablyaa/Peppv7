/**
 * Employee lookup, linking and role checks (RBAC core).
 */

function sha256(sdk, s) {
  return sdk.crypto.createHash("sha256").update(String(s)).digest("hex");
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits ? "+" + digits : "";
}

function byTelegramId(db, telegramId) {
  return db.get(
    "SELECT * FROM employees WHERE telegram_id = ? AND active = 1",
    [telegramId]
  );
}

function byPhone(db, phone) {
  return db.get("SELECT * FROM employees WHERE phone = ?", [normalizePhone(phone)]);
}

/** Links a Telegram account to an employee row after phone+password check. */
function login(sdk, db, telegramId, username, phone, password) {
  const emp = byPhone(db, phone);
  if (!emp) return { ok: false, reason: "not_found" };
  if (emp.role === "owner" && telegramId !== require("./schema").OWNER_TELEGRAM_ID) {
    return { ok: false, reason: "not_found" };
  }
  if (!emp.active) return { ok: false, reason: "inactive" };
  if (!emp.password_hash || emp.password_hash !== sha256(sdk, password)) {
    return { ok: false, reason: "bad_password" };
  }
  db.run("UPDATE employees SET telegram_id = ?, username = ? WHERE id = ?", [
    telegramId,
    username || "",
    emp.id,
  ]);
  return { ok: true, employee: { ...emp, telegram_id: telegramId } };
}

function isManager(emp) {
  return !!emp && (emp.role === "manager" || emp.role === "owner");
}

function managers(db) {
  return db.all("SELECT * FROM employees WHERE role IN ('manager', 'owner') AND active = 1");
}

/** Queues an in-app notification and returns the row id. */
function notify(db, employeeId, title, body) {
  db.run(
    "INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)",
    [employeeId, title, body || ""]
  );
}

module.exports = {
  sha256,
  normalizePhone,
  byTelegramId,
  byPhone,
  login,
  isManager,
  managers,
  notify,
};
