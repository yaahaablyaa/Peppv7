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
const dowOf = (date) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
function shiftMinutes(start, end) {
  const [sh, sm] = String(start || "0:0").split(":").map(Number);
  const [eh, em] = String(end || "0:0").split(":").map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 24 * 60;
  return m;
}

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
    planned: 0, plannedPast: 0, plannedFutureCost: 0,
  }]));
  const weekday = Array.from({ length: 7 }, () => ({ dates: 0, staff: 0, minutes: 0, late: 0, missing: 0, attended: 0 }));
  for (const date of days.keys()) weekday[dowOf(date)].dates += 1;
  const closedKeys = new Set();

  const planned = new Set();
  const plannedShifts = [];
  db.all(
    "SELECT employee_id, date, start_time, end_time FROM shifts WHERE date >= ? AND date <= ? AND is_day_off = 0",
    [range.start, range.end]
  ).forEach((shift) => {
    if (!byId.has(shift.employee_id)) return;
    planned.add(`${shift.employee_id}:${shift.date}`);
    days.get(shift.date).scheduled += 1;
    const st = stats.get(shift.employee_id);
    st.scheduled += 1;
    const minutes = shiftMinutes(shift.start_time, shift.end_time);
    st.planned += minutes;
    if (shift.date <= today) st.plannedPast += minutes;
    weekday[dowOf(shift.date)].staff += 1;
    plannedShifts.push({ ...shift, minutes });
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
    const wd = weekday[dowOf(row.date)];
    wd.attended += 1;
    if (row.late_minutes > 0) { day.late += 1; st.late += 1; st.lateMinutes += row.late_minutes; wd.late += 1; }
    if (row.check_out) closedKeys.add(`${row.employee_id}:${row.date}`);
    // Only closed shifts have verified worked minutes; open shifts are not billed yet.
    const minutes = row.check_out ? Math.max(0, Number(row.worked_minutes) || 0) : 0;
    const cost = minutes / 60 * (employee.hourly_rate || 0);
    day.minutes += minutes; day.cost += cost;
    st.minutes += minutes; st.cost += cost;
    weekday[dowOf(row.date)].minutes += minutes;
    planned.delete(`${row.employee_id}:${row.date}`);
  });
  planned.forEach((key) => {
    const [id, date] = [Number(key.slice(0, key.indexOf(":"))), key.slice(key.indexOf(":") + 1)];
    if (date < today) { days.get(date).missing += 1; stats.get(id).missing += 1; weekday[dowOf(date)].missing += 1; }
  });
  // Planned cost of shifts that are still ahead (today included, if not closed yet).
  plannedShifts.forEach((sh) => {
    if (sh.date < today || closedKeys.has(`${sh.employee_id}:${sh.date}`)) return;
    const emp = byId.get(sh.employee_id);
    stats.get(sh.employee_id).plannedFutureCost += sh.minutes / 60 * (emp.hourly_rate || 0);
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
      planned_hours: round2(e.planned / 60), planned_past_hours: round2(e.plannedPast / 60),
      punctuality: e.attended ? Math.round((e.attended - e.late) / e.attended * 100) : null,
    };
    if (showMoney) { out.cost = Math.round(e.cost); out.planned_future_cost = Math.round(e.plannedFutureCost); }
    return out;
  });

  const positions = new Map();
  employees.forEach((e) => {
    const key = e.position || "Без должности";
    const row = positions.get(key) || { position: key, staff: 0, hours: 0, cost: 0 };
    row.staff += 1; row.hours = round2(row.hours + e.hours); row.cost += e.cost || 0;
    positions.set(key, row);
  });

  const plannedPastMinutes = [...stats.values()].reduce((sum, e) => sum + e.plannedPast, 0);
  const plannedMinutes = [...stats.values()].reduce((sum, e) => sum + e.planned, 0);
  const plannedFutureCost = [...stats.values()].reduce((sum, e) => sum + e.plannedFutureCost, 0);
  return {
    team, totals, series, employees, weekday, plannedMinutes, plannedPastMinutes, plannedFutureCost,
    positions: [...positions.values()].map((p) => (showMoney ? p : { position: p.position, staff: p.staff, hours: p.hours })),
  };
}

const DOW_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** The five analytics blocks: summary, payroll (ФОТ), workload, discipline, recommendations. */
function buildSections(current, previous, ctx) {
  const { today, range, showMoney, byBranch } = ctx;
  const t = current.totals;
  const emps = current.employees;
  const plannedHours = round2(current.plannedMinutes / 60);
  const plannedPastHours = round2(current.plannedPastMinutes / 60);

  // ---- payroll
  const payroll = { visible: showMoney, hours: t.hours, planned_hours: plannedHours };
  if (showMoney) {
    const cost = t.cost || 0;
    const elapsed = range.start > today ? 0 : 1;
    payroll.total = cost;
    payroll.avg_hour = t.hours ? Math.round(cost / t.hours) : 0;
    payroll.forecast = range.end > today ? Math.round(cost + current.plannedFutureCost) : cost;
    payroll.is_forecast = range.end > today && elapsed > 0;
    payroll.prev_total = previous ? previous.totals.cost || 0 : null;
    payroll.top = emps.slice().sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 8).map((e) => ({ id: e.id, name: e.name, position: e.position, cost: e.cost || 0, hours: e.hours }));
  }
  payroll.by_position = current.positions;
  payroll.by_branch = byBranch;

  // ---- workload
  const weekday = current.weekday.map((w, i) => ({
    dow: i, label: DOW_NAMES[i], dates: w.dates,
    avg_staff: w.dates ? round2(w.staff / w.dates) : 0,
    hours: round2(w.minutes / 60),
  }));
  const withDates = weekday.filter((w) => w.dates > 0);
  const peak = withDates.length ? withDates.reduce((a, b) => (b.avg_staff > a.avg_staff ? b : a)) : null;
  const quiet = withDates.length ? withDates.reduce((a, b) => (b.avg_staff < a.avg_staff ? b : a)) : null;
  const zeroDays = current.series.filter((d) => d.scheduled === 0).map((d) => d.date);
  const avgHours = emps.length ? emps.reduce((s2, e) => s2 + e.hours, 0) / emps.length : 0;
  const avgPlanned = emps.length ? emps.reduce((s2, e) => s2 + e.planned_hours, 0) / emps.length : 0;
  const base = avgHours > 0 ? avgHours : avgPlanned;
  const loadOf = (e) => (avgHours > 0 ? e.hours : e.planned_hours);
  const overloaded = base > 0 ? emps.filter((e) => loadOf(e) > base * 1.3 && loadOf(e) - base >= 8).map((e) => ({ id: e.id, name: e.name, hours: loadOf(e), over: Math.round((loadOf(e) / base - 1) * 100) })).sort((a, b) => b.over - a.over) : [];
  const underloaded = base > 0 ? emps.filter((e) => loadOf(e) < base * 0.6 && base - loadOf(e) >= 8).map((e) => ({ id: e.id, name: e.name, hours: loadOf(e), under: Math.round((1 - loadOf(e) / base) * 100) })).sort((a, b) => b.under - a.under) : [];
  const utilization = plannedPastHours > 0 ? Math.round(t.hours / plannedPastHours * 100) : null;
  const load = {
    weekday, peak: peak && { label: peak.label, avg_staff: peak.avg_staff }, quiet: quiet && { label: quiet.label, avg_staff: quiet.avg_staff },
    zero_days: zeroDays, planned_hours: plannedHours, planned_past_hours: plannedPastHours, actual_hours: t.hours, utilization,
    avg_hours: round2(avgHours), overloaded, underloaded,
    people: emps.slice().sort((a, b) => loadOf(b) - loadOf(a)).map((e) => ({ id: e.id, name: e.name, hours: e.hours, planned_hours: e.planned_hours })),
  };

  // ---- discipline
  const lateWeekday = current.weekday.map((w, i) => ({ dow: i, label: DOW_NAMES[i], late: w.late, missing: w.missing }));
  const worst = emps.filter((e) => e.late || e.missing).sort((a, b) => (b.missing * 3 + b.late) - (a.missing * 3 + a.late)).slice(0, 8)
    .map((e) => ({ id: e.id, name: e.name, position: e.position, late: e.late, late_minutes: e.late_minutes, missing: e.missing }));
  const best = emps.filter((e) => e.attended >= 3 && !e.late && !e.missing).slice(0, 6).map((e) => ({ id: e.id, name: e.name, position: e.position, attended: e.attended }));
  const discipline = {
    punctuality: t.punctuality, late: t.late, missing: t.missing, attended: t.attended, scheduled: t.scheduled,
    late_minutes: emps.reduce((s2, e) => s2 + e.late_minutes, 0),
    avg_late: t.late ? Math.round(emps.reduce((s2, e) => s2 + e.late_minutes, 0) / t.late) : 0,
    attendance_rate: t.scheduled ? Math.round(t.attended / Math.max(1, t.attended + t.missing) * 100) : null,
    weekday: lateWeekday, worst, best,
  };

  // ---- recommendations
  const recs = [];
  const names = (list, n) => list.slice(0, n).map((e) => e.name).join(", ");
  if (zeroDays.length) {
    const sample = zeroDays.slice(0, 3).map((d) => `${d.slice(8)}.${d.slice(5, 7)}`).join(", ");
    recs.push({ level: "bad", area: "load", title: `Нет смен на ${zeroDays.length} ${zeroDays.length === 1 ? "день" : "дн."}`, text: `В графике нет ни одного сотрудника: ${sample}${zeroDays.length > 3 ? " и другие" : ""}. Назначьте смены или отметьте, что ресторан закрыт.` });
  }
  if (t.missing > 0) {
    const rate = Math.round(t.missing / Math.max(1, t.scheduled) * 100);
    recs.push({ level: rate >= 8 ? "bad" : "warn", area: "discipline", title: `Прогулов: ${t.missing}`, text: `${rate}% смен по графику не отмечены.${worst.filter((w) => w.missing).length ? " Чаще всех: " + names(worst.filter((w) => w.missing), 3) + "." : ""} Поговорите с сотрудниками и уточните причины.` });
  }
  if (t.punctuality !== null && t.punctuality < 90) {
    recs.push({ level: t.punctuality < 75 ? "bad" : "warn", area: "discipline", title: `Вовремя приходят ${t.punctuality}%`, text: `Опозданий: ${t.late}, в среднем ${discipline.avg_late} мин.${worst.filter((w) => w.late).length ? " Чаще опаздывают: " + names(worst.filter((w) => w.late), 3) + "." : ""} Рассмотрите напоминания перед сменой.` });
  }
  const lateDay = lateWeekday.reduce((a, b) => (b.late > a.late ? b : a), { late: 0 });
  if (lateDay.late >= 3) recs.push({ level: "info", area: "discipline", title: `Больше всего опозданий в ${lateDay.label}`, text: `В этот день недели накопилось ${lateDay.late} опозданий. Проверьте, не слишком ли ранний старт смены.` });
  if (overloaded.length) recs.push({ level: "warn", area: "load", title: "Есть перегрузка", text: `${overloaded.slice(0, 3).map((e) => `${e.name} (+${e.over}%)`).join(", ")} работают заметно больше среднего (${round2(base)} ч). Перераспределите смены, чтобы избежать выгорания.` });
  if (underloaded.length) recs.push({ level: "info", area: "load", title: "Есть недогруженные сотрудники", text: `${underloaded.slice(0, 3).map((e) => `${e.name} (−${e.under}%)`).join(", ")} получают заметно меньше смен. Возможно, им можно добавить часы вместо перегруженных коллег.` });
  if (utilization !== null && utilization < 85) recs.push({ level: "warn", area: "load", title: `Выполнено ${utilization}% запланированных часов`, text: `По графику было ${plannedPastHours} ч, фактически отработано ${t.hours} ч. Проверьте, не остаются ли смены незакрытыми (нет отметки об уходе).` });
  if (peak && quiet && peak.avg_staff - quiet.avg_staff >= 2) recs.push({ level: "info", area: "load", title: `Самый загруженный день: ${peak.label}`, text: `В ${peak.label} на смене в среднем ${peak.avg_staff} чел., в ${quiet.label} только ${quiet.avg_staff}. Сверьте это с реальной посещаемостью.` });
  if (showMoney && payroll.prev_total && payroll.total) {
    const change = Math.round((payroll.total - payroll.prev_total) / payroll.prev_total * 100);
    if (change >= 15) recs.push({ level: "warn", area: "payroll", title: `ФОТ вырос на ${change}%`, text: `По сравнению с прошлым периодом расходы на зарплаты выросли. Проверьте переработки и количество смен.` });
    else if (change <= -15) recs.push({ level: "info", area: "payroll", title: `ФОТ снизился на ${Math.abs(change)}%`, text: `Расходы на зарплаты ниже прошлого периода. Убедитесь, что это не недобор смен.` });
  }
  if (showMoney && payroll.is_forecast && payroll.forecast) recs.push({ level: "info", area: "payroll", title: "Прогноз ФОТ до конца периода", text: `С учётом запланированных смен ожидается около ${Math.round(payroll.forecast).toLocaleString("ru-RU")} сум.` });
  if (!recs.some((r) => r.level === "bad" || r.level === "warn") && (t.attended > 0)) recs.unshift({ level: "good", area: "all", title: "Всё в порядке", text: "Критичных отклонений за период нет: смены закрыты, дисциплина и нагрузка в норме." });
  if (!recs.length) recs.push({ level: "info", area: "all", title: "Пока мало данных", text: "Когда появятся смены и отметки прихода, здесь будут рекомендации." });

  return { payroll, load, discipline, recommendations: recs };
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
    let previousData = null;
    if (view) {
      const prevSel = previousRange(month, view);
      const prevRange = salary.viewRange(prevSel.month, prevSel.view);
      const p = collect(db, branchIds, prevRange, today, filters, showMoney);
      previousData = p;
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

    const sections = buildSections(current, previous && previousData, { today, range, showMoney, byBranch });
    const base = salary.monthPeriods(month || today.slice(0, 7));
    return {
      sections,
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
