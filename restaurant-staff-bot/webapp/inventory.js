"use strict";
/** Инвентаризация: остатки, приход/списание, пересчёт по отделам, журнал. */
let invTab = "stock";
let invScreen = "main";
let invData = null;
let invDept = "all";
let invQuery = "";
let invItemId = 0;
let invKind = "in";
let invCount = null;
let invHistory = null;
let invMoves = null;
let invItemMoves = null;
let invBranch = "";
let invShowAll = false;
let invCountQuery = "";
let invListenersReady = false;
let invBusy = false;
let invNewDept = "";
/* ------------------------------------------------------------ helpers */
function fmtQty(n) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n);
}
function fmtSigned(n) {
    return (n > 0 ? "+" : n < 0 ? "−" : "") + fmtQty(Math.abs(n));
}
function parseQty(raw) {
    const t = String(raw || "").replace(/\s/g, "").replace(",", ".");
    if (t === "")
        return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
}
/** Server timestamps are UTC; the restaurant works in UTC+5. */
function invStamp(value) {
    if (!value)
        return "";
    const d = new Date(value.replace(" ", "T") + "Z");
    if (Number.isNaN(d.getTime()))
        return value;
    const local = new Date(d.getTime() + 5 * 3600000).toISOString();
    return `${humanDate(local.slice(0, 10))}, ${local.slice(11, 16)}`;
}
function invBranchQuery() {
    return invBranch ? "branch=" + encodeURIComponent(invBranch) : "";
}
function invItem(id) {
    return invData ? invData.items.find((i) => i.id === id) : undefined;
}
function invSelect(name, options, selected) {
    return `<select name="${name}">` + options.map((o) => `<option value="${esc(o)}"${o === selected ? " selected" : ""}>${esc(o)}</option>`).join("") + "</select>";
}
function stockBadge(i) {
    if (i.empty)
        return '<span class="status status--bad">Нет</span>';
    if (i.low)
        return '<span class="status status--warn">Мало</span>';
    return "";
}
function diffChip(diff, unit) {
    if (diff === null)
        return '<span class="dchip dchip--none">не считали</span>';
    if (Math.abs(diff) < 1e-9)
        return '<span class="dchip dchip--ok">Совпало ✓</span>';
    return diff < 0
        ? `<span class="dchip dchip--bad">Недостача ${fmtSigned(diff)} ${esc(unit)}</span>`
        : `<span class="dchip dchip--warn">Излишек ${fmtSigned(diff)} ${esc(unit)}</span>`;
}
function invHead(title, sub, back, wide) {
    return `<div class="screen${wide ? " screen--wide" : ""}"><button class="back-link" data-action="${back}">‹ Назад</button><div class="screen-title">${esc(title)}</div><div class="screen-sub">${esc(sub)}</div>`;
}
/* -------------------------------------------------------------- main */
function stockList() {
    const d = invData;
    const q = invQuery.trim().toLowerCase();
    const items = d.items.filter((i) => (invDept === "all" || i.department === invDept) && (!q || i.name.toLowerCase().indexOf(q) >= 0));
    if (!d.items.length) {
        return '<div class="section"><div class="empty">Позиций пока нет.' + (d.can_edit ? " Нажмите «Добавить позицию», чтобы завести первую." : "") + "</div></div>";
    }
    if (!items.length)
        return '<div class="section"><div class="empty">Ничего не найдено</div></div>';
    const groups = {};
    items.forEach((i) => { (groups[i.department] = groups[i.department] || []).push(i); });
    let html = "";
    d.departments.filter((n) => groups[n]).forEach((dept) => {
        if (invDept === "all" && d.departments.length > 1)
            html += `<div class="section-title">${esc(dept)}</div>`;
        html += '<div class="section section--stagger">' + groups[dept].map((i, n) => `<button type="button" class="inv-row" data-action="inv-item:${i.id}" style="--i:${Math.min(n, 12)}">` +
            `<div class="inv-main"><div class="inv-name">${esc(i.name)}</div><div class="inv-sub">${i.min_qty > 0 ? "Минимум " + fmtQty(i.min_qty) + " " + esc(i.unit) : "Минимум не задан"}${d.money && i.value ? " · " + esc(money(i.value)) : ""}</div></div>` +
            `<div class="inv-qty${i.empty ? " inv-qty--bad" : i.low ? " inv-qty--warn" : ""}"><b>${fmtQty(i.qty)}</b><small>${esc(i.unit)}</small></div>${stockBadge(i)}<span class="inv-chev">${icon("chevron")}</span></button>`).join("") + "</div>";
    });
    return html;
}
function stockTab(d) {
    let html = '<div class="stat-grid inv-stats">' +
        `<div class="stat"><div class="stat-value" ${countAttr(d.summary.items, "int")}>${d.summary.items}</div><div class="stat-label">Позиций на складе</div></div>` +
        `<div class="stat"><div class="stat-value${d.summary.low ? " stat-value--bad" : ""}" ${countAttr(d.summary.low, "int")}>${d.summary.low}</div><div class="stat-label">Заканчивается</div></div>` +
        (d.money && d.summary.value !== undefined ? `<div class="stat inv-stat-wide"><div class="stat-value" ${countAttr(d.summary.value, "money")}>${esc(money(d.summary.value))}</div><div class="stat-label">Стоимость остатков</div></div>` : "") +
        "</div>";
    if (d.departments.length > 1) {
        html += '<div class="chips chips--scroll"><button type="button" class="chip' + (invDept === "all" ? " chip--on" : "") + '" data-action="inv-dept:all">Все отделы</button>' +
            d.departments.map((n, i) => `<button type="button" class="chip${invDept === n ? " chip--on" : ""}" data-action="inv-dept:${i}">${esc(n)}</button>`).join("") + "</div>";
    }
    html += `<div class="searchbox">${icon("search")}<input id="inv-search" type="search" placeholder="Найти позицию" value="${esc(invQuery)}" autocomplete="off"></div>`;
    if (d.can_edit)
        html += '<button type="button" class="button inv-add" data-action="inv-new">+ Добавить позицию</button>';
    html += '<div id="inv-list">' + stockList() + "</div>";
    html += '<div class="section-footer">Красная и жёлтая метка появляются, когда остаток ниже или равен минимуму. Минимум задаётся в карточке позиции.</div>';
    return html;
}
function countTab(d) {
    let html = '<div class="section inv-howto"><div class="inv-howto-title">Как проходит инвентаризация</div>' +
        '<div class="steps"><div class="step"><b>1</b><span>Выберите отдел и нажмите «Начать». Система запомнит, сколько должно быть по учёту.</span></div>' +
        '<div class="step"><b>2</b><span>Пересчитайте товар и введите, сколько есть на самом деле.</span></div>' +
        '<div class="step"><b>3</b><span>Завершите пересчёт: остатки обновятся, а отчёт о недостачах и излишках сохранится.</span></div></div></div>';
    if (d.open_counts.length) {
        html += '<div class="section-title">Незавершённые</div><div class="section section--stagger">' + d.open_counts.map((c, i) => `<button type="button" class="inv-row" data-action="inv-open:${c.id}" style="--i:${i}"><div class="inv-main"><div class="inv-name">${esc(c.department)}</div>` +
            `<div class="inv-sub">Посчитано ${c.counted} из ${c.total} · начал ${esc(c.by_name || "—")}</div>${bar(pct(c.counted, c.total))}</div><span class="status status--warn">Продолжить</span><span class="inv-chev">${icon("chevron")}</span></button>`).join("") + "</div>";
    }
    if (d.editable_departments.length) {
        html += '<div class="section-title">Начать пересчёт</div><div class="section section--stagger">' + d.editable_departments.map((n, i) => {
            const count = d.items.filter((it) => it.department === n).length;
            const open = d.open_counts.some((c) => c.department === n);
            return `<button type="button" class="inv-row" data-action="inv-start:${i}" style="--i:${i}"><div class="cell-icon" data-i="box">${icon("box")}</div>` +
                `<div class="inv-main"><div class="inv-name">${esc(n)}</div><div class="inv-sub">${count ? count + " " + plural(count, "позиция", "позиции", "позиций") : "Нет позиций"}</div></div>` +
                `<span class="status status--${open ? "warn" : "none"}">${open ? "Идёт пересчёт" : "Начать"}</span><span class="inv-chev">${icon("chevron")}</span></button>`;
        }).join("") + "</div>";
    }
    else {
        html += '<div class="section-footer">Ваша роль позволяет только смотреть отчёты. Пересчёт запускают менеджер, шеф-повар и бар-менеджер.</div>';
    }
    html += '<div class="section-title">Прошлые пересчёты</div>';
    if (invHistory === null)
        html += '<div class="skeleton skeleton--block"></div>';
    else if (!invHistory.length)
        html += '<div class="section"><div class="empty">Завершённых пересчётов пока нет</div></div>';
    else {
        html += '<div class="section section--stagger">' + invHistory.map((h, i) => `<button type="button" class="inv-row" data-action="inv-report:${h.id}" style="--i:${Math.min(i, 10)}"><div class="inv-main"><div class="inv-name">${esc(h.department)} · ${esc(invStamp(h.finished_at))}</div>` +
            `<div class="inv-sub">${esc(h.by_name || "—")} · посчитано ${h.counted_items}</div></div>` +
            (h.diff_items ? `<span class="status status--${h.shortage > 0 ? "bad" : "warn"}">${h.diff_items} ${plural(h.diff_items, "расхождение", "расхождения", "расхождений")}</span>` : '<span class="status status--good">Без расхождений</span>') +
            `<span class="inv-chev">${icon("chevron")}</span></button>`).join("") + "</div>";
    }
    return html;
}
function logTab() {
    if (invMoves === null)
        return '<div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div>';
    if (!invMoves.length)
        return '<div class="section"><div class="empty">Движений пока нет. Здесь будет видно каждый приход, списание и корректировку по пересчёту.</div></div>';
    return '<div class="section section--stagger">' + invMoves.map((m, i) => moveRow(m, i, true)).join("") + "</div>";
}
function moveRow(m, i, withName) {
    const sign = m.qty > 0 ? "plus" : "minus";
    const kindTitle = m.kind === "adjust" ? "Корректировка" : m.kind === "in" ? "Приход" : "Списание";
    return `<div class="mv" style="--i:${Math.min(i, 12)}"><span class="mv-dot mv-dot--${m.kind === "adjust" ? "adj" : sign}">${m.kind === "adjust" ? "⇄" : m.qty > 0 ? "+" : "−"}</span>` +
        `<div class="mv-main"><div class="mv-title">${withName ? esc(m.name) : kindTitle}</div><div class="mv-sub">${withName ? kindTitle + " · " : ""}${esc(m.reason)}${m.note ? " · " + esc(m.note) : ""} · ${esc(m.by_name || "—")} · ${esc(invStamp(m.created_at))}</div></div>` +
        `<div class="mv-val mv-val--${sign}"><b>${fmtSigned(m.qty)}</b><small>${esc(m.unit)} · ост. ${fmtQty(m.balance)}</small></div></div>`;
}
function renderInventory() {
    const d = invData;
    let html = invHead("Инвентаризация", "Остатки, приход и списание, пересчёт по отделам.", "inventory-back", true);
    if (d.branches.length > 1) {
        html += '<div class="chips chips--scroll">' + d.branches.map((b) => `<button type="button" class="chip${d.branch === b.id ? " chip--on" : ""}" data-action="inv-branch:${b.id}">${esc(b.name)}</button>`).join("") + "</div>";
    }
    html += segmented("inventory", [{ id: "stock", label: "Остатки" }, { id: "count", label: "Пересчёт" }, { id: "log", label: "Журнал" }], invTab, "inv-tab:");
    html += invTab === "stock" ? stockTab(d) : invTab === "count" ? countTab(d) : logTab();
    return html + "</div>";
}
/* -------------------------------------------------------------- item */
function renderItem() {
    const d = invData;
    const item = invItem(invItemId);
    if (!item)
        return invHead("Позиция", "Позиция не найдена", "inv-back") + '<div class="section"><div class="empty">Позиция удалена или недоступна.</div></div></div>';
    const editable = d.editable_departments.indexOf(item.department) >= 0;
    let html = invHead(item.name, `${item.department} · единица: ${item.unit}`, "inv-back");
    html += `<div class="hero ${item.empty ? "hero--bad" : item.low ? "hero--low" : ""}"><div class="hero-label">Сейчас на складе ${stockBadge(item)}</div>` +
        `<div class="hero-value">${fmtQty(item.qty)} <span class="hero-unit">${esc(item.unit)}</span></div>` +
        `<div class="hero-sub">${item.min_qty > 0 ? "Минимум " + fmtQty(item.min_qty) + " " + esc(item.unit) : "Минимальный остаток не задан"}${d.money && item.value ? " · на " + esc(money(item.value)) : ""}</div></div>`;
    if (editable) {
        const reasons = invKind === "in" ? d.in_reasons : d.out_reasons;
        html += '<div class="section-title">Изменить остаток</div>' +
            segmented("inv-kind", [{ id: "in", label: "Приход" }, { id: "out", label: "Списание" }], invKind, "inv-kind:") +
            '<form class="section staff-form staff-form--card" id="inv-move-form">' +
            `<label class="field"><span class="field-label">Количество, ${esc(item.unit)}</span><input name="qty" inputmode="decimal" autocomplete="off" placeholder="Например, 2,5" required></label>` +
            `<label class="field"><span class="field-label">Причина</span>${invSelect("reason", reasons)}</label>` +
            '<label class="field"><span class="field-label">Комментарий</span><input name="note" maxlength="200" placeholder="Необязательно"></label>' +
            `<button class="button staff-submit${invKind === "out" ? " button--danger" : ""}" type="submit">${invKind === "in" ? "Записать приход" : "Списать"}</button></form>`;
    }
    html += '<div class="section-title">История позиции</div>';
    if (invItemMoves === null)
        html += '<div class="skeleton skeleton--block"></div>';
    else if (!invItemMoves.length)
        html += '<div class="section"><div class="empty">Движений по этой позиции ещё не было</div></div>';
    else
        html += '<div class="section">' + invItemMoves.slice(0, 20).map((m, i) => moveRow(m, i, false)).join("") + "</div>";
    if (editable) {
        html += '<div class="section-title">Настройки позиции</div><form class="section staff-form staff-form--card" id="inv-edit-form">' +
            `<label class="field"><span class="field-label">Название</span><input name="name" maxlength="80" value="${esc(item.name)}" required></label>` +
            `<label class="field"><span class="field-label">Единица</span>${invSelect("unit", d.units, item.unit)}</label>` +
            `<label class="field"><span class="field-label">Минимальный остаток</span><input name="min_qty" inputmode="decimal" value="${item.min_qty ? fmtQty(item.min_qty).replace(/\s/g, "") : ""}" placeholder="0 — не следить"></label>` +
            (d.money ? `<label class="field"><span class="field-label">Цена за единицу, сум</span><input name="unit_cost" inputmode="decimal" value="${item.unit_cost ? String(item.unit_cost) : ""}" placeholder="Для расчёта недостачи"></label>` : "") +
            '<button class="button staff-submit" type="submit">Сохранить</button></form>' +
            '<button type="button" class="button button--secondary inv-delete" data-action="inv-delete">Удалить позицию</button>';
    }
    return html + "</div>";
}
function presetChips(dept) {
    const d = invData;
    const list = (d.presets && d.presets[dept]) || [];
    if (!list.length)
        return "";
    return '<div class="preset-label">Быстрый выбор</div><div class="chips">' +
        list.map((p, i) => `<button type="button" class="chip chip--ghost" data-action="inv-preset:${i}">${esc(p[0])}</button>`).join("") + "</div>";
}
function renderNewItem() {
    const d = invData;
    const dept = d.editable_departments.indexOf(invNewDept) >= 0 ? invNewDept : d.editable_departments.indexOf(invDept) >= 0 ? invDept : d.editable_departments[0];
    invNewDept = dept;
    const hints = { Посуда: "Тарелки, бокалы, приборы: считаются поштучно, бой списывается с причиной «Разбито».", Хозтовары: "Салфетки, моющие средства, мешки и всё, что расходуется в зале и на кухне." };
    return invHead("Новая позиция", "Добавьте товар, который нужно учитывать на складе.", "inv-back") +
        '<form class="section staff-form staff-form--card" id="inv-new-form">' +
        `<label class="field"><span class="field-label">Отдел</span>${invSelect("department", d.editable_departments, dept)}</label>` +
        `<div class="field field--hint" id="inv-dept-hint">${esc(hints[dept] || "")}</div>` +
        `<div class="field field--presets" id="inv-presets">${presetChips(dept)}</div>` +
        '<label class="field"><span class="field-label">Название</span><input name="name" maxlength="80" placeholder="Например, Тарелка обеденная" required></label>' +
        `<label class="field"><span class="field-label">Единица измерения</span>${invSelect("unit", d.units)}</label>` +
        '<label class="field"><span class="field-label">Сейчас на складе</span><input name="qty" inputmode="decimal" placeholder="0"></label>' +
        '<label class="field"><span class="field-label">Минимальный остаток</span><input name="min_qty" inputmode="decimal" placeholder="Когда остаток ниже, появится метка «Мало»"></label>' +
        (d.money ? '<label class="field"><span class="field-label">Цена за единицу, сум</span><input name="unit_cost" inputmode="decimal" placeholder="Необязательно"></label>' : "") +
        '<button class="button staff-submit" type="submit">Добавить позицию</button></form></div>';
}
/* ------------------------------------------------------------- count */
function countRow(l, editable) {
    return `<div class="crow" data-line-row="${l.id}"><div class="crow-main"><div class="crow-name">${esc(l.name)}</div>` +
        `<div class="crow-exp">По учёту: ${fmtQty(l.expected)} ${esc(l.unit)}</div><div class="crow-diff" data-diff="${l.id}">${diffChip(l.diff, l.unit)}</div></div>` +
        (editable
            ? `<div class="crow-input"><input class="count-input" data-line="${l.id}" inputmode="decimal" autocomplete="off" placeholder="Факт" value="${l.actual === null ? "" : fmtQty(l.actual).replace(/\s/g, "")}"><button type="button" class="same-btn" data-action="inv-same:${l.id}" aria-label="Совпадает с учётом">✓</button></div>`
            : `<div class="crow-fact">${l.actual === null ? "—" : fmtQty(l.actual) + " " + esc(l.unit)}</div>`) + "</div>";
}
function countHead(c) {
    const p = pct(c.counted, c.total);
    const s = c.summary;
    return `<div class="hero hero--ring" id="inv-count-head"><div>${ring(p, 76)}</div><div class="hero-ring-text"><div class="hero-label">Посчитано</div>` +
        `<div class="hero-value">${c.counted} из ${c.total}</div><div class="hero-sub">${s.diff_items ? "Расхождений: " + s.diff_items : "Расхождений пока нет"}` +
        `${c.money && s.shortage > 0 ? " · недостача " + esc(money(s.shortage)) : ""}</div></div></div>`;
}
function countLinesHtml(c) {
    const q = invCountQuery.trim().toLowerCase();
    const lines = c.lines.filter((l) => !q || l.name.toLowerCase().indexOf(q) >= 0);
    if (!lines.length)
        return '<div class="section"><div class="empty">Ничего не найдено</div></div>';
    return '<div class="section crows">' + lines.map((l) => countRow(l, c.can_edit)).join("") + "</div>";
}
function renderCount() {
    const c = invCount;
    let html = invHead(`Пересчёт · ${c.department}`, "Введите, сколько реально есть. Пустое поле — позиция не считается. Кнопка ✓ — «столько же, сколько по учёту».", "inv-back");
    html += countHead(c);
    html += `<div class="searchbox">${icon("search")}<input id="inv-count-search" type="search" placeholder="Найти позицию" value="${esc(invCountQuery)}" autocomplete="off"></div>`;
    html += '<div id="inv-count-list">' + countLinesHtml(c) + "</div>";
    if (c.can_edit) {
        html += '<div class="inv-actions"><button type="button" class="button inv-finish" data-action="inv-finish">Завершить пересчёт</button>' +
            '<button type="button" class="button button--secondary inv-delete" data-action="inv-cancel">Отменить пересчёт</button></div>' +
            '<div class="section-footer">После завершения остатки обновятся по введённым значениям, а несчитанные позиции останутся без изменений.</div>';
    }
    return html + "</div>";
}
function renderReport() {
    const c = invCount;
    const s = c.summary;
    let html = invHead(`Отчёт · ${c.department}`, `${invStamp(c.finished_at)} · провёл ${c.finished_by || "—"}`, "inv-back");
    html += '<div class="stat-grid">' +
        `<div class="stat"><div class="stat-value">${c.counted}</div><div class="stat-label">Посчитано позиций</div></div>` +
        `<div class="stat"><div class="stat-value${s.diff_items ? " stat-value--bad" : ""}">${s.diff_items}</div><div class="stat-label">С расхождением</div></div>` +
        (c.money ? `<div class="stat"><div class="stat-value stat-value--bad">${esc(money(s.shortage))}</div><div class="stat-label">Недостача</div></div><div class="stat"><div class="stat-value">${esc(money(s.surplus))}</div><div class="stat-label">Излишек</div></div>` : "") + "</div>";
    const counted = c.lines.filter((l) => l.actual !== null);
    const diffs = counted.filter((l) => l.diff !== null && Math.abs(l.diff) > 1e-9);
    const shown = invShowAll ? c.lines : diffs;
    html += `<div class="section-title">${invShowAll ? "Все позиции" : "Расхождения"}</div>`;
    if (!shown.length)
        html += `<div class="section"><div class="empty">${invShowAll ? "Позиций нет" : "Расхождений нет — всё сошлось 🎉"}</div></div>`;
    else {
        html += '<div class="section section--stagger">' + shown.map((l, i) => `<div class="rrow" style="--i:${Math.min(i, 12)}"><div class="rrow-main"><div class="crow-name">${esc(l.name)}</div>` +
            `<div class="crow-exp">Учёт ${fmtQty(l.expected)} → факт ${l.actual === null ? "—" : fmtQty(l.actual) + " " + esc(l.unit)}</div></div>` +
            `<div class="rrow-diff">${diffChip(l.diff, l.unit)}${c.money && l.diff_value ? `<small>${l.diff_value > 0 ? "+" : "−"}${esc(money(Math.abs(l.diff_value)))}</small>` : ""}</div></div>`).join("") + "</div>";
    }
    html += `<button type="button" class="link-btn" data-action="inv-showall">${invShowAll ? "Показать только расхождения" : "Показать все позиции"}</button>`;
    if (c.money && c.lines.some((l) => l.diff_value === 0 && l.diff !== null && Math.abs(l.diff) > 1e-9)) {
        html += '<div class="section-footer">У части позиций не указана цена, поэтому их расхождение не попало в сумму. Цену можно задать в карточке позиции.</div>';
    }
    return html + "</div>";
}
/* ----------------------------------------------------------- loading */
function paintInventory() {
    let html = "";
    if (invScreen === "main")
        html = renderInventory();
    else if (invScreen === "item")
        html = renderItem();
    else if (invScreen === "new")
        html = renderNewItem();
    else if (invScreen === "count")
        html = invCount ? renderCount() : skeleton(3);
    else
        html = invCount ? renderReport() : skeleton(3);
    rerender(html);
}
async function loadInventory(skeletonFirst) {
    if (skeletonFirst !== false)
        root().innerHTML = skeleton(3);
    try {
        const d = await api("/inventory" + (invBranchQuery() ? "?" + invBranchQuery() : ""));
        if (d.error)
            return void (root().innerHTML = noAccess());
        invData = d;
        if (!invBranch)
            invBranch = String(d.branch);
        if (!inventoryMode)
            return;
        if (invScreen === "main") {
            if (invTab === "count")
                void loadInvHistory();
            if (invTab === "log")
                void loadInvMoves();
        }
        if (skeletonFirst === false)
            paintInventory();
        else {
            root().innerHTML = renderForScreen();
        }
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить склад. Проверьте связь.");
    }
}
function renderForScreen() {
    if (invScreen === "item")
        return renderItem();
    if (invScreen === "new")
        return renderNewItem();
    if (invScreen === "count")
        return invCount ? renderCount() : skeleton(3);
    if (invScreen === "report")
        return invCount ? renderReport() : skeleton(3);
    return renderInventory();
}
async function loadInvHistory() {
    try {
        const r = await api("/inventory/counts" + (invBranchQuery() ? "?" + invBranchQuery() : ""));
        invHistory = r.error ? [] : r.counts;
    }
    catch (e) {
        invHistory = [];
    }
    if (inventoryMode && invScreen === "main" && invTab === "count" && invData)
        paintInventory();
}
async function loadInvMoves() {
    try {
        const r = await api("/inventory/moves" + (invBranchQuery() ? "?" + invBranchQuery() : ""));
        invMoves = r.error ? [] : r.moves;
    }
    catch (e) {
        invMoves = [];
    }
    if (inventoryMode && invScreen === "main" && invTab === "log" && invData)
        paintInventory();
}
async function loadInvItemMoves(id) {
    try {
        const r = await api("/inventory/moves?item_id=" + id + (invBranchQuery() ? "&" + invBranchQuery() : ""));
        invItemMoves = r.error ? [] : r.moves;
    }
    catch (e) {
        invItemMoves = [];
    }
    if (inventoryMode && invScreen === "item" && invItemId === id)
        paintInventory();
}
async function loadInvCount(id, screen) {
    invScreen = screen;
    invCount = null;
    root().innerHTML = skeleton(3);
    try {
        const c = await api("/inventory/counts/get?id=" + id);
        if (c.error) {
            invScreen = "main";
            invTab = "count";
            haptic("error");
            tg.showAlert("Пересчёт не найден.");
            void loadInventory(false);
            return;
        }
        invCount = c;
        if (inventoryMode)
            paintInventory();
    }
    catch (e) {
        root().innerHTML = errorState("Не удалось загрузить пересчёт. Проверьте связь.");
    }
}
/* ------------------------------------------------------------ actions */
function openInventory() {
    inventoryMode = true;
    invScreen = "main";
    invTab = "stock";
    invQuery = "";
    invDept = "all";
    invHistory = null;
    invMoves = null;
    haptic("light");
    setOverlayControls(true);
    void loadInventory();
}
/** Returns true when the back press was handled inside the inventory flow. */
function invBack() {
    if (!inventoryMode)
        return false;
    if (invScreen === "main")
        return false;
    const wasCount = invScreen === "count" || invScreen === "report";
    invScreen = "main";
    if (wasCount) {
        invTab = "count";
        invHistory = null;
    }
    invCount = null;
    void loadInventory(false);
    return true;
}
function invSetCountLocal(lineId, actual) {
    if (!invCount)
        return;
    const line = invCount.lines.find((l) => l.id === lineId);
    if (!line)
        return;
    line.actual = actual;
    line.diff = actual === null ? null : Math.round((actual - line.expected) * 1000) / 1000;
    if (invCount.money)
        line.diff_value = null;
    const counted = invCount.lines.filter((l) => l.actual !== null);
    invCount.counted = counted.length;
    invCount.summary.diff_items = counted.filter((l) => l.diff !== null && Math.abs(l.diff) > 1e-9).length;
}
function invRefreshCountUi(lineId) {
    if (!invCount)
        return;
    const line = invCount.lines.find((l) => l.id === lineId);
    const chip = root().querySelector(`[data-diff="${lineId}"]`);
    if (line && chip)
        chip.innerHTML = diffChip(line.diff, line.unit);
    const head = root().querySelector("#inv-count-head");
    if (head) {
        const tmp = document.createElement("div");
        tmp.innerHTML = countHead(invCount);
        const next = tmp.firstElementChild;
        const text = head.querySelector(".hero-ring-text");
        const nextText = next.querySelector(".hero-ring-text");
        if (text && nextText)
            text.innerHTML = nextText.innerHTML;
        const ringEl = head.querySelector(".ring");
        const nextRing = next.querySelector(".ring");
        if (ringEl && nextRing) {
            ringEl.style.setProperty("--o", nextRing.style.getPropertyValue("--o"));
            const label = ringEl.querySelector("b");
            const nextLabel = nextRing.querySelector("b");
            if (label && nextLabel)
                label.textContent = nextLabel.textContent;
            const fg = ringEl.querySelector(".ring-fg");
            if (fg) {
                fg.style.animation = "none";
                fg.style.strokeDashoffset = nextRing.style.getPropertyValue("--o");
            }
        }
    }
}
async function saveCountLine(lineId, raw, input) {
    if (!invCount)
        return;
    const value = parseQty(raw);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
        if (input)
            input.classList.add("count-input--bad");
        tg.showAlert("Введите число, например 2,5.");
        return;
    }
    if (input)
        input.classList.remove("count-input--bad");
    const id = invCount.id;
    invSetCountLocal(lineId, value);
    invRefreshCountUi(lineId);
    try {
        const r = await api("/inventory/counts/set", { method: "POST", body: JSON.stringify({ count_id: id, line_id: lineId, actual: value }) });
        if (!r.ok)
            throw new Error("not_saved");
    }
    catch (e) {
        tg.showAlert("Не удалось сохранить значение. Проверьте связь.");
        haptic("error");
    }
}
function invFormValues(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = String(v).trim(); });
    return out;
}
function invFail(reason, fallback) {
    const map = {
        duplicate: "Такая позиция уже есть в этом отделе.",
        bad_qty: "Введите положительное число, например 2,5.",
        bad_item: "Проверьте название, единицу и числа.",
        forbidden: "У вас нет прав на это действие.",
        in_count: "Позиция участвует в незавершённом пересчёте. Завершите или отмените его.",
        no_items: "В этом отделе пока нет позиций. Сначала добавьте их во вкладке «Остатки».",
        nothing_counted: "Введите хотя бы одно фактическое количество.",
    };
    tg.showAlert((reason && map[reason]) || fallback);
    haptic("error");
}
async function submitInvMove(form) {
    const v = invFormValues(form);
    const qty = parseQty(v.qty);
    if (qty === null || Number.isNaN(qty) || qty <= 0)
        return void invFail("bad_qty", "");
    const button = form.querySelector(".staff-submit");
    if (button)
        button.disabled = true;
    try {
        const r = await api("/inventory/move", { method: "POST", body: JSON.stringify({ item_id: invItemId, kind: invKind, qty, reason: v.reason, note: v.note }) });
        if (!r.ok) {
            if (r.reason === "not_enough")
                tg.showAlert(`На складе только ${fmtQty(r.available || 0)}. Нельзя списать больше.`);
            else
                invFail(r.reason, "Не удалось записать движение.");
            return;
        }
        haptic("success");
        invItemMoves = null;
        await loadInventory(false);
        void loadInvItemMoves(invItemId);
    }
    catch (e) {
        tg.showAlert("Не удалось сохранить. Проверьте связь.");
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
async function submitInvEdit(form) {
    const v = invFormValues(form);
    const body = { id: invItemId, name: v.name, unit: v.unit, min_qty: v.min_qty === "" ? 0 : parseQty(v.min_qty) };
    if (v.unit_cost !== undefined)
        body.unit_cost = v.unit_cost === "" ? 0 : parseQty(v.unit_cost);
    if (Number.isNaN(body.min_qty) || (v.unit_cost !== undefined && Number.isNaN(body.unit_cost)))
        return void invFail("bad_qty", "");
    try {
        const r = await api("/inventory/items/update", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok)
            return void invFail(r.reason, "Не удалось сохранить позицию.");
        haptic("success");
        await loadInventory(false);
    }
    catch (e) {
        tg.showAlert("Не удалось сохранить. Проверьте связь.");
    }
}
async function submitInvNew(form) {
    const v = invFormValues(form);
    const num = (s) => (s === "" ? 0 : parseQty(s));
    const qty = num(v.qty), min = num(v.min_qty), cost = v.unit_cost === undefined ? 0 : num(v.unit_cost);
    if ([qty, min, cost].some((n) => n === null || Number.isNaN(n)))
        return void invFail("bad_qty", "");
    const button = form.querySelector(".staff-submit");
    if (button)
        button.disabled = true;
    try {
        const r = await api("/inventory/items", { method: "POST", body: JSON.stringify({ department: v.department, name: v.name, unit: v.unit, qty, min_qty: min, unit_cost: cost, ...(invBranch ? { branch_id: invBranch } : {}) }) });
        if (!r.ok)
            return void invFail(r.reason, "Не удалось добавить позицию.");
        haptic("success");
        invScreen = "main";
        invTab = "stock";
        await loadInventory(false);
    }
    catch (e) {
        tg.showAlert("Не удалось добавить. Проверьте связь.");
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
async function startInvCount(department) {
    if (invBusy)
        return;
    invBusy = true;
    try {
        const r = await api("/inventory/counts/start", { method: "POST", body: JSON.stringify({ department, ...(invBranch ? { branch_id: invBranch } : {}) }) });
        if (!r.ok || !r.id)
            return void invFail(r.reason, "Не удалось начать пересчёт.");
        haptic("success");
        invCountQuery = "";
        void loadInvCount(r.id, "count");
    }
    catch (e) {
        tg.showAlert("Не удалось начать пересчёт. Проверьте связь.");
    }
    finally {
        invBusy = false;
    }
}
function finishInvCount() {
    if (!invCount)
        return;
    const c = invCount;
    if (!c.counted)
        return void invFail("nothing_counted", "");
    const left = c.total - c.counted;
    const text = `Завершить пересчёт «${c.department}»? Остатки обновятся по введённым значениям (${c.counted} ${plural(c.counted, "позиция", "позиции", "позиций")})` +
        (left ? `, ${left} ${plural(left, "позиция", "позиции", "позиций")} без значения останутся как есть.` : ".");
    tg.showConfirm(text, (ok) => {
        if (!ok)
            return;
        void api("/inventory/counts/finish", { method: "POST", body: JSON.stringify({ count_id: c.id }) }).then((r) => {
            if (!r.ok)
                return void invFail(r.reason, "Не удалось завершить пересчёт.");
            haptic("success");
            invShowAll = false;
            invHistory = null;
            invData = null;
            void loadInvCount(c.id, "report");
        }).catch(() => tg.showAlert("Не удалось завершить пересчёт. Проверьте связь."));
    });
}
function cancelInvCount() {
    if (!invCount)
        return;
    const id = invCount.id;
    tg.showConfirm("Отменить пересчёт? Введённые значения будут удалены, остатки не изменятся.", (ok) => {
        if (!ok)
            return;
        void api("/inventory/counts/cancel", { method: "POST", body: JSON.stringify({ count_id: id }) }).then((r) => {
            if (!r.ok)
                return void tg.showAlert("Не удалось отменить пересчёт.");
            invScreen = "main";
            invTab = "count";
            invCount = null;
            invHistory = null;
            void loadInventory(false);
        }).catch(() => tg.showAlert("Не удалось отменить. Проверьте связь."));
    });
}
function deleteInvItem() {
    const item = invItem(invItemId);
    if (!item)
        return;
    tg.showConfirm(`Удалить позицию «${item.name}»? История движений сохранится в журнале.`, (ok) => {
        if (!ok)
            return;
        void api("/inventory/items/delete", { method: "POST", body: JSON.stringify({ id: item.id }) }).then((r) => {
            if (!r.ok)
                return void invFail(r.reason, "Не удалось удалить позицию.");
            haptic("success");
            invScreen = "main";
            void loadInventory(false);
        }).catch(() => tg.showAlert("Не удалось удалить. Проверьте связь."));
    });
}
function ensureInvListeners() {
    if (invListenersReady)
        return;
    invListenersReady = true;
    const el = root();
    el.addEventListener("input", (ev) => {
        const t = ev.target;
        if (!inventoryMode)
            return;
        if (t.id === "inv-search") {
            invQuery = t.value;
            const list = root().querySelector("#inv-list");
            if (list && invData)
                list.innerHTML = stockList();
        }
        else if (t.id === "inv-count-search") {
            invCountQuery = t.value;
            const list = root().querySelector("#inv-count-list");
            if (list && invCount)
                list.innerHTML = countLinesHtml(invCount);
        }
    });
    el.addEventListener("change", (ev) => {
        const sel = ev.target;
        if (inventoryMode && invScreen === "new" && sel && sel.name === "department" && invData) {
            invNewDept = sel.value;
            const presets = root().querySelector("#inv-presets");
            if (presets)
                presets.innerHTML = presetChips(invNewDept);
            const hint = root().querySelector("#inv-dept-hint");
            const hints = { Посуда: "Тарелки, бокалы, приборы: считаются поштучно, бой списывается с причиной «Разбито».", Хозтовары: "Салфетки, моющие средства, мешки и всё, что расходуется в зале и на кухне." };
            if (hint)
                hint.textContent = hints[invNewDept] || "";
            return;
        }
        const t = ev.target;
        if (!inventoryMode || !t.classList || !t.classList.contains("count-input"))
            return;
        void saveCountLine(Number(t.dataset.line), t.value, t);
    });
    el.addEventListener("submit", (ev) => {
        const form = ev.target;
        if (!inventoryMode || !form.id || form.id.indexOf("inv-") !== 0)
            return;
        ev.preventDefault();
        if (form.id === "inv-move-form")
            void submitInvMove(form);
        else if (form.id === "inv-edit-form")
            void submitInvEdit(form);
        else if (form.id === "inv-new-form")
            void submitInvNew(form);
    });
}
function handleInventoryAction(action) {
    if (action === "inventory") {
        ensureInvListeners();
        openInventory();
        return true;
    }
    if (action.indexOf("inv") !== 0 && action !== "inventory-back")
        return false;
    if (action === "inventory-back" || action === "inv-back") {
        if (!invBack())
            closeOverlay();
        return true;
    }
    if (!inventoryMode)
        return false;
    const d = invData;
    if (action.indexOf("inv-tab:") === 0) {
        const tab = action.slice(8);
        if (tab !== "stock" && tab !== "count" && tab !== "log")
            return true;
        invTab = tab;
        haptic("light");
        if (tab === "count") {
            invHistory = null;
            void loadInvHistory();
        }
        if (tab === "log") {
            invMoves = null;
            void loadInvMoves();
        }
        paintInventory();
        return true;
    }
    if (action.indexOf("inv-dept:") === 0 && d) {
        const k = action.slice(9);
        invDept = k === "all" ? "all" : d.departments[Number(k)] || "all";
        paintInventory();
        return true;
    }
    if (action.indexOf("inv-branch:") === 0) {
        invBranch = action.slice(11);
        invHistory = null;
        invMoves = null;
        void loadInventory(false);
        return true;
    }
    if (action.indexOf("inv-item:") === 0) {
        invItemId = Number(action.slice(9));
        invScreen = "item";
        invKind = "in";
        invItemMoves = null;
        paintInventory();
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
        root().scrollTop = 0;
        void loadInvItemMoves(invItemId);
        return true;
    }
    if (action === "inv-new") {
        invScreen = "new";
        invNewDept = invDept === "all" ? "" : invDept;
        paintInventory();
        root().scrollTop = 0;
        return true;
    }
    if (action.indexOf("inv-preset:") === 0 && d) {
        const p = (d.presets && d.presets[invNewDept] || [])[Number(action.slice(11))];
        const form = root().querySelector("#inv-new-form");
        if (p && form) {
            form.elements.namedItem("name").value = p[0];
            const unit = form.elements.namedItem("unit");
            if (unit)
                unit.value = p[1];
            haptic("light");
        }
        return true;
    }
    if (action.indexOf("inv-kind:") === 0) {
        const k = action.slice(9);
        if (k === "in" || k === "out") {
            invKind = k;
            paintInventory();
        }
        return true;
    }
    if (action.indexOf("inv-start:") === 0 && d) {
        const dept = d.editable_departments[Number(action.slice(10))];
        if (dept)
            void startInvCount(dept);
        return true;
    }
    if (action.indexOf("inv-open:") === 0) {
        invCountQuery = "";
        void loadInvCount(Number(action.slice(9)), "count");
        return true;
    }
    if (action.indexOf("inv-report:") === 0) {
        invShowAll = false;
        void loadInvCount(Number(action.slice(11)), "report");
        return true;
    }
    if (action.indexOf("inv-same:") === 0 && invCount) {
        const id = Number(action.slice(9));
        const line = invCount.lines.find((l) => l.id === id);
        if (line) {
            const input = root().querySelector(`.count-input[data-line="${id}"]`);
            if (input)
                input.value = fmtQty(line.expected).replace(/\s/g, "");
            void saveCountLine(id, String(line.expected), input || undefined);
        }
        return true;
    }
    if (action === "inv-finish") {
        finishInvCount();
        return true;
    }
    if (action === "inv-cancel") {
        cancelInvCount();
        return true;
    }
    if (action === "inv-delete") {
        deleteInvItem();
        return true;
    }
    if (action === "inv-showall") {
        invShowAll = !invShowAll;
        paintInventory();
        return true;
    }
    return false;
}
