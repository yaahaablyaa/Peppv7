"use strict";
/** График для команды: выбрать смену-«кисть», нажимать на клетки, затем сохранить одним подтверждением. */
const TEAM_BRUSHES = [
    { id: "morning", label: "Утро", letter: "У", start: "07:00", end: "17:00" },
    { id: "middle", label: "Промежуточный", letter: "П", start: "10:00", end: "20:00" },
    { id: "lunch", label: "Обед", letter: "О", start: "12:00", end: "22:00" },
    { id: "evening", label: "Вечер", letter: "В", start: "14:00", end: "00:00" },
    { id: "custom", label: "Своё", letter: "С", start: "09:00", end: "18:00" },
    { id: "off", label: "Выходной", letter: "·", off: true },
];
let teamBrushId = "middle";
let teamFilter = "all";
let teamRowMenu = 0;
let teamDraft = {};
let teamHistory = [];
let teamSaving = false;
let teamListenersReady = false;
let teamFilterOptions = [];
function teamBrush() {
    return TEAM_BRUSHES.find((b) => b.id === teamBrushId) || TEAM_BRUSHES[1];
}
function teamKey(employeeId, date) {
    return employeeId + ":" + date;
}
function shiftHours(start, end) {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0)
        minutes += 24 * 60;
    return minutes / 60;
}
function teamVisible(d) {
    return d.employees.filter((e) => teamFilter === "all" || e.position === teamFilter);
}
function teamLookup(d) {
    const map = {};
    d.shifts.forEach((s) => { map[teamKey(s.employee_id, s.date)] = s; });
    return map;
}
function brushLabel(b) {
    return b.off ? "Выходной" : `${b.start}–${b.end}`;
}
/** Which template a stored shift corresponds to (for colours). */
function brushOf(shift) {
    if (!shift || shift.is_day_off)
        return null;
    const st = shortTime(shift.start_time);
    const en = shortTime(shift.end_time);
    return TEAM_BRUSHES.find((b) => !b.off && b.id !== "custom" && b.start === st && b.end === en) || TEAM_BRUSHES[4];
}
function hourText(t) {
    const [h, m] = t.split(":");
    return m === "00" ? String(Number(h)) : `${Number(h)}:${m}`;
}
function teamDraftCount() {
    return Object.keys(teamDraft).length;
}
function teamHasDraft() {
    return teamDraftCount() > 0;
}
/* ------------------------------------------------------------- render */
function renderTeamSchedule(d) {
    const dates = scheduleDates(d.start);
    const shifts = teamLookup(d);
    const visible = teamVisible(d);
    const brush = teamBrush();
    const today = uzbekistanToday();
    const periodLabel = d.start.slice(8) === "01" ? "1–15" : `16–${d.end.slice(8)}`;
    const startDate = new Date(`${d.start}T00:00:00.000Z`);
    const arrowL = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const arrowR = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const editableAny = d.employees.some((e) => e.can_edit);
    let html = '<div class="screen team-schedule-screen"><div class="screen-title">График для команды</div>';
    html += `<div class="screen-sub">${editableAny ? "Выберите смену и нажимайте на клетки. Изменения не сохраняются сразу: проверьте график и нажмите «Сохранить». Нажатие на дату заполняет день для всех, нажатие на имя открывает действия для строки." : "У вас нет сотрудников, график которых вы ведёте. Таблица доступна только для просмотра."}</div>`;
    html += `<div class="team-schedule-toolbar"><button class="team-toolbar-button nav-arrow" data-action="team-range:-1" type="button" aria-label="Предыдущий период">${arrowL}</button><div class="team-period-title"><span>${MONTHS[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}</span><small>${periodLabel}</small></div><button class="team-toolbar-button nav-arrow" data-action="team-range:1" type="button" aria-label="Следующий период">${arrowR}</button></div>`;
    if (editableAny) {
        html += '<div class="team-palette" id="team-palette"><div class="palette-head"><span>Смена для клеток</span>' +
            `<span class="palette-state">${teamHasDraft() ? "Есть несохранённые изменения" : "Все изменения сохранены"}</span></div><div class="brushes">`;
        TEAM_BRUSHES.forEach((b) => {
            const on = b.id === teamBrushId;
            html += `<button type="button" class="brush brush--${b.id}${on ? " brush--on" : ""}" data-action="team-brush:${b.id}"><b>${esc(b.label)}</b><small>${b.off ? "без смены" : esc(brushLabel(b))}</small></button>`;
        });
        html += "</div>";
        if (brush.id === "custom") {
            html += '<div class="brush-custom"><label>С<input type="time" data-team-custom="start" value="' + esc(brush.start || "09:00") + '"></label>' +
                '<label>До<input type="time" data-team-custom="end" value="' + esc(brush.end || "18:00") + '"></label></div>';
        }
        html += '<div class="palette-foot"><span>Повторное нажатие на клетку с такой же сменой ставит выходной.</span></div></div>';
    }
    teamFilterOptions = [...new Set(d.employees.map((e) => e.position).filter(Boolean))].sort();
    if (teamFilterOptions.length > 1) {
        html += '<div class="chips chips--scroll"><button type="button" class="chip' + (teamFilter === "all" ? " chip--on" : "") + '" data-action="team-filter:all">Все</button>' +
            teamFilterOptions.map((p, i) => `<button type="button" class="chip${teamFilter === p ? " chip--on" : ""}" data-action="team-filter:${i}">${esc(p)}</button>`).join("") + "</div>";
    }
    const menuEmp = teamRowMenu ? d.employees.find((e) => e.id === teamRowMenu) : null;
    if (menuEmp && menuEmp.can_edit) {
        html += `<div class="section team-rowmenu"><div class="rowmenu-head"><b>${esc(menuEmp.name)}</b><span>${esc(menuEmp.position || "")}</span><button type="button" class="icon-btn" data-action="team-row:0" aria-label="Закрыть">✕</button></div>` +
            '<div class="rowmenu-actions">' +
            `<button type="button" class="chip" data-action="team-fill:${menuEmp.id}:weekdays">Пн–Пт: ${esc(brushLabel(brush))}</button>` +
            `<button type="button" class="chip" data-action="team-fill:${menuEmp.id}:all">Все дни: ${esc(brushLabel(brush))}</button>` +
            `<button type="button" class="chip" data-action="team-fill:${menuEmp.id}:off">Весь период выходной</button></div></div>`;
    }
    // legend
    html += '<div class="team-legend">' + TEAM_BRUSHES.filter((b) => !b.off && b.id !== "custom").map((b) => `<span class="lg lg--${b.id}"><i></i>${esc(b.label)} ${b.start && b.end ? hourText(b.start) + "–" + hourText(b.end) : ""}</span>`).join("") + "</div>";
    html += '<div class="team-table-card"><div class="team-table-wrap"><table class="team-table"><thead><tr><th class="team-name-head">Сотрудник</th>';
    dates.forEach((date) => {
        const weekday = DOW[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
        const wk = (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7 >= 5;
        html += `<th class="team-date-head${date === today ? " team-date-head--today" : ""}${wk ? " team-date-head--weekend" : ""}"${editableAny ? ` data-action="team-col:${date}"` : ""}><small>${weekday}</small><b>${date.slice(8)}</b></th>`;
    });
    html += '<th class="team-total-head">Часы</th></tr></thead><tbody>';
    if (!visible.length) {
        html += `<tr><td class="team-empty" colspan="${dates.length + 2}">Сотрудников пока нет</td></tr>`;
    }
    else {
        visible.forEach((employee) => {
            const editable = employee.can_edit !== false;
            let total = 0;
            html += `<tr><th class="team-name${teamRowMenu === employee.id ? " team-name--open" : ""}"${editable ? ` data-action="team-row:${employee.id}"` : ""}><span>${esc(employee.name)}</span><small>${esc(employee.position || "Должность не указана")}${editable ? "" : " · просмотр"}</small></th>`;
            dates.forEach((date) => {
                const shift = shifts[teamKey(employee.id, date)];
                const work = !!shift && !shift.is_day_off;
                const b = brushOf(shift);
                const changed = !!teamDraft[teamKey(employee.id, date)];
                if (work)
                    total += shiftHours(shortTime(shift.start_time), shortTime(shift.end_time));
                const inner = work && b
                    ? `<em>${b.letter}</em><span>${hourText(shortTime(shift.start_time))}–${hourText(shortTime(shift.end_time))}</span>`
                    : "<em>·</em>";
                html += `<td><button class="tcell${work && b ? " tcell--" + b.id : " tcell--off"}${changed ? " tcell--changed" : ""}${editable ? "" : " tcell--locked"}" ${editable ? `data-action="team-cell:${employee.id}:${date}"` : "disabled"} type="button" aria-label="${esc(employee.name)}, ${date}">${inner}</button></td>`;
            });
            html += `<td class="team-total">${total ? hoursText(total) : "—"}</td></tr>`;
        });
        html += '<tr class="team-cover"><th class="team-name"><span>На смене</span><small>человек в день</small></th>';
        dates.forEach((date) => {
            const n = visible.filter((e) => { const s = shifts[teamKey(e.id, date)]; return s && !s.is_day_off; }).length;
            html += `<td class="${n === 0 ? "cover--zero" : ""}">${n}</td>`;
        });
        html += '<td class="team-total"></td></tr>';
    }
    html += '</tbody></table></div></div>';
    html += '<div class="team-schedule-actions"><button class="team-export-button" data-action="team-export" type="button">' + icon("doc") + '<span>Скачать Excel</span></button></div>';
    html += '<div class="section-footer">Сотрудники получат одно уведомление об изменениях, а не по одному на каждую клетку.</div>';
    const n = teamDraftCount();
    html += `<div class="team-savebar${n ? " team-savebar--on" : ""}" id="team-savebar"><div class="sb-text"><b>${n}</b><small>${plural(n, "изменение", "изменения", "изменений")}</small></div>` +
        `<button type="button" class="sb-btn sb-btn--ghost" data-action="team-undo"${teamHistory.length ? "" : " disabled"}>Шаг назад</button>` +
        '<button type="button" class="sb-btn sb-btn--ghost" data-action="team-reset">Сбросить</button>' +
        `<button type="button" class="sb-btn sb-btn--main" data-action="team-save"${teamSaving ? " disabled" : ""}>${teamSaving ? "Сохраняем…" : "Сохранить"}</button></div>`;
    return html + "</div>";
}
function repaintTeam() {
    if (!teamScheduleData || !teamScheduleMode)
        return;
    const wrap = root().querySelector(".team-table-wrap");
    const left = wrap ? wrap.scrollLeft : 0;
    const chips = root().querySelector(".chips--scroll");
    const chipLeft = chips ? chips.scrollLeft : 0;
    rerender(renderTeamSchedule(teamScheduleData));
    const next = root().querySelector(".team-table-wrap");
    if (next)
        next.scrollLeft = left;
    const nextChips = root().querySelector(".chips--scroll");
    if (nextChips)
        nextChips.scrollLeft = chipLeft;
    const bar = document.getElementById("team-savebar");
    if (bar && teamHasDraft()) {
        bar.classList.remove("team-savebar--on");
        void bar.offsetWidth;
        bar.classList.add("team-savebar--on");
    }
}
/* ------------------------------------------------------------ editing */
function setLocalShift(d, patch) {
    d.shifts = d.shifts.filter((s) => !(s.employee_id === patch.employee_id && s.date === patch.date));
    d.shifts.push({
        employee_id: patch.employee_id,
        date: patch.date,
        start_time: patch.kind === "shift" ? patch.start_time : "",
        end_time: patch.kind === "shift" ? patch.end_time : "",
        is_day_off: patch.kind === "day_off" ? 1 : 0,
    });
}
function restoreLocal(d, entry) {
    const { employee_id, date } = entry.patch;
    d.shifts = d.shifts.filter((s) => !(s.employee_id === employee_id && s.date === date));
    if (entry.original)
        d.shifts.push(entry.original);
}
function sameAsOriginal(entry) {
    const o = entry.original;
    const p = entry.patch;
    if (p.kind === "day_off")
        return !o || !!o.is_day_off;
    return !!o && !o.is_day_off && shortTime(o.start_time) === p.start_time && shortTime(o.end_time) === p.end_time;
}
function applyTeamCells(cells, brush, toggle) {
    const d = teamScheduleData;
    if (!d || !cells.length)
        return;
    const shifts = teamLookup(d);
    const before = {};
    let changed = 0;
    cells.forEach((c) => {
        const emp = d.employees.find((e) => e.id === c.employeeId);
        if (!emp || !emp.can_edit)
            return;
        const key = teamKey(c.employeeId, c.date);
        const current = shifts[key] || null;
        const same = !!current && !current.is_day_off && !brush.off && shortTime(current.start_time) === brush.start && shortTime(current.end_time) === brush.end;
        const patch = brush.off || (toggle && same)
            ? { employee_id: c.employeeId, date: c.date, kind: "day_off", start_time: "", end_time: "" }
            : { employee_id: c.employeeId, date: c.date, kind: "shift", start_time: brush.start || "10:00", end_time: brush.end || "20:00" };
        const alreadyOff = patch.kind === "day_off" && (!current || !!current.is_day_off);
        if (alreadyOff)
            return;
        before[key] = teamDraft[key] || null;
        const original = teamDraft[key] ? teamDraft[key].original : current;
        const entry = { patch, original };
        setLocalShift(d, patch);
        if (sameAsOriginal(entry))
            delete teamDraft[key];
        else
            teamDraft[key] = entry;
        changed += 1;
    });
    if (!changed)
        return;
    teamHistory.push(before);
    if (teamHistory.length > 30)
        teamHistory.shift();
    haptic("light");
    repaintTeam();
}
function undoTeamStep() {
    const d = teamScheduleData;
    const last = teamHistory.pop();
    if (!d || !last)
        return;
    Object.keys(last).forEach((key) => {
        const [emp, date] = key.split(":");
        const prevEntry = last[key];
        const cur = teamDraft[key];
        if (prevEntry) {
            setLocalShift(d, prevEntry.patch);
            teamDraft[key] = prevEntry;
        }
        else if (cur) {
            restoreLocal(d, cur);
            delete teamDraft[key];
        }
        else {
            void emp;
            void date;
        }
    });
    haptic("light");
    repaintTeam();
}
function resetTeamDraft() {
    const d = teamScheduleData;
    if (!d)
        return;
    Object.keys(teamDraft).forEach((k) => restoreLocal(d, teamDraft[k]));
    teamDraft = {};
    teamHistory = [];
    repaintTeam();
}
function confirmSaveTeam() {
    const n = teamDraftCount();
    if (!n || teamSaving)
        return;
    tg.showConfirm(`Сохранить график (${n} ${plural(n, "изменение", "изменения", "изменений")})? Сотрудники получат уведомление.`, (ok) => { if (ok)
        void saveTeam(); });
}
async function saveTeam() {
    const items = Object.keys(teamDraft).map((k) => teamDraft[k].patch);
    if (!items.length || teamSaving)
        return true;
    teamSaving = true;
    repaintTeam();
    try {
        const r = await api("/schedule/team/batch", { method: "POST", body: JSON.stringify({ items }) });
        if (!r.ok)
            throw new Error("not_saved");
        teamDraft = {};
        teamHistory = [];
        teamSaving = false;
        haptic("success");
        repaintTeam();
        return true;
    }
    catch (e) {
        teamSaving = false;
        haptic("error");
        tg.showAlert("Не удалось сохранить график. Изменения остались в таблице, попробуйте ещё раз.");
        repaintTeam();
        return false;
    }
}
/** Leaving with unsaved changes asks first. Returns true when it is fine to go on. */
function teamLeaveGuard(proceed) {
    if (!teamHasDraft())
        return true;
    tg.showConfirm("Есть несохранённые изменения графика. Выйти без сохранения?", (ok) => {
        if (!ok)
            return;
        teamDraft = {};
        teamHistory = [];
        proceed();
    });
    return false;
}
function ensureTeamListeners() {
    if (teamListenersReady)
        return;
    teamListenersReady = true;
    root().addEventListener("change", (ev) => {
        const t = ev.target;
        if (!teamScheduleMode || !t.dataset || !t.dataset.teamCustom)
            return;
        const custom = TEAM_BRUSHES.find((b) => b.id === "custom");
        if (!custom || !/^\d{2}:\d{2}$/.test(t.value))
            return;
        if (t.dataset.teamCustom === "start")
            custom.start = t.value;
        else
            custom.end = t.value;
    });
}
function teamEnter() {
    ensureTeamListeners();
    teamRowMenu = 0;
    teamDraft = {};
    teamHistory = [];
}
/** Returns true when the action was handled here. */
function handleTeamAction(action) {
    if (action.indexOf("team-brush:") === 0) {
        const id = action.slice(11);
        if (TEAM_BRUSHES.some((b) => b.id === id)) {
            teamBrushId = id;
            haptic("light");
            repaintTeam();
        }
        return true;
    }
    if (action.indexOf("team-filter:") === 0) {
        const k = action.slice(12);
        teamFilter = k === "all" ? "all" : teamFilterOptions[Number(k)] || "all";
        repaintTeam();
        return true;
    }
    if (action.indexOf("team-cell:") === 0) {
        const [, employeeId, date] = action.split(":");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isInteger(Number(employeeId)))
            return true;
        applyTeamCells([{ employeeId: Number(employeeId), date }], teamBrush(), true);
        return true;
    }
    if (action.indexOf("team-col:") === 0 && teamScheduleData) {
        const date = action.slice(9);
        const cells = teamVisible(teamScheduleData).filter((e) => e.can_edit).map((e) => ({ employeeId: e.id, date }));
        applyTeamCells(cells, teamBrush(), false);
        return true;
    }
    if (action.indexOf("team-row:") === 0) {
        const id = Number(action.slice(9));
        teamRowMenu = teamRowMenu === id ? 0 : id;
        haptic("light");
        repaintTeam();
        return true;
    }
    if (action.indexOf("team-fill:") === 0 && teamScheduleData) {
        const [, id, mode] = action.split(":");
        const dates = scheduleDates(teamScheduleData.start).filter((date) => mode !== "weekdays" || ((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7) < 5);
        const brush = mode === "off" ? TEAM_BRUSHES[TEAM_BRUSHES.length - 1] : teamBrush();
        applyTeamCells(dates.map((date) => ({ employeeId: Number(id), date })), brush, false);
        return true;
    }
    if (action === "team-undo") {
        undoTeamStep();
        return true;
    }
    if (action === "team-reset") {
        tg.showConfirm("Сбросить все несохранённые изменения?", (ok) => { if (ok)
            resetTeamDraft(); });
        return true;
    }
    if (action === "team-save") {
        confirmSaveTeam();
        return true;
    }
    if (action.indexOf("team-range:") === 0) {
        const direction = Number(action.slice(11));
        if (direction !== -1 && direction !== 1)
            return true;
        const go = () => { moveTeamSchedulePeriod(direction); teamRowMenu = 0; void loadTeamSchedule(); };
        if (teamLeaveGuard(go))
            go();
        return true;
    }
    return false;
}
