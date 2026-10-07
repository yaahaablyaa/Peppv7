/** Manager analytics: two pay periods (1–15, 16–end) and the whole month. */

type AnalyticsView = "p1" | "p2" | "full";
interface AnTotals { scheduled: number; attended: number; late: number; missing: number; minutes: number; hours: number; punctuality: number | null; cost?: number }
interface AnEmployee { id: number; name: string; position: string; scheduled: number; attended: number; late: number; late_minutes: number; missing: number; minutes: number; hours: number; punctuality: number | null; cost?: number }
interface AnalyticsData {
  view: AnalyticsView | null;
  month: string | null;
  start: string;
  end: string;
  payout: string | null;
  today: string;
  periods: { p1: { start: string; end: string; payout: string }; p2: { start: string; end: string; payout: string } };
  totals: AnTotals;
  series: { date: string; scheduled: number; attended: number; late: number; missing: number; hours: number; future: boolean; cost?: number }[];
  employees: AnEmployee[];
  by_position: { position: string; staff: number; hours: number; cost?: number }[];
  by_branch: { id: number; name: string; staff: number; hours: number; attended: number; scheduled: number; late: number; missing: number; punctuality: number | null; cost?: number }[] | null;
  branch: number | null;
  previous: { start: string; end: string; view: AnalyticsView; month: string; totals: AnTotals } | null;
  filters: { branches: { id: number; name: string }[]; employees: { id: number; name: string; position: string }[]; positions: string[] };
  payroll_visible: boolean;
  sections: AnalyticsSections;
  error?: string;
}

interface Rec { level: "bad" | "warn" | "good" | "info"; area: string; title: string; text: string }
interface AnalyticsSections {
  payroll: { visible: boolean; hours: number; planned_hours: number; total?: number; avg_hour?: number; forecast?: number; is_forecast?: boolean; prev_total?: number | null;
    top?: { id: number; name: string; position: string; cost: number; hours: number }[]; by_position: { position: string; staff: number; hours: number; cost?: number }[]; by_branch: AnalyticsData["by_branch"] };
  load: { weekday: { dow: number; label: string; dates: number; avg_staff: number; hours: number }[]; peak: { label: string; avg_staff: number } | null; quiet: { label: string; avg_staff: number } | null;
    zero_days: string[]; planned_hours: number; planned_past_hours: number; actual_hours: number; utilization: number | null; avg_hours: number;
    overloaded: { id: number; name: string; hours: number; over: number }[]; underloaded: { id: number; name: string; hours: number; under: number }[];
    people: { id: number; name: string; hours: number; planned_hours: number }[] };
  discipline: { punctuality: number | null; late: number; missing: number; attended: number; scheduled: number; late_minutes: number; avg_late: number; attendance_rate: number | null;
    weekday: { dow: number; label: string; late: number; missing: number }[];
    worst: { id: number; name: string; position: string; late: number; late_minutes: number; missing: number }[]; best: { id: number; name: string; position: string; attended: number }[] };
  recommendations: Rec[];
}

type AnalyticsSection = "summary" | "payroll" | "load" | "discipline" | "recs";
let analyticsSection: AnalyticsSection = "summary";

let analyticsMonth = uzbekistanToday().slice(0, 7);
let analyticsView: AnalyticsView = Number(uzbekistanToday().slice(8, 10)) <= 15 ? "p1" : "p2";
let analyticsBranch = "all";
let analyticsSort: "hours" | "late" | "missing" = "hours";
let analyticsData: AnalyticsData | null = null;

const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function monthTitle(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS_NOM[Number(m) - 1] || ""} ${y}`;
}

function shiftMonthString(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

function viewLabel(view: AnalyticsView): string {
  return view === "p1" ? "1–15 число" : view === "p2" ? "16 — конец месяца" : "Весь месяц";
}

function delta(value: number | null, previous: number | null, lowerIsBetter = false): string {
  if (value === null || previous === null) return "";
  if (previous === 0) return value === 0 ? "" : '<span class="delta delta--flat">нет базы</span>';
  const change = Math.round((value - previous) / previous * 100);
  if (change === 0) return '<span class="delta delta--flat">без изменений</span>';
  const good = (change > 0) !== lowerIsBetter;
  return `<span class="delta ${good ? "delta--good" : "delta--bad"}">${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%</span>`;
}

function analyticsChart(d: AnalyticsData): string {
  const money = d.payroll_visible;
  const values = d.series.map((s) => (money ? s.cost || 0 : s.hours));
  const max = Math.max(1, ...values);
  const dense = d.series.length > 16;
  const bars = d.series.map((s, i) => {
    const v = values[i];
    const h = Math.round(v / max * 100);
    const day = Number(s.date.slice(8, 10));
    return `<div class="bar-col${s.future ? " bar-col--future" : ""}${s.date === d.today ? " bar-col--today" : ""}" title="${esc(humanDate(s.date))}: ${money ? esc(moneyShort(v)) : esc(hoursText(v))}">` +
      `<div class="bar-track"><div class="bar-fill" style="--h:${Math.max(v > 0 ? 4 : 0, h)}%;--d:${Math.min(i * 18, 600)}ms"></div></div>` +
      `<div class="bar-label">${dense && day % 5 !== 1 && day !== d.series.length ? "" : day}</div></div>`;
  }).join("");
  return `<div class="section chart-card"><div class="chart-head"><span>${money ? "Затраты по дням" : "Часы по дням"}</span><b>${money ? esc(moneyShort(max)) : esc(hoursText(max))} макс.</b></div><div class="bars${dense ? " bars--dense" : ""}">${bars}</div></div>`;
}

function moneyShort(v: number): string {
  if (v >= 1000000) return (Math.round(v / 100000) / 10).toString().replace(".", ",") + " млн";
  if (v >= 1000) return Math.round(v / 1000) + " тыс";
  return String(Math.round(v));
}

function analyticsEmployees(d: AnalyticsData): string {
  if (!d.employees.length) return '<div class="section"><div class="empty">Сотрудников пока нет</div></div>';
  const rows = d.employees.slice().sort((a, b) => analyticsSort === "hours" ? b.minutes - a.minutes : analyticsSort === "late" ? b.late - a.late : b.missing - a.missing);
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return '<div class="section section--stagger">' + rows.map((e, i) =>
    `<div class="an-emp" style="--i:${i}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span>` +
    `<span class="an-emp-val">${d.payroll_visible && e.cost !== undefined ? esc(money(e.cost)) : esc(hoursText(e.hours))}</span></div>` +
    `<div class="an-emp-sub">${esc(e.position || "Сотрудник")} · ${d.payroll_visible ? esc(hoursText(e.hours)) + " · " : ""}смен ${e.attended}/${e.scheduled}</div>` +
    bar(Math.round(e.minutes / max * 100)) +
    `<div class="an-tags">${e.late ? `<span class="tag tag--warn">опозданий ${e.late}</span>` : ""}${e.missing ? `<span class="tag tag--bad">прогулов ${e.missing}</span>` : ""}${e.punctuality !== null && !e.late && !e.missing ? '<span class="tag tag--good">без замечаний</span>' : ""}</div>` +
    "</div></div>").join("") + "</div>";
}

function analyticsSummary(d: AnalyticsData): string {
  const t = d.totals;
  const prev = d.previous ? d.previous.totals : null;
  const money = d.payroll_visible;
  const view = (d.view || analyticsView) as AnalyticsView;
  const range = `${humanDate(d.start)} — ${humanDate(d.end)}`;
  let html = "";
  const main = money ? t.cost || 0 : t.hours;
  const prevMain = prev ? (money ? prev.cost || 0 : prev.hours) : null;
  html += `<div class="hero hero--grad"><div class="hero-label">${esc(viewLabel(view))} · ${esc(range)}</div>` +
    `<div class="hero-value" ${countAttr(main, money ? "money" : "hours")}>${money ? esc(money_(main)) : esc(hoursText(main))}</div>` +
    `<div class="hero-sub">${money ? "Фонд оплаты труда" : "Отработано командой"} ${delta(main, prevMain)}${d.payout ? ` · выплата ${esc(humanDate(d.payout))}` : ""}</div></div>`;

  html += '<div class="stat-grid">' +
    `<div class="stat"><div class="stat-value" ${countAttr(t.hours, "hours")}>${esc(hoursText(t.hours))}</div><div class="stat-label">Отработано ${prev ? delta(t.hours, prev.hours) : ""}</div></div>` +
    `<div class="stat"><div class="stat-value" ${countAttr(t.attended, "int")}>${t.attended}</div><div class="stat-label">Выходов из ${t.scheduled} по графику</div></div>` +
    `<div class="stat"><div class="stat-value" ${t.punctuality === null ? "" : countAttr(t.punctuality, "pct")}>${t.punctuality === null ? "—" : t.punctuality + "%"}</div><div class="stat-label">Вовремя ${prev ? delta(t.punctuality, prev.punctuality) : ""}</div></div>` +
    `<div class="stat"><div class="stat-value${t.missing ? " stat-value--bad" : ""}" ${countAttr(t.missing, "int")}>${t.missing}</div><div class="stat-label">Не вышли ${prev ? delta(t.missing, prev.missing, true) : ""}</div></div></div>`;

  html += analyticsChart(d);

  if (d.by_branch && d.by_branch.length > 1) {
    const maxH = Math.max(1, ...d.by_branch.map((b) => b.hours));
    html += '<div class="section-title">По филиалам</div><div class="section section--stagger">' + d.by_branch.map((b, i) =>
      `<button type="button" class="an-branch" data-action="an-branch:${b.id}" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(b.name)}</span><span class="row-bar-val">${money && b.cost !== undefined ? esc(money_(b.cost)) : esc(hoursText(b.hours))}</span></div>` +
      `<div class="an-emp-sub">${b.staff} ${plural(b.staff, "сотрудник", "сотрудника", "сотрудников")} · ${esc(hoursText(b.hours))} · вовремя ${b.punctuality === null ? "—" : b.punctuality + "%"} · прогулов ${b.missing}</div>${bar(Math.round(b.hours / maxH * 100))}</button>`).join("") + "</div>";
  }

  if (d.by_position.length > 1) {
    const totalHours = d.by_position.reduce((s, p) => s + p.hours, 0) || 1;
    html += '<div class="section-title">По должностям</div><div class="section section--stagger">' + d.by_position.map((p, i) =>
      `<div class="row-bar" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(p.position)} · ${p.staff}</span><span class="row-bar-val">${money && p.cost !== undefined ? esc(money_(p.cost)) : esc(hoursText(p.hours))}</span></div>${bar(Math.round(p.hours / totalHours * 100))}</div>`).join("") + "</div>";
  }

  html += '<div class="section-title">Сотрудники</div>';
  html += segmented("analytics-sort", [{ id: "hours", label: "Часы" }, { id: "late", label: "Опоздания" }, { id: "missing", label: "Прогулы" }], analyticsSort, "an-sort:");
  html += analyticsEmployees(d);
  html += `<div class="section-footer">Расчётные периоды: 1–15 число (выплата 25-го), 16 число — конец месяца (выплата 10-го следующего месяца). Считаются только закрытые смены.${money ? "" : " Суммы по зарплате видит только владелец."}</div>`;
  return html;
}

const SECTION_TABS: { id: AnalyticsSection; label: string }[] = [
  { id: "summary", label: "Сводка" }, { id: "payroll", label: "ФОТ" }, { id: "load", label: "Загруженность" },
  { id: "discipline", label: "Дисциплина" }, { id: "recs", label: "Рекомендации" },
];

function renderAnalytics(d: AnalyticsData): string {
  const view = (d.view || analyticsView) as AnalyticsView;
  const arrowL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const arrowR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const monthKey = d.month || analyticsMonth;
  let html = '<div class="screen screen--wide"><button class="back-link" data-action="analytics-back">‹ Назад</button><div class="screen-title">Аналитика</div>';
  html += '<div class="screen-sub">Показатели команды по расчётным периодам.</div>';
  html += `<div class="toolbar"><div class="month-nav"><button class="nav-arrow" data-action="an-month:-1" type="button" aria-label="Предыдущий месяц">${arrowL}</button><div class="month-name">${esc(monthTitle(monthKey))}</div>` +
    `<button class="nav-arrow" data-action="an-month:1" type="button" aria-label="Следующий месяц"${monthKey >= uzbekistanToday().slice(0, 7) ? " disabled" : ""}>${arrowR}</button></div>` +
    segmented("analytics", [{ id: "p1", label: "1–15" }, { id: "p2", label: "16–конец" }, { id: "full", label: "Месяц" }], view, "an-view:") + "</div>";
  if (d.filters.branches.length > 1) {
    html += '<div class="chips chips--scroll"><button type="button" class="chip' + (analyticsBranch === "all" ? " chip--on" : "") + '" data-action="an-branch:all">Все филиалы</button>' +
      d.filters.branches.map((b) => `<button type="button" class="chip${analyticsBranch === String(b.id) ? " chip--on" : ""}" data-action="an-branch:${b.id}">${esc(b.name)}</button>`).join("") + "</div>";
  }
  const issues = d.sections.recommendations.filter((r) => r.level === "bad" || r.level === "warn").length;
  html += '<div class="sec-tabs" role="tablist">' + SECTION_TABS.map((tab) =>
    `<button type="button" role="tab" class="sec-tab${analyticsSection === tab.id ? " sec-tab--on" : ""}" data-action="an-sec:${tab.id}">${tab.label}${tab.id === "recs" && issues ? `<b class="sec-badge">${issues}</b>` : ""}</button>`).join("") + "</div>";
  html += '<div class="sec-body">';
  if (analyticsSection === "summary") html += analyticsSummary(d);
  else if (analyticsSection === "payroll") html += sectionPayroll(d);
  else if (analyticsSection === "load") html += sectionLoad(d);
  else if (analyticsSection === "discipline") html += sectionDiscipline(d);
  else html += sectionRecs(d);
  html += "</div>";
  return html + "</div>";
}

function statBox(value: string, label: string, bad?: boolean, count?: string): string {
  return `<div class="stat"><div class="stat-value${bad ? " stat-value--bad" : ""}"${count ? " " + count : ""}>${value}</div><div class="stat-label">${label}</div></div>`;
}

function barRows(rows: { title: string; sub?: string; value: string; percent: number; tone?: string }[]): string {
  return '<div class="section section--stagger">' + rows.map((r, i) =>
    `<div class="row-bar" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(r.title)}</span><span class="row-bar-val">${r.value}</span></div>${r.sub ? `<div class="an-emp-sub">${esc(r.sub)}</div>` : ""}${bar(r.percent, r.tone)}</div>`).join("") + "</div>";
}

function weekdayChart(values: { label: string; v: number; hot?: boolean }[], unit: string): string {
  const max = Math.max(1, ...values.map((x) => x.v));
  return '<div class="section chart-card"><div class="wd-bars">' + values.map((x, i) =>
    `<div class="wd-col${x.hot ? " wd-col--hot" : ""}"><span class="wd-val">${x.v ? fmtNum(x.v) : ""}</span><div class="wd-track"><div class="wd-fill" style="--h:${Math.max(x.v ? 5 : 0, Math.round(x.v / max * 100))}%;--d:${i * 40}ms"></div></div><span class="wd-label">${x.label}</span></div>`).join("") +
    `</div><div class="chart-note">${unit}</div></div>`;
}

function fmtNum(n: number): string { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n); }

function sectionPayroll(d: AnalyticsData): string {
  const p = d.sections.payroll;
  let html = "";
  if (!p.visible) {
    html += '<div class="section note-card"><div class="note-title">Суммы скрыты</div><div class="note-text">Зарплатные суммы видят только владелец и финансовый директор. Ниже показаны часы.</div></div>';
    html += '<div class="stat-grid">' + statBox(hoursText(p.hours), "Отработано") + statBox(hoursText(p.planned_hours), "Запланировано") + "</div>";
    if (p.by_position.length) html += '<div class="section-title">Часы по должностям</div>' + barRows(p.by_position.map((x) => ({ title: `${x.position} · ${x.staff}`, value: hoursText(x.hours), percent: pct(x.hours, Math.max(1, ...p.by_position.map((y) => y.hours))) })));
    return html;
  }
  const total = p.total || 0;
  const change = p.prev_total ? Math.round((total - p.prev_total) / p.prev_total * 100) : null;
  html += `<div class="hero hero--grad"><div class="hero-label">ФОТ за период · ${esc(humanDate(d.start))} — ${esc(humanDate(d.end))}</div><div class="hero-value" ${countAttr(total, "money")}>${esc(money(total))}</div>` +
    `<div class="hero-sub">${change === null ? "Нет данных для сравнения" : `К прошлому периоду <span class="delta ${change > 0 ? "delta--bad" : "delta--good"}">${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%</span>`}</div></div>`;
  html += '<div class="stat-grid">' +
    statBox(esc(money(p.forecast || 0)), p.is_forecast ? "Прогноз до конца периода" : "Итог периода") +
    statBox(esc(money(p.avg_hour || 0)), "Средняя стоимость часа") +
    statBox(hoursText(p.hours), "Отработано") + statBox(hoursText(p.planned_hours), "Запланировано") + "</div>";
  html += analyticsChart(d);
  if (p.by_branch && p.by_branch.length > 1) {
    const max = Math.max(1, ...p.by_branch.map((b) => b.cost || 0));
    html += '<div class="section-title">По филиалам</div>' + barRows(p.by_branch.map((b) => ({ title: b.name, sub: `${b.staff} чел. · ${hoursText(b.hours)}`, value: esc(money(b.cost || 0)), percent: pct(b.cost || 0, max) })));
  }
  if (p.by_position.length) {
    const max = Math.max(1, ...p.by_position.map((x) => x.cost || 0));
    html += '<div class="section-title">По должностям</div>' + barRows(p.by_position.slice().sort((a, b) => (b.cost || 0) - (a.cost || 0)).map((x) => ({ title: `${x.position} · ${x.staff}`, sub: hoursText(x.hours), value: esc(money(x.cost || 0)), percent: pct(x.cost || 0, max) })));
  }
  if (p.top && p.top.length) {
    const max = Math.max(1, ...p.top.map((x) => x.cost));
    html += '<div class="section-title">Больше всего начислено</div>' + barRows(p.top.map((x) => ({ title: x.name, sub: `${x.position || "Сотрудник"} · ${hoursText(x.hours)}`, value: esc(money(x.cost)), percent: pct(x.cost, max) })));
  }
  return html;
}

function sectionLoad(d: AnalyticsData): string {
  const l = d.sections.load;
  let html = '<div class="stat-grid">' +
    statBox(l.utilization === null ? "—" : l.utilization + "%", "Выполнено от плана", l.utilization !== null && l.utilization < 85, l.utilization === null ? "" : countAttr(l.utilization, "pct")) +
    statBox(hoursText(l.actual_hours), "Отработано") + statBox(hoursText(l.planned_hours), "Запланировано на период") +
    statBox(String(l.zero_days.length), "Дней без смен", l.zero_days.length > 0, countAttr(l.zero_days.length, "int")) + "</div>";
  html += '<div class="section-title">Сколько человек на смене по дням недели</div>' +
    weekdayChart(l.weekday.map((w) => ({ label: w.label, v: w.avg_staff, hot: !!l.peak && w.label === l.peak.label && w.avg_staff > 0 })), l.peak ? `В среднем на смене. Пик: ${l.peak.label} (${fmtNum(l.peak.avg_staff)})` : "Нет смен в периоде");
  if (l.overloaded.length || l.underloaded.length) {
    html += '<div class="section-title">Баланс нагрузки</div><div class="section section--stagger">' +
      l.overloaded.map((e, i) => `<div class="an-emp" style="--i:${i}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span><span class="tag tag--bad">+${e.over}% к среднему</span></div><div class="an-emp-sub">${hoursText(e.hours)} при среднем ${hoursText(l.avg_hours)}</div></div></div>`).join("") +
      l.underloaded.map((e, i) => `<div class="an-emp" style="--i:${i + l.overloaded.length}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span><span class="tag tag--warn">−${e.under}% к среднему</span></div><div class="an-emp-sub">${hoursText(e.hours)} при среднем ${hoursText(l.avg_hours)}</div></div></div>`).join("") + "</div>";
  }
  if (l.people.length) {
    const max = Math.max(1, ...l.people.map((x) => Math.max(x.hours, x.planned_hours)));
    html += '<div class="section-title">Часы по сотрудникам</div>' + barRows(l.people.map((x) => ({ title: x.name, sub: `План ${hoursText(x.planned_hours)}`, value: hoursText(x.hours), percent: pct(x.hours, max) })));
  }
  if (l.zero_days.length) html += `<div class="section-footer">Дни без назначенных смен: ${l.zero_days.slice(0, 8).map((x) => esc(humanDate(x))).join(", ")}${l.zero_days.length > 8 ? " и другие" : ""}.</div>`;
  return html;
}

function sectionDiscipline(d: AnalyticsData): string {
  const x = d.sections.discipline;
  let html = '<div class="stat-grid">' +
    statBox(x.punctuality === null ? "—" : x.punctuality + "%", "Приходят вовремя", x.punctuality !== null && x.punctuality < 90, x.punctuality === null ? "" : countAttr(x.punctuality, "pct")) +
    statBox(String(x.late), `Опозданий${x.avg_late ? ` · в среднем ${x.avg_late} мин` : ""}`, x.late > 0, countAttr(x.late, "int")) +
    statBox(String(x.missing), "Прогулов", x.missing > 0, countAttr(x.missing, "int")) +
    statBox(x.attendance_rate === null ? "—" : x.attendance_rate + "%", "Выходов от графика") + "</div>";
  const maxLate = Math.max(...x.weekday.map((w) => w.late + w.missing));
  html += '<div class="section-title">Опоздания и прогулы по дням недели</div>' +
    weekdayChart(x.weekday.map((w) => ({ label: w.label, v: w.late + w.missing, hot: maxLate > 0 && w.late + w.missing === maxLate })), "Опоздания и прогулы вместе");
  if (x.worst.length) {
    html += '<div class="section-title">Требуют внимания</div><div class="section section--stagger">' + x.worst.map((e, i) =>
      `<div class="an-emp" style="--i:${i}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span></div><div class="an-emp-sub">${esc(e.position || "Сотрудник")}${e.late_minutes ? " · опоздал на " + e.late_minutes + " мин суммарно" : ""}</div>` +
      `<div class="an-tags">${e.late ? `<span class="tag tag--warn">опозданий ${e.late}</span>` : ""}${e.missing ? `<span class="tag tag--bad">прогулов ${e.missing}</span>` : ""}</div></div></div>`).join("") + "</div>";
  } else {
    html += '<div class="section note-card"><div class="note-title">Замечаний нет</div><div class="note-text">В этом периоде нет опозданий и прогулов.</div></div>';
  }
  if (x.best.length) {
    html += '<div class="section-title">Без замечаний</div><div class="section section--stagger">' + x.best.map((e, i) =>
      `<div class="an-emp" style="--i:${i}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span><span class="tag tag--good">${e.attended} ${plural(e.attended, "смена", "смены", "смен")}</span></div><div class="an-emp-sub">${esc(e.position || "Сотрудник")}</div></div></div>`).join("") + "</div>";
  }
  return html;
}

function sectionRecs(d: AnalyticsData): string {
  const recs = d.sections.recommendations;
  const icons: Record<string, string> = { bad: "!", warn: "!", good: "✓", info: "i" };
  const order: Record<string, number> = { bad: 0, warn: 1, info: 2, good: 3 };
  const sorted = recs.slice().sort((a, b) => order[a.level] - order[b.level]);
  return '<div class="recs">' + sorted.map((r, i) =>
    `<div class="rec rec--${r.level}" style="--i:${i}"><span class="rec-ico">${icons[r.level]}</span><div class="rec-main"><div class="rec-title">${esc(r.title)}</div><div class="rec-text">${esc(r.text)}</div></div></div>`).join("") +
    '</div><div class="section-footer">Рекомендации составляются автоматически по графику, отметкам прихода и ФОТ за выбранный период.</div>';
}

function money_(v: number): string { return money(v); }

function handleAnalyticsAction(action: string): boolean {
  if (action.indexOf("an-view:") === 0) {
    const v = action.slice(8) as AnalyticsView;
    if (v !== "p1" && v !== "p2" && v !== "full") return true;
    analyticsView = v;
    haptic("light");
    void loadAnalyticsKeep();
    return true;
  }
  if (action.indexOf("an-month:") === 0) {
    const dir = Number(action.slice(9));
    if (dir !== -1 && dir !== 1) return true;
    const next = shiftMonthString(analyticsMonth, dir);
    if (next > uzbekistanToday().slice(0, 7)) return true;
    analyticsMonth = next;
    haptic("light");
    void loadAnalyticsKeep();
    return true;
  }
  if (action.indexOf("an-branch:") === 0) {
    analyticsBranch = action.slice(10);
    haptic("light");
    void loadAnalyticsKeep();
    return true;
  }
  if (action.indexOf("an-sec:") === 0) {
    const id = action.slice(7) as AnalyticsSection;
    if (!SECTION_TABS.some((t) => t.id === id)) return true;
    analyticsSection = id;
    haptic("light");
    if (analyticsData) rerender(renderAnalytics(analyticsData));
    const tab = root().querySelector<HTMLElement>(".sec-tab--on");
    if (tab && tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "center" });
    return true;
  }
  if (action.indexOf("an-sort:") === 0) {
    const s = action.slice(8) as "hours" | "late" | "missing";
    if (s !== "hours" && s !== "late" && s !== "missing") return true;
    analyticsSort = s;
    haptic("light");
    if (analyticsData) rerender(renderAnalytics(analyticsData));
    return true;
  }
  return false;
}

async function loadAnalyticsKeep(): Promise<void> {
  try {
    const d = await api<AnalyticsData>(`/analytics/overview?view=${analyticsView}&month=${analyticsMonth}&branch=${analyticsBranch}`);
    if (activeTab !== "analytics") return;
    if (d.error) { analyticsBranch = "all"; return; }
    analyticsData = d;
    tabCache[tabKey("analytics")] = renderAnalytics(d);
    rerender(renderAnalytics(d));
  } catch (e) {
    tg.showAlert("Не удалось загрузить данные. Проверьте связь.");
  }
}
