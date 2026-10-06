const time = require("./time");
const salary = require("./salary");

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const roundHours = (minutes) => Math.round(minutes / 60 * 100) / 100;
const weekdayIndex = (date) => (time.weekday(date) + 6) % 7;

function shiftMinutes(shift) {
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (shift.is_day_off || !valid.test(shift.start_time || "") || !valid.test(shift.end_time || "")) return 0;
  const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const length = (minutes(shift.end_time) - minutes(shift.start_time) + 1440) % 1440;
  return length || 1440;
}

function weekTotals(dates, start, end, active) {
  const days = dates.filter((day) => day.date >= start && day.date <= end);
  const attended = days.reduce((sum, day) => sum + day.attended, 0);
  const onTime = days.reduce((sum, day) => sum + day.onTime, 0);
  return {
    cost: Math.round(days.reduce((sum, day) => sum + day.cost, 0)),
    hours: roundHours(days.reduce((sum, day) => sum + day.minutes, 0)),
    punctuality: attended ? Math.round(onTime / attended * 100) : null,
    active,
  };
}

function nextPayout(db, team, today, branchId) {
  const previous = salary.previousPeriod(today);
  const period = previous.payout >= today ? previous : salary.currentPeriod(today);
  const rates = new Map(team.map((employee) => [employee.id, Number(employee.hourly_rate) || 0]));
  const rows = db.all(
    `SELECT attendance.employee_id, attendance.worked_minutes
       FROM attendance JOIN employees ON employees.id = attendance.employee_id
      WHERE employees.role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager') AND employees.branch_id = ? AND attendance.check_out IS NOT NULL
        AND attendance.date >= ? AND attendance.date <= ?`,
    [branchId, period.start, period.end]
  );
  return {
    date: period.payout,
    amount: Math.round(rows.reduce((sum, row) => sum + Math.max(0, Number(row.worked_minutes) || 0) / 60 * (rates.get(row.employee_id) || 0), 0)),
    through: today < period.end ? today : period.end,
  };
}

module.exports = function registerAnalyticsReport(sdk) {
  const { db } = sdk;
  sdk.miniapp.get("/analytics", async (ctx) => {
    const manager = db.get("SELECT role, active, branch_id FROM employees WHERE telegram_id = ?", [ctx.user.id]);
    if (!manager || !manager.active || !["manager", "owner"].includes(manager.role)) return { error: "no_access" };

    const today = time.today();
    const start = time.addDays(today, -13);
    const monday = time.addDays(today, -weekdayIndex(today));
    const previousMonday = time.addDays(monday, -7);
    const previousSunday = time.addDays(monday, -1);
    const team = db.all("SELECT id, full_name, position, hourly_rate, active, created_at FROM employees WHERE role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager') AND branch_id = ? ORDER BY full_name, id", [manager.branch_id]);
    const byId = new Map(team.map((employee) => [employee.id, employee]));
    const days = new Map();
    for (let date = start; date <= today; date = time.addDays(date, 1)) {
      days.set(date, { date, minutes: 0, cost: 0, attended: 0, onTime: 0 });
    }
    const weekdays = WEEKDAYS.map((name) => ({ name, minutes: 0, cost: 0 }));
    const positions = new Map();
    const ranking = new Map(team.map((employee) => [employee.id, {
      id: employee.id, name: employee.full_name, shifts: 0, late: 0, lateMinutes: 0, attended: 0,
    }]));
    const heatmap = new Map(team.map((employee) => [employee.id, Array(7).fill(0)]));

    db.all(
      `SELECT shifts.employee_id, shifts.date, shifts.start_time, shifts.end_time, shifts.is_day_off
         FROM shifts JOIN employees ON employees.id = shifts.employee_id
        WHERE employees.branch_id = ? AND shifts.date >= ? AND shifts.date <= ?`,
      [manager.branch_id, start, today]
    ).forEach((shift) => {
      const employee = byId.get(shift.employee_id);
      if (!employee || shift.is_day_off) return;
      const minutes = shiftMinutes(shift);
      const day = days.get(shift.date);
      const weekday = weekdayIndex(shift.date);
      const cost = minutes / 60 * (Number(employee.hourly_rate) || 0);
      day.minutes += minutes;
      day.cost += cost;
      weekdays[weekday].minutes += minutes;
      weekdays[weekday].cost += cost;
      heatmap.get(employee.id)[weekday] += minutes;
      ranking.get(employee.id).shifts += 1;
      const position = employee.position || "Без должности";
      positions.set(position, (positions.get(position) || 0) + cost);
    });

    db.all(
      `SELECT attendance.employee_id, attendance.date, attendance.check_in, attendance.late_minutes
         FROM attendance JOIN employees ON employees.id = attendance.employee_id
        WHERE employees.branch_id = ? AND attendance.date >= ? AND attendance.date <= ?`,
      [manager.branch_id, start, today]
    ).forEach((row) => {
      if (!byId.has(row.employee_id) || !row.check_in) return;
      const day = days.get(row.date);
      const person = ranking.get(row.employee_id);
      const late = Math.max(0, Number(row.late_minutes) || 0);
      day.attended += 1;
      person.attended += 1;
      if (late) {
        person.late += 1;
        person.lateMinutes += late;
      } else day.onTime += 1;
    });

    const series = [...days.values()].map((day) => ({
      date: day.date,
      punctuality: day.attended ? Math.round(day.onTime / day.attended * 100) : null,
      attended: day.attended,
      cost: Math.round(day.cost),
    }));
    const current = weekTotals([...days.values()], monday, today, team.filter((person) => person.active).length);
    const previous = weekTotals([...days.values()], previousMonday, previousSunday,
      team.filter((person) => person.active && person.created_at.slice(0, 10) <= previousSunday).length);
    const costs = weekdays.map((day) => ({ name: day.name, cost: Math.round(day.cost), hours: roundHours(day.minutes) }));
    const people = [...ranking.values()].map((person) => ({
      id: person.id, name: person.name, shifts: person.shifts, late: person.late,
      averageLate: person.late ? Math.round(person.lateMinutes / person.late) : 0,
      punctuality: person.attended ? Math.round((person.attended - person.late) / person.attended * 100) : null,
    })).sort((a, b) => (b.punctuality ?? -1) - (a.punctuality ?? -1) || a.late - b.late || a.name.localeCompare(b.name, "ru"));

    const pending = db.get("SELECT COUNT(*) AS count FROM applications JOIN employees ON employees.id = applications.employee_id WHERE applications.status = 'pending' AND employees.branch_id = ? AND employees.role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager')", [manager.branch_id]).count;
    const payout = nextPayout(db, team, today, manager.branch_id);
    const insights = [];
    const peak = costs.reduce((best, item) => item.cost > best.cost ? item : best, costs[0]);
    if (peak.cost) insights.push(`Больше всего на ФОТ уходит в ${peak.name}: ${salary.formatMoney(peak.cost)} за 14 дней.`);
    const lateLeader = [...people].sort((a, b) => b.late - a.late)[0];
    if (lateLeader && lateLeader.late >= 2) insights.push(`${lateLeader.name}: ${lateLeader.late} опоздания за 14 дней.`);
    if (previous.cost && current.cost > previous.cost * 1.05) {
      insights.push(`ФОТ вырос на ${Math.round((current.cost / previous.cost - 1) * 100)}% к прошлой неделе.`);
    }
    insights.push(`Ожидают ответа: ${pending} заявлений.`);
    insights.push(`Ближайшая выплата ${payout.date}: ${salary.formatMoney(payout.amount)} по закрытым сменам.`);
    if (!peak.cost) insights.push("За последние 14 дней в графике пока нет рабочих часов.");

    return {
      start, end: today, week: { current, previous, start: monday, previousStart: previousMonday },
      weekdays: costs, series,
      positions: [...positions].map(([name, cost]) => ({ name, cost: Math.round(cost) })).sort((a, b) => b.cost - a.cost),
      ranking: people,
      heatmap: team.map((person) => ({ id: person.id, name: person.full_name, hours: heatmap.get(person.id).map(roundHours) })),
      insights: insights.slice(0, 5), payout,
    };
  });
};
