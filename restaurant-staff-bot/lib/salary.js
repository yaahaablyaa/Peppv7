/**
 * Salary maths.
 * Rate: per hour (employees.hourly_rate, default 20 000 сум).
 * Two pay periods per month:
 *   1st–15th          → paid on the 25th of the same month
 *   16th–end of month → paid on the 10th of the next month
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

function lastDay(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function nextMonth(y, m) {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

function prevMonth(y, m) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
}

/** Builds one of the two halves of a given month. half = 1 | 2 */
function period(y, m, half) {
  if (half === 1) {
    return {
      start: iso(y, m, 1),
      end: iso(y, m, 15),
      payout: iso(y, m, 25),
      half: 1,
    };
  }
  const n = nextMonth(y, m);
  return {
    start: iso(y, m, 16),
    end: iso(y, m, lastDay(y, m)),
    payout: iso(n.y, n.m, 10),
    half: 2,
  };
}

/** The pay period that contains `date`. */
function dateParts(date) {
  const value = String(date || require("./time").today());
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Expected a YYYY-MM-DD date");
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function currentPeriod(date) {
  const value = dateParts(date);
  return period(value.y, value.m, value.d <= 15 ? 1 : 2);
}

/** The period right before the one containing `date`. */
function previousPeriod(date) {
  const value = dateParts(date);
  const y = value.y;
  const m = value.m;
  if (value.d <= 15) {
    const p = prevMonth(y, m);
    return period(p.y, p.m, 2);
  }
  return period(y, m, 1);
}

/** Sums worked minutes from attendance rows inside [start, end]. */
function earnings(db, employeeId, start, end, rate) {
  const rows = db.all(
    `SELECT date, check_in, check_out, worked_minutes, late_minutes
       FROM attendance
      WHERE employee_id = ? AND date >= ? AND date <= ?
      ORDER BY date DESC`,
    [employeeId, start, end]
  );
  const minutes = rows.reduce((sum, r) => sum + (r.worked_minutes || 0), 0);
  const hours = minutes / 60;
  return {
    start,
    end,
    minutes,
    hours: Math.round(hours * 100) / 100,
    amount: Math.round(hours * rate),
    shifts: rows,
  };
}

/** Both pay periods of a month plus the whole-month range. */
function monthPeriods(month) {
  const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) return null;
  const p1 = period(y, m, 1);
  const p2 = period(y, m, 2);
  return {
    month: `${y}-${pad(m)}`,
    p1,
    p2,
    full: { start: p1.start, end: p2.end, payout: null, half: 0 },
  };
}

/** Resolves view ("p1" | "p2" | "full") of a month into a concrete date range. */
function viewRange(month, view) {
  const periods = monthPeriods(month);
  if (!periods) return null;
  if (view === "p1") return { ...periods.p1, view };
  if (view === "p2") return { ...periods.p2, view };
  if (view === "full") return { ...periods.full, view };
  return null;
}

function formatMoney(n) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n || 0)) + " сум";
}

module.exports = {
  currentPeriod,
  previousPeriod,
  earnings,
  monthPeriods,
  viewRange,
  formatMoney,
  lastDay,
};
