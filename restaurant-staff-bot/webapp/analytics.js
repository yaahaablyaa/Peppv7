"use strict";
/** Manager analytics: two pay periods (1–15, 16–end) and the whole month. */
let analyticsMonth = uzbekistanToday().slice(0, 7);
let analyticsView = Number(uzbekistanToday().slice(8, 10)) <= 15 ? "p1" : "p2";
let analyticsBranch = "all";
let analyticsSort = "hours";
let analyticsData = null;
const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
function monthTitle(month) {
    const [y, m] = month.split("-");
    return `${MONTHS_NOM[Number(m) - 1] || ""} ${y}`;
}
function shiftMonthString(month, delta) {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function viewLabel(view) {
    return view === "p1" ? "1–15 число" : view === "p2" ? "16 — конец месяца" : "Весь месяц";
}
function delta(value, previous, lowerIsBetter = false) {
    if (value === null || previous === null)
        return "";
    if (previous === 0)
        return value === 0 ? "" : '<span class="delta delta--flat">нет базы</span>';
    const change = Math.round((value - previous) / previous * 100);
    if (change === 0)
        return '<span class="delta delta--flat">без изменений</span>';
    const good = (change > 0) !== lowerIsBetter;
    return `<span class="delta ${good ? "delta--good" : "delta--bad"}">${change > 0 ? "▲" : "▼"} ${Math.abs(change)}%</span>`;
}
function analyticsChart(d) {
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
function moneyShort(v) {
    if (v >= 1000000)
        return (Math.round(v / 100000) / 10).toString().replace(".", ",") + " млн";
    if (v >= 1000)
        return Math.round(v / 1000) + " тыс";
    return String(Math.round(v));
}
function analyticsEmployees(d) {
    if (!d.employees.length)
        return '<div class="section"><div class="empty">Сотрудников пока нет</div></div>';
    const rows = d.employees.slice().sort((a, b) => analyticsSort === "hours" ? b.minutes - a.minutes : analyticsSort === "late" ? b.late - a.late : b.missing - a.missing);
    const max = Math.max(1, ...rows.map((r) => r.minutes));
    return '<div class="section section--stagger">' + rows.map((e, i) => `<div class="an-emp" style="--i:${i}">${avatar(e.name)}<div class="an-emp-main"><div class="an-emp-top"><span class="an-emp-name">${esc(e.name)}</span>` +
        `<span class="an-emp-val">${d.payroll_visible && e.cost !== undefined ? esc(money(e.cost)) : esc(hoursText(e.hours))}</span></div>` +
        `<div class="an-emp-sub">${esc(e.position || "Сотрудник")} · ${d.payroll_visible ? esc(hoursText(e.hours)) + " · " : ""}смен ${e.attended}/${e.scheduled}</div>` +
        bar(Math.round(e.minutes / max * 100)) +
        `<div class="an-tags">${e.late ? `<span class="tag tag--warn">опозданий ${e.late}</span>` : ""}${e.missing ? `<span class="tag tag--bad">прогулов ${e.missing}</span>` : ""}${e.punctuality !== null && !e.late && !e.missing ? '<span class="tag tag--good">без замечаний</span>' : ""}</div>` +
        "</div></div>").join("") + "</div>";
}
function renderAnalytics(d) {
    const t = d.totals;
    const prev = d.previous ? d.previous.totals : null;
    const money = d.payroll_visible;
    const view = (d.view || analyticsView);
    const range = `${humanDate(d.start)} — ${humanDate(d.end)}`;
    let html = '<div class="screen"><button class="back-link" data-action="analytics-back">‹ Назад</button><div class="screen-title">Аналитика</div>';
    html += '<div class="screen-sub">Показатели команды по расчётным периодам.</div>';
    html += '<div class="month-nav"><button class="nav-arrow" data-action="an-month:-1" type="button" aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        `<div class="month-name">${esc(monthTitle(d.month || analyticsMonth))}</div>` +
        '<button class="nav-arrow" data-action="an-month:1" type="button" aria-label="Следующий месяц"${(d.month || analyticsMonth) >= uzbekistanToday().slice(0, 7) ? " disabled" : ""}><svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    html += segmented("analytics", [{ id: "p1", label: "1–15" }, { id: "p2", label: "16–конец" }, { id: "full", label: "Месяц" }], view, "an-view:");
    if (d.filters.branches.length > 1) {
        html += '<div class="chips chips--scroll"><button type="button" class="chip' + (analyticsBranch === "all" ? " chip--on" : "") + '" data-action="an-branch:all">Все филиалы</button>' +
            d.filters.branches.map((b) => `<button type="button" class="chip${analyticsBranch === String(b.id) ? " chip--on" : ""}" data-action="an-branch:${b.id}">${esc(b.name)}</button>`).join("") + "</div>";
    }
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
        html += '<div class="section-title">По филиалам</div><div class="section section--stagger">' + d.by_branch.map((b, i) => `<button type="button" class="an-branch" data-action="an-branch:${b.id}" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(b.name)}</span><span class="row-bar-val">${money && b.cost !== undefined ? esc(money_(b.cost)) : esc(hoursText(b.hours))}</span></div>` +
            `<div class="an-emp-sub">${b.staff} ${plural(b.staff, "сотрудник", "сотрудника", "сотрудников")} · ${esc(hoursText(b.hours))} · вовремя ${b.punctuality === null ? "—" : b.punctuality + "%"} · прогулов ${b.missing}</div>${bar(Math.round(b.hours / maxH * 100))}</button>`).join("") + "</div>";
    }
    if (d.by_position.length > 1) {
        const totalHours = d.by_position.reduce((s, p) => s + p.hours, 0) || 1;
        html += '<div class="section-title">По должностям</div><div class="section section--stagger">' + d.by_position.map((p, i) => `<div class="row-bar" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(p.position)} · ${p.staff}</span><span class="row-bar-val">${money && p.cost !== undefined ? esc(money_(p.cost)) : esc(hoursText(p.hours))}</span></div>${bar(Math.round(p.hours / totalHours * 100))}</div>`).join("") + "</div>";
    }
    html += '<div class="section-title">Сотрудники</div>';
    html += segmented("analytics-sort", [{ id: "hours", label: "Часы" }, { id: "late", label: "Опоздания" }, { id: "missing", label: "Прогулы" }], analyticsSort, "an-sort:");
    html += analyticsEmployees(d);
    html += `<div class="section-footer">Расчётные периоды: 1–15 число (выплата 25-го), 16 число — конец месяца (выплата 10-го следующего месяца). Считаются только закрытые смены.${money ? "" : " Суммы по зарплате видит только владелец."}</div>`;
    return html + "</div>";
}
function money_(v) { return money(v); }
function handleAnalyticsAction(action) {
    if (action.indexOf("an-view:") === 0) {
        const v = action.slice(8);
        if (v !== "p1" && v !== "p2" && v !== "full")
            return true;
        analyticsView = v;
        haptic("light");
        void loadAnalyticsKeep();
        return true;
    }
    if (action.indexOf("an-month:") === 0) {
        const dir = Number(action.slice(9));
        if (dir !== -1 && dir !== 1)
            return true;
        const next = shiftMonthString(analyticsMonth, dir);
        if (next > uzbekistanToday().slice(0, 7))
            return true;
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
    if (action.indexOf("an-sort:") === 0) {
        const s = action.slice(8);
        if (s !== "hours" && s !== "late" && s !== "missing")
            return true;
        analyticsSort = s;
        haptic("light");
        if (analyticsData)
            rerender(renderAnalytics(analyticsData));
        return true;
    }
    return false;
}
async function loadAnalyticsKeep() {
    try {
        const d = await api(`/analytics/overview?view=${analyticsView}&month=${analyticsMonth}&branch=${analyticsBranch}`);
        if (activeTab !== "analytics")
            return;
        if (d.error) {
            analyticsBranch = "all";
            return;
        }
        analyticsData = d;
        tabCache[tabKey("analytics")] = renderAnalytics(d);
        rerender(renderAnalytics(d));
    }
    catch (e) {
        tg.showAlert("Не удалось загрузить данные. Проверьте связь.");
    }
}
