/** График для команды: выбрать смену-«кисть» и нажимать на клетки. Сохранение пакетом, есть отмена. */

interface Brush { id: string; label: string; start?: string; end?: string; off?: boolean }
interface TeamPatch { employee_id: number; date: string; kind: "shift" | "day_off"; start_time: string; end_time: string }
interface TeamPrev { employee_id: number; date: string; prev: (ShiftRow & { employee_id: number }) | null }

const TEAM_BRUSHES: Brush[] = [
  { id: "morning", label: "Утро", start: "08:00", end: "16:00" },
  { id: "day", label: "День", start: "10:00", end: "22:00" },
  { id: "evening", label: "Вечер", start: "14:00", end: "23:00" },
  { id: "custom", label: "Своё", start: "09:00", end: "18:00" },
  { id: "off", label: "Выходной", off: true },
];

let teamBrushId = "day";
let teamFilter = "all";
let teamRowMenu = 0;
let teamPending: Record<string, TeamPatch> = {};
let teamUndoList: TeamPrev[] | null = null;
let teamSaving = false;
let teamFlushTimer = 0;
let teamListenersReady = false;
let teamFilterOptions: string[] = [];

function teamBrush(): Brush {
  return TEAM_BRUSHES.find((b) => b.id === teamBrushId) || TEAM_BRUSHES[1];
}

function teamKey(employeeId: number, date: string): string {
  return employeeId + ":" + date;
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

function teamVisible(d: TeamScheduleData): Array<StaffMember & { can_edit?: boolean }> {
  return d.employees.filter((e) => teamFilter === "all" || e.position === teamFilter);
}

function teamLookup(d: TeamScheduleData): Record<string, ShiftRow & { employee_id: number }> {
  const map: Record<string, ShiftRow & { employee_id: number }> = {};
  d.shifts.forEach((s) => { map[teamKey(s.employee_id, s.date)] = s; });
  return map;
}

function brushLabel(b: Brush): string {
  return b.off ? "Выходной" : `${b.start}–${b.end}`;
}

/* ------------------------------------------------------------- render */

function renderTeamSchedule(d: TeamScheduleData): string {
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
  html += `<div class="screen-sub">${editableAny ? "Выберите смену и нажимайте на клетки таблицы: она сразу запишется. Нажатие на дату заполняет день для всех, нажатие на имя открывает действия для строки." : "У вас нет сотрудников, график которых вы ведёте. Таблица доступна только для просмотра."}</div>`;
  html += `<div class="team-schedule-toolbar"><button class="team-toolbar-button nav-arrow" data-action="team-range:-1" type="button" aria-label="Предыдущий период">${arrowL}</button><div class="team-period-title"><span>${MONTHS[startDate.getUTCMonth()]} ${startDate.getUTCFullYear()}</span><small>${periodLabel}</small></div><button class="team-toolbar-button nav-arrow" data-action="team-range:1" type="button" aria-label="Следующий период">${arrowR}</button></div>`;

  if (editableAny) {
    html += '<div class="team-palette" id="team-palette"><div class="palette-head"><span>Смена для клеток</span>' +
      `<span class="palette-state" id="team-state">${teamSaving || Object.keys(teamPending).length ? "Сохраняем…" : "Все изменения сохранены"}</span></div><div class="brushes">`;
    TEAM_BRUSHES.forEach((b) => {
      const on = b.id === teamBrushId;
      html += `<button type="button" class="brush${on ? " brush--on" : ""}${b.off ? " brush--off" : ""}" data-action="team-brush:${b.id}"><b>${esc(b.label)}</b><small>${b.off ? "без смены" : esc(brushLabel(b))}</small></button>`;
    });
    html += "</div>";
    if (brush.id === "custom") {
      html += '<div class="brush-custom"><label>С<input type="time" data-team-custom="start" value="' + esc(brush.start || "09:00") + '"></label>' +
        '<label>До<input type="time" data-team-custom="end" value="' + esc(brush.end || "18:00") + '"></label></div>';
    }
    html += `<div class="palette-foot"><span>Повторное нажатие на клетку с такой же сменой ставит выходной.</span><button type="button" class="undo-btn" data-action="team-undo"${teamUndoList ? "" : " disabled"}>Отменить</button></div></div>`;
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

  html += '<div class="team-table-card"><div class="team-table-wrap"><table class="team-table"><thead><tr><th class="team-name-head">Сотрудник</th>';
  dates.forEach((date) => {
    const weekday = DOW[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
    html += `<th class="team-date-head${date === today ? " team-date-head--today" : ""}"${editableAny ? ` data-action="team-col:${date}"` : ""}><small>${weekday}</small><b>${date.slice(8)}</b></th>`;
  });
  html += '<th class="team-total-head">Часы</th></tr></thead><tbody>';
  if (!visible.length) {
    html += `<tr><td class="team-empty" colspan="${dates.length + 2}">Сотрудников пока нет</td></tr>`;
  } else {
    visible.forEach((employee) => {
      const editable = employee.can_edit !== false;
      let total = 0;
      html += `<tr><th class="team-name${teamRowMenu === employee.id ? " team-name--open" : ""}"${editable ? ` data-action="team-row:${employee.id}"` : ""}><span>${esc(employee.name)}</span><small>${esc(employee.position || "Должность не указана")}${editable ? "" : " · просмотр"}</small></th>`;
      dates.forEach((date) => {
        const shift = shifts[teamKey(employee.id, date)];
        const work = !!shift && !shift.is_day_off;
        if (work) total += shiftHours(shortTime(shift.start_time), shortTime(shift.end_time));
        const label = work ? `${shortTime(shift.start_time)}<br>${shortTime(shift.end_time)}` : "Выходной";
        html += `<td><button class="team-shift${work ? " team-shift--work" : " team-shift--off"}${editable ? "" : " team-shift--locked"}" ${editable ? `data-action="team-cell:${employee.id}:${date}"` : "disabled"} type="button">${label}</button></td>`;
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
  html += '<div class="section-footer">Сотрудники получают одно уведомление об изменениях, а не по одному на каждую клетку.</div></div>';
  return html;
}

function repaintTeam(): void {
  if (!teamScheduleData || !teamScheduleMode) return;
  const wrap = root().querySelector<HTMLElement>(".team-table-wrap");
  const left = wrap ? wrap.scrollLeft : 0;
  const chips = root().querySelector<HTMLElement>(".chips--scroll");
  const chipLeft = chips ? chips.scrollLeft : 0;
  rerender(renderTeamSchedule(teamScheduleData));
  const next = root().querySelector<HTMLElement>(".team-table-wrap");
  if (next) next.scrollLeft = left;
  const nextChips = root().querySelector<HTMLElement>(".chips--scroll");
  if (nextChips) nextChips.scrollLeft = chipLeft;
}

function teamSetState(): void {
  const el = document.getElementById("team-state");
  if (el) el.textContent = teamSaving || Object.keys(teamPending).length ? "Сохраняем…" : "Все изменения сохранены";
}

/* ------------------------------------------------------------ editing */

function setLocalShift(d: TeamScheduleData, patch: TeamPatch): void {
  d.shifts = d.shifts.filter((s) => !(s.employee_id === patch.employee_id && s.date === patch.date));
  d.shifts.push({
    employee_id: patch.employee_id,
    date: patch.date,
    start_time: patch.kind === "shift" ? patch.start_time : "",
    end_time: patch.kind === "shift" ? patch.end_time : "",
    is_day_off: patch.kind === "day_off" ? 1 : 0,
  } as ShiftRow & { employee_id: number });
}

function applyTeamCells(cells: { employeeId: number; date: string }[], brush: Brush, toggle: boolean): void {
  const d = teamScheduleData;
  if (!d || !cells.length) return;
  const shifts = teamLookup(d);
  const prev: TeamPrev[] = [];
  let changed = 0;
  cells.forEach((c) => {
    const emp = d.employees.find((e) => e.id === c.employeeId);
    if (!emp || !emp.can_edit) return;
    const current = shifts[teamKey(c.employeeId, c.date)] || null;
    let patch: TeamPatch;
    const same = !!current && !current.is_day_off && !brush.off && shortTime(current.start_time) === brush.start && shortTime(current.end_time) === brush.end;
    if (brush.off || (toggle && same)) patch = { employee_id: c.employeeId, date: c.date, kind: "day_off", start_time: "", end_time: "" };
    else patch = { employee_id: c.employeeId, date: c.date, kind: "shift", start_time: brush.start || "10:00", end_time: brush.end || "22:00" };
    const alreadyOff = patch.kind === "day_off" && (!current || !!current.is_day_off) && !!current;
    if (alreadyOff) return;
    prev.push({ employee_id: c.employeeId, date: c.date, prev: current });
    setLocalShift(d, patch);
    teamPending[teamKey(c.employeeId, c.date)] = patch;
    changed += 1;
  });
  if (!changed) return;
  teamUndoList = prev;
  haptic("light");
  repaintTeam();
  scheduleTeamFlush();
}

function scheduleTeamFlush(): void {
  window.clearTimeout(teamFlushTimer);
  teamFlushTimer = window.setTimeout(() => { void flushTeam(); }, 900);
}

async function flushTeam(): Promise<void> {
  window.clearTimeout(teamFlushTimer);
  const items = Object.keys(teamPending).map((k) => teamPending[k]);
  if (!items.length || teamSaving) return;
  teamPending = {};
  teamSaving = true;
  teamSetState();
  try {
    const r = await api<{ ok: boolean; applied?: number }>("/schedule/team/batch", { method: "POST", body: JSON.stringify({ items }) });
    if (!r.ok) throw new Error("not_saved");
    haptic("success");
  } catch (e) {
    teamUndoList = null;
    tg.showAlert("Не удалось сохранить часть изменений. Таблица обновлена из базы.");
    haptic("error");
    teamSaving = false;
    void loadTeamSchedule();
    return;
  }
  teamSaving = false;
  if (Object.keys(teamPending).length) { void flushTeam(); return; }
  teamSetState();
}

function undoTeam(): void {
  const d = teamScheduleData;
  if (!d || !teamUndoList) return;
  const list = teamUndoList;
  teamUndoList = null;
  list.forEach((p) => {
    const patch: TeamPatch = p.prev && !p.prev.is_day_off
      ? { employee_id: p.employee_id, date: p.date, kind: "shift", start_time: shortTime(p.prev.start_time), end_time: shortTime(p.prev.end_time) }
      : { employee_id: p.employee_id, date: p.date, kind: "day_off", start_time: "", end_time: "" };
    setLocalShift(d, patch);
    teamPending[teamKey(p.employee_id, p.date)] = patch;
  });
  haptic("light");
  repaintTeam();
  scheduleTeamFlush();
}

function ensureTeamListeners(): void {
  if (teamListenersReady) return;
  teamListenersReady = true;
  root().addEventListener("change", (ev) => {
    const t = ev.target as HTMLInputElement;
    if (!teamScheduleMode || !t.dataset || !t.dataset.teamCustom) return;
    const custom = TEAM_BRUSHES.find((b) => b.id === "custom");
    if (!custom || !/^\d{2}:\d{2}$/.test(t.value)) return;
    if (t.dataset.teamCustom === "start") custom.start = t.value; else custom.end = t.value;
  });
}

function teamEnter(): void {
  ensureTeamListeners();
  teamRowMenu = 0;
  teamUndoList = null;
}

/** Returns true when the action was handled here. */
function handleTeamAction(action: string): boolean {
  if (action.indexOf("team-brush:") === 0) {
    const id = action.slice(11);
    if (TEAM_BRUSHES.some((b) => b.id === id)) { teamBrushId = id; haptic("light"); repaintTeam(); }
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isInteger(Number(employeeId))) return true;
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
  if (action === "team-undo") { undoTeam(); return true; }
  if (action.indexOf("team-range:") === 0) {
    const direction = Number(action.slice(11));
    if (direction !== -1 && direction !== 1) return true;
    void flushTeam().then(() => {
      moveTeamSchedulePeriod(direction);
      teamRowMenu = 0;
      teamUndoList = null;
      void loadTeamSchedule();
    });
    return true;
  }
  return false;
}
