/**
 * Shift planning — the manager's side of the schedule.
 * Waiters only read their own shifts (see lib/api.js); writes happen here.
 */

/** Quick time presets offered when planning a day. */
const PRESETS = [
  { key: "p1", start: "10:00", end: "22:00" },
  { key: "p2", start: "12:00", end: "00:00" },
  { key: "p3", start: "09:00", end: "18:00" },
];

const time = require("./time");
const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function presetByKey(key) {
  return PRESETS.find((p) => p.key === key) || null;
}

/** "2026-08-30" -> "20260830" and back, so dates survive callback_data. */
function packDate(iso) {
  return iso.replace(/-/g, "");
}

function unpackDate(packed) {
  return `${packed.slice(0, 4)}-${packed.slice(4, 6)}-${packed.slice(6, 8)}`;
}

function isoToday() {
  return time.today();
}

/** The 7 dates of the week starting Monday, shifted by `offset` weeks. */
function weekDates(sdk, offset) {
  const base = time.addDays(time.today(), offset * 7);
  const monday = time.addDays(base, -((time.weekday(base) + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => time.addDays(monday, index));
}

function labelDate(sdk, iso) {
  const [, month, day] = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  return `${WEEKDAYS[time.weekday(iso)]} ${day}.${month}`;
}

function forEmployee(db, employeeId, dates) {
  if (!dates.length) return {};
  const marks = dates.map(() => "?").join(",");
  const rows = db.all(
    `SELECT date, start_time, end_time, is_day_off, note FROM shifts
      WHERE employee_id = ? AND date IN (${marks})`,
    [employeeId, ...dates]
  );
  const byDate = {};
  rows.forEach((r) => (byDate[r.date] = r));
  return byDate;
}

/** One human-readable line for a planned day. */
function describe(row) {
  if (!row) return "—";
  if (row.is_day_off) return "выходной";
  return `${row.start_time || "?"}–${row.end_time || "?"}`;
}

function setShift(db, employeeId, date, start, end) {
  const existing = db.get("SELECT id FROM shifts WHERE employee_id = ? AND date = ?", [
    employeeId,
    date,
  ]);
  if (existing) {
    db.run(
      `UPDATE shifts SET start_time = ?, end_time = ?, is_day_off = 0,
              updated_at = datetime('now') WHERE id = ?`,
      [start, end, existing.id]
    );
  } else {
    db.run(
      `INSERT INTO shifts (employee_id, date, start_time, end_time, is_day_off)
         VALUES (?, ?, ?, ?, 0)`,
      [employeeId, date, start, end]
    );
  }
}

function setDayOff(db, employeeId, date) {
  const existing = db.get("SELECT id FROM shifts WHERE employee_id = ? AND date = ?", [
    employeeId,
    date,
  ]);
  if (existing) {
    db.run(
      `UPDATE shifts SET start_time = NULL, end_time = NULL, is_day_off = 1,
              updated_at = datetime('now') WHERE id = ?`,
      [existing.id]
    );
  } else {
    db.run(
      "INSERT INTO shifts (employee_id, date, is_day_off) VALUES (?, ?, 1)",
      [employeeId, date]
    );
  }
}

function clearDay(db, employeeId, date) {
  db.run("DELETE FROM shifts WHERE employee_id = ? AND date = ?", [employeeId, date]);
}

/** Parses "10:00 22:00", "10-22", "10:00 — 22:30" into two HH:MM strings. */
function parseTimeRange(text) {
  const parts = String(text).match(/\d{1,2}(?::\d{2})?/g);
  if (!parts || parts.length < 2) return null;
  const norm = parts.slice(0, 2).map((p) => {
    const [h, m] = p.includes(":") ? p.split(":") : [p, "00"];
    const hour = Number(h);
    const min = Number(m);
    if (!(hour >= 0 && hour <= 24) || !(min >= 0 && min < 60)) return null;
    return `${String(hour % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  });
  if (norm.some((v) => v === null)) return null;
  return { start: norm[0], end: norm[1] };
}

module.exports = {
  PRESETS,
  presetByKey,
  packDate,
  unpackDate,
  isoToday,
  weekDates,
  labelDate,
  forEmployee,
  describe,
  setShift,
  setDayOff,
  clearDay,
  parseTimeRange,
};
