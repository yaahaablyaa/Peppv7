/**
 * Manager analytics.
 * Works on the two pay periods of a month (1–15, 16–end) and on the whole month.
 * Money figures are visible to the owner only.
 */
const time = require("./time");
const salary = require("./salary");
const roles = require("./roles");

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Legacy rolling windows, kept for compatibility. */
function legacyRange(query, today) {
  const period = String(query.period || "7d");
  const now = new Date(`${today}T00:00:00Z`);
  let start;
  let end = today;
  if (period === "today") start = today;
  else if (period === "yesterday") start = end = time.addDays(today, -1);
  else if (period === "7d" || period === "30d") start = time.addDays(today, period === "7d" ? -6 : -29);
  else if (period === "month") start = today.slice(0, 7) + "-01";
  else if (period === "prev_month") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    end = time.addDays(today.slice(0, 7) + "-01", -1);
  } else if (period === "custom") {
    start = String(query.start || "");
    end = String(query.end || "");
  } else return null;
  if (!validDate(start) || !validDate(end) || end < start || end > today ||
      (Date.parse(end) - Date.parse(start)) / 86400000 > 365) return null;
  return { period, start, end };
}

function prevMonthOf(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** The range right before the selected one, for comparison. */
function previousRange(month, view) {
  if (view === "p2") return { month, view: "p1" };
  if (view === "p1") return { month: prevMonthOf(month), view: "p2" };
  return { month: prevMonthOf(month), view: "full" };
}

const round2 = (n) => Math.round(n * 100) / 100;

function collect(db, branchIds, range, today, filters, showMoney) {
  const team = db.all(
    `SELECT id, full_name AS name, position, hourly_rate, branch_id FROM employees WHERE role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager') AND branch_id IN (${branchIds.map(() => "?").join(",")}) AND active = 1 ORDER BY full_name, id`,
    branchIds
  );
  const selected = team.filter((e) =>
    (filters.employeeId === null || e.id === filters.employeeId) && (!filters.position || e.position === filters.position));
  const byId = new Map(selected.map((e) => [e.id, e]));

  const days = new Map();
  for (let date = range.start; date <= range.end; date = time.addDays(date, 1)) {
    days.set(date, { date, scheduled: 0, attended: 0, late: 0, missing: 0, minutes: 0, cost: 0, future: date > today });
  }
  const stats = new Map(selected.map((e) => [e.id, {
    id: e.id, name: e.name, position: e.position || "", scheduled: 0, attended: 0, late: 0, lateMinutes: 0, missing: 0, minutes: 0, cost: 0,
  }]));

  const planned = new Set();
  db.all(
    "SELECT employee_id, date FROM shifts WHERE date >= ? AND date <= ? AND is_day_off = 0",
    [range.start, range.end]
  ).forEach((shift) => {
    if (!byId.has(shift.employee_id)) return;
    planned.add(`${shift.employee_id}:${shift.date}`);
    days.get(shift.date).scheduled += 1;
    stats.get(shift.employee_id).scheduled += 1;
  });

  db.all(
    "SELECT employee_id, date, check_in, check_out, worked_minutes, late_minutes FROM attendance WHERE date >= ? AND date <= ?",
    [range.start, range.end]
  ).forEach((row) => {
    const employee = byId.get(row.employee_id);
    if (!employee || !row.check_in) return;
    const day = days.get(row.date);
    const st = stats.get(row.employee_id);
    day.attended += 1;
    st.attended += 1;
    if (row.late_minutes > 0) { day.late += 1; st.late += 1; st.lateMinutes += row.late_minutes; }
    // Only closed shifts have verified worked minutes; open shifts are not billed yet.
    const minutes = row.check_out ? Math.max(0, Number(row.worked_minutes) || 0) : 0;
    const cost = minutes / 60 * (employee.hourly_rate || 0);
    day.minutes += minutes; day.cost += cost;
    st.minutes += minutes; st.cost += cost;
    planned.delete(`${row.employee_id}:${row.date}`);
  });
  planned.forEach((key) => {
    const [id, date] = [Number(key.slice(0, key.indexOf(":"))), key.slice(key.indexOf(":") + 1)];
    if (date < today) { days.get(date).missing += 1; stats.get(id).missing += 1; }
  });

  const series = [...days.values()].map((d) => {
    const out = { date: d.date, scheduled: d.scheduled, attended: d.attended, late: d.late, missing: d.missing, minutes: d.minutes, hours: round2(d.minutes / 60), future: d.future };
    if (showMoney) out.cost = Math.round(d.cost);
    return out;
  });
  const totals = series.reduce((acc, d) => {
    for (const k of ["scheduled", "attended", "late", "missing", "minutes"]) acc[k] += d[k];
    return acc;
  }, { scheduled: 0, attended: 0, late: 0, missing: 0, minutes: 0 });
  totals.hours = round2(totals.minutes / 60);
  totals.punctuality = totals.attended ? Math.round((totals.attended - totals.late) / totals.attended * 100) : null;
  if (showMoney) totals.cost = Math.round([...stats.values()].reduce((s, e) => s + e.cost, 0));

  const employees = [...stats.values()].map((e) => {
    const out = {
      id: e.id, name: e.name, position: e.position, scheduled: e.scheduled, attended: e.attended, late: e.late,
      late_minutes: e.lateMinutes, missing: e.missing, minutes: e.minutes, hours: round2(e.minutes / 60),
      punctuality: e.attended ? Math.round((e.attended - e.late) / e.attended * 100) : null,
    };
    if (showMoney) out.cost = Math.round(e.cost);
    return out;
  });

  const positions = new Map();
  employees.forEach((e) => {
    const key = e.position || "Без должности";
    const row = positions.get(key) || { position: key, staff: 0, hours: 0, cost: 0 };
    row.staff += 1; row.hours = round2(row.hours + e.hours); row.cost += e.cost || 0;
    positions.set(key, row);
  });

  return {
    team, totals, series, employees,
    positions: [...positions.values()].map((p) => (showMoney ? p : { position: p.position, staff: p.staff, hours: p.hours })),
  };
}

function registerAnalytics(sdk) {
  const { db } = sdk;
  sdk.miniapp.get("/analytics/overview", async (ctx) => {
    const manager = db.get("SELECT id, role, telegram_id, active, branch_id FROM employees WHERE telegram_id = ?", [ctx.user.id]);
    if (!manager || !manager.active || !roles.canSeeAnalytics(manager)) return { error: "no_access" };
    const query = ctx.query || {};
    const today = time.today();

    let range;
    let month = null;
    let view = null;
    if (query.view) {
      month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.month || "")) ? String(query.month) : today.slice(0, 7);
      view = ["p1", "p2", "full"].includes(query.view) ? query.view : null;
      if (!view) return { error: "bad_period" };
      range = salary.viewRange(month, view);
    } else {
      const legacy = legacyRange(query, today);
      if (!legacy) return { error: "bad_period" };
      range = legacy;
    }

    // Branch scope: owner and finance director see every branch; others only their own.
    const allBranches = db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id").filter((b) => roles.canAccessBranch(manager, b.id));
    if (!allBranches.length) return { error: "no_access" };
    let branchIds = allBranches.map((b) => b.id);
    const requestedBranch = query.branch === undefined || query.branch === "" || query.branch === "all" ? null : Number(query.branch);
    if (requestedBranch !== null) {
      if (!branchIds.includes(requestedBranch)) return { error: "bad_filter" };
      branchIds = [requestedBranch];
    }

    const employeeId = query.employee_id === undefined || query.employee_id === "" ? null : Number(query.employee_id);
    const position = String(query.position || "");
    const all = db.all(`SELECT id, position FROM employees WHERE role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager') AND branch_id IN (${branchIds.map(() => "?").join(",")}) AND active = 1`, branchIds);
    if ((employeeId !== null && (!Number.isSafeInteger(employeeId) || !all.some((e) => e.id === employeeId))) ||
        (position && !all.some((e) => e.position === position))) return { error: "bad_filter" };

    const showMoney = roles.canSeeMoney(manager);
    const filters = { employeeId, position };
    const current = collect(db, branchIds, range, today, filters, showMoney);

    let previous = null;
    if (view) {
      const prevSel = previousRange(month, view);
      const prevRange = salary.viewRange(prevSel.month, prevSel.view);
      const p = collect(db, branchIds, prevRange, today, filters, showMoney);
      previous = { start: prevRange.start, end: prevRange.end, view: prevSel.view, month: prevSel.month, totals: p.totals };
    }

    // Per-branch comparison for people who see several branches.
    let byBranch = null;
    if (allBranches.length > 1 && requestedBranch === null) {
      byBranch = allBranches.map((b) => {
        const c = collect(db, [b.id], range, today, { employeeId: null, position: "" }, showMoney);
        const row = { id: b.id, name: b.name, staff: c.employees.length, hours: c.totals.hours, attended: c.totals.attended, scheduled: c.totals.scheduled, late: c.totals.late, missing: c.totals.missing, punctuality: c.totals.punctuality };
        if (showMoney) row.cost = c.totals.cost;
        return row;
      });
    }

    const base = salary.monthPeriods(month || today.slice(0, 7));
    return {
      view,
      month,
      period: range.period || view,
      start: range.start,
      end: range.end,
      payout: range.payout || null,
      today,
      periods: { p1: { start: base.p1.start, end: base.p1.end, payout: base.p1.payout }, p2: { start: base.p2.start, end: base.p2.end, payout: base.p2.payout } },
      totals: current.totals,
      series: current.series,
      employees: current.employees,
      by_position: current.positions,
      by_branch: byBranch,
      branch: requestedBranch,
      previous,
      filters: {
        branches: allBranches,
        employees: current.team.map(({ id, name, position: pos }) => ({ id, name, position: pos })),
        positions: [...new Set(current.team.map((e) => e.position).filter(Boolean))].sort(),
      },
      payroll_visible: showMoney,
    };
  });
}

module.exports = registerAnalytics;
