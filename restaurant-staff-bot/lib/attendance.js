/** Attendance business rules for employee self-service check-in and check-out. */

const time = require("./time");

function clock() {
  const timestamp = time.timestamp();
  return {
    date: timestamp.slice(0, 10),
    time: timestamp.slice(11, 16),
    timestamp,
  };
}

function timeMinutes(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function lateMinutes(start, actual) {
  const planned = timeMinutes(start);
  const arrived = timeMinutes(actual);
  if (planned === null || arrived === null) return 0;
  return Math.max(0, arrived - planned);
}

function timestampMs(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  return Number.isNaN(utc) ? null : utc;
}

/**
 * Returns actual whole minutes worked between two complete Uzbekistan timestamps.
 * The date is part of each value, so an overnight shift needs no special case.
 */
function workedMinutes(checkIn, checkOut) {
  const startedAt = timestampMs(checkIn);
  const finishedAt = timestampMs(checkOut);
  if (startedAt === null || finishedAt === null || finishedAt < startedAt) return 0;
  return Math.floor((finishedAt - startedAt) / 60000);
}

function recalculateClosedRows(db) {
  const rows = db.all(
    "SELECT id, check_in, check_out, worked_minutes FROM attendance WHERE check_in IS NOT NULL AND check_out IS NOT NULL"
  );
  let updated = 0;

  rows.forEach((attendance) => {
    const minutes = workedMinutes(attendance.check_in, attendance.check_out);
    if (Number(attendance.worked_minutes) !== minutes) {
      db.run("UPDATE attendance SET worked_minutes = ? WHERE id = ?", [minutes, attendance.id]);
      updated += 1;
    }
  });

  return updated;
}

function row(db, employeeId, date) {
  return db.get(
    "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
    [employeeId, date]
  );
}

function openRow(db, employeeId) {
  return db.get(
    `SELECT * FROM attendance
       WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL
       ORDER BY id DESC LIMIT 1`,
    [employeeId]
  );
}

function checkIn(db, sdk, employeeId) {
  const now = clock();
  const shift = db.get(
    "SELECT * FROM shifts WHERE employee_id = ? AND date = ?",
    [employeeId, now.date]
  );
  if (!shift || shift.is_day_off) return { ok: false, reason: "no_shift" };

  const open = openRow(db, employeeId);
  if (open) return { ok: false, reason: "already_checked_in" };

  const existing = row(db, employeeId, now.date);
  if (existing && existing.check_out) return { ok: false, reason: "already_checked_out" };

  const late = lateMinutes(shift.start_time, now.time);
  if (existing) {
    db.run(
      "UPDATE attendance SET check_in = ?, late_minutes = ? WHERE id = ?",
      [now.timestamp, late, existing.id]
    );
  } else {
    db.run(
      `INSERT INTO attendance (employee_id, date, check_in, late_minutes)
       VALUES (?, ?, ?, ?)`,
      [employeeId, now.date, now.timestamp, late]
    );
  }

  return { ok: true, attendance: row(db, employeeId, now.date) };
}

function checkOut(db, sdk, employeeId) {
  const now = clock();
  const existing = openRow(db, employeeId);
  if (!existing) {
    const today = row(db, employeeId, now.date);
    return {
      ok: false,
      reason: today && today.check_out ? "already_checked_out" : "no_check_in",
    };
  }

  const minutes = workedMinutes(existing.check_in, now.timestamp);
  db.run(
    "UPDATE attendance SET check_out = ?, worked_minutes = ? WHERE id = ?",
    [now.timestamp, minutes, existing.id]
  );

  return { ok: true, attendance: row(db, employeeId, existing.date) };
}

module.exports = {
  clock,
  checkIn,
  checkOut,
  lateMinutes,
  workedMinutes,
  recalculateClosedRows,
};
