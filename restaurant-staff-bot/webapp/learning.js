"use strict";
/** UI helpers (rings, bars, segmented control) and the Trainings / Checklists screens. */
/* ------------------------------------------------------------- UI helpers */
const segPrev = {};
function isMgr(e) {
    return !!e && (e.role === "manager" || e.role === "owner");
}
function canLead(e) {
    return !!e && (e.role === "manager" || e.role === "owner" || e.role === "chef" || e.role === "finance" || e.role === "bar_manager");
}
function canAnalytics(e) {
    return !!e && !!(e.perms ? e.perms.analytics : e.role === "manager" || e.role === "owner");
}
function pct(done, total) {
    return total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
}
function ring(percent, size, label) {
    const r = 26;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - Math.max(0, Math.min(100, percent)) / 100);
    return `<span class="ring" style="--size:${size}px;--c:${c.toFixed(2)};--o:${offset.toFixed(2)}">` +
        '<svg viewBox="0 0 64 64"><circle class="ring-bg" cx="32" cy="32" r="26"/><circle class="ring-fg" cx="32" cy="32" r="26"/></svg>' +
        `<b>${label !== undefined ? label : percent + "%"}</b></span>`;
}
function bar(percent, tone) {
    return `<span class="pbar${tone ? " pbar--" + tone : ""}"><i style="--w:${Math.max(0, Math.min(100, percent))}%"></i></span>`;
}
function segmented(key, options, active, prefix) {
    const idx = Math.max(0, options.findIndex((o) => o.id === active));
    const from = segPrev[key] === undefined ? idx : segPrev[key];
    segPrev[key] = idx;
    return `<div class="seg" style="--n:${options.length};--i:${from}" data-to="${idx}">` +
        '<span class="seg-thumb"></span>' +
        options.map((o, i) => `<button type="button" class="seg-btn${i === idx ? " seg-btn--on" : ""}" data-action="${prefix}${o.id}">${esc(o.label)}</button>`).join("") +
        "</div>";
}
function avatar(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    const initials = ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
    let h = 0;
    for (let i = 0; i < name.length; i++)
        h = (h * 31 + name.charCodeAt(i)) % 360;
    return `<span class="avatar" style="--h:${h}">${esc(initials)}</span>`;
}
function plural(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11)
        return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14))
        return few;
    return many;
}
/** Re-renders the current screen in place, keeping scroll position and skipping the entrance animation. */
function rerender(html) {
    const el = root();
    const y = window.scrollY;
    const inner = el.scrollTop;
    el.innerHTML = html;
    const screen = el.querySelector(".screen");
    if (screen)
        screen.classList.add("screen--static");
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    el.scrollTop = inner;
}
function afterRender() {
    document.querySelectorAll(".seg[data-to]").forEach((el) => {
        const to = el.dataset.to;
        delete el.dataset.to;
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => el.style.setProperty("--i", to)));
    });
    document.querySelectorAll("[data-count]").forEach((el) => {
        if (el.dataset.counted)
            return;
        el.dataset.counted = "1";
        const target = Number(el.dataset.count) || 0;
        const kind = el.dataset.kind || "int";
        const fmt = (v) => {
            if (kind === "money")
                return money(v);
            if (kind === "pct")
                return Math.round(v) + "%";
            if (kind === "hours")
                return hoursText(v);
            return String(Math.round(v));
        };
        if (!target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            el.textContent = fmt(target);
            return;
        }
        const t0 = performance.now();
        const dur = 700;
        const step = (now) => {
            const k = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - k, 3);
            el.textContent = fmt(target * eased);
            if (k < 1)
                window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    });
}
function countAttr(value, kind) {
    return `data-count="${value}" data-kind="${kind}"`;
}
/* ------------------------------------------------- audience ("кому видно") */
const audienceState = {};
const audienceList = {};
function audienceText(list) {
    return list && list.length ? list.join(", ") : "Все сотрудники";
}
const audienceLocked = {};
function audienceField(key, positions, lockAll) {
    audienceList[key] = positions;
    audienceLocked[key] = !!lockAll;
    if (!audienceState[key])
        audienceState[key] = [];
    if (lockAll && !audienceState[key].length)
        audienceState[key] = positions.slice();
    const sel = audienceState[key];
    return `<div class="field field--aud" data-aud-box="${key}"><span class="field-label">Кому видно</span><div class="chips">` +
        (lockAll ? "" : `<button type="button" class="chip${sel.length ? "" : " chip--on"}" data-action="aud:${key}:all">Все</button>`) +
        positions.map((p, i) => `<button type="button" class="chip${sel.indexOf(p) >= 0 ? " chip--on" : ""}" data-action="aud:${key}:${i}">${esc(p)}</button>`).join("") +
        `</div><div class="aud-hint" data-aud-hint="${key}">${esc(audienceHint(sel))}</div></div>`;
}
function audienceHint(sel) {
    return sel.length ? "Увидят: " + sel.join(", ") + " (и менеджеры)" : "Увидят все сотрудники";
}
function handleAudienceAction(action) {
    if (action.indexOf("aud:") !== 0)
        return false;
    const [, key, which] = action.split(":");
    const list = audienceList[key] || [];
    const sel = audienceState[key] || (audienceState[key] = []);
    if (which === "all") {
        if (audienceLocked[key])
            return true;
        sel.length = 0;
    }
    else {
        const name = list[Number(which)];
        if (name) {
            const at = sel.indexOf(name);
            if (at >= 0)
                sel.splice(at, 1);
            else
                sel.push(name);
        }
    }
    root().querySelectorAll(`[data-aud-box="${key}"] [data-action^="aud:${key}:"]`).forEach((chip) => {
        const w = (chip.dataset.action || "").split(":")[2];
        chip.classList.toggle("chip--on", w === "all" ? sel.length === 0 : sel.indexOf(list[Number(w)]) >= 0);
    });
    const hint = root().querySelector(`[data-aud-hint="${key}"]`);
    if (hint)
        hint.textContent = audienceHint(sel);
    haptic("light");
    return true;
}
function audienceTag(list) {
    return list && list.length ? `<span class="aud-tag">Для: ${esc(list.join(", "))}</span>` : "";
}
let trainingTab = "list";
let trainingProgress = null;
let trainingBusy = false;
let trainingEditId = 0;
function trainingCard(t, manager, index) {
    const open = t.url ? `<button type="button" class="chip-btn" data-action="training-open:${t.id}">Открыть материал</button>` : "";
    let tail = "";
    if (manager) {
        const done = t.completed || 0;
        const total = t.total || 0;
        tail = `<div class="tr-meta"><span>Изучили ${done} из ${total}</span>${bar(pct(done, total))}</div>`;
    }
    const toggle = manager ? "" :
        `<button type="button" class="check-btn${t.done ? " check-btn--on" : ""}" data-action="tr-done:${t.id}" aria-label="Отметить изученным"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg></button>`;
    const edit = manager ? `<button type="button" class="icon-btn" data-action="tr-edit:${t.id}" aria-label="Редактировать материал"><svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 8.5 3 3"/></svg></button>` : "";
    const del = manager ? `<button type="button" class="icon-btn icon-btn--danger" data-action="tr-delete:${t.id}" aria-label="Удалить материал"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg></button>` : "";
    return `<div class="tr-card${t.done ? " tr-card--done" : ""}" style="--i:${index}">` +
        '<div class="tr-head">' +
        `<div class="tr-title">${esc(t.title)}</div>${toggle}${edit}${del}</div>` +
        (manager ? audienceTag(t.audience) : "") + `<div class="tr-body">${esc(t.body)}</div>` +
        `<div class="tr-foot">${open}${t.done && t.completed_at ? `<span class="tr-done-at">Изучено ${esc(humanDate(t.completed_at.slice(0, 10)))}</span>` : ""}</div>` +
        tail + "</div>";
}
function trainingForm() {
    const t2 = trainingEditId && trainingsData ? trainingsData.trainings.find((x) => x.id === trainingEditId) : undefined;
    return '<form class="form-stack" id="training-form"><div class="section staff-form staff-form--card">' +
        `<div class="staff-form-heading">${t2 ? "Редактирование материала" : "Новый материал"}</div>` +
        `<label class="field"><span class="field-label">Название</span><input name="title" maxlength="120" placeholder="Например, Стандарты сервиса" value="${t2 ? esc(t2.title) : ""}" required></label>` +
        `<label class="field"><span class="field-label">Описание</span><textarea name="body" maxlength="4000" placeholder="Кратко опишите, что нужно изучить" required>${t2 ? esc(t2.body) : ""}</textarea></label>` +
        `<label class="field"><span class="field-label">Ссылка на материал</span><input name="url" type="url" inputmode="url" maxlength="2048" placeholder="https://... (необязательно)" value="${t2 ? esc(t2.url) : ""}"></label></div>` +
        audienceBlock("tr", (trainingsData && trainingsData.positions) || [], false) +
        `<button class="button staff-submit" type="submit">${t2 ? "Сохранить" : "Добавить материал"}</button>` +
        (t2 ? '<button type="button" class="button button--secondary staff-cancel" data-action="tr-edit-cancel">Отмена</button>' : "") + '</form>' +
        '<div class="section-footer">Материал увидят только выбранные должности (менеджеры видят всё). Они получат уведомление и смогут отмечать его изученным, а вы увидите прогресс каждого.</div>';
}
function trainingProgressView(p) {
    if (!p.employees.length)
        return '<div class="section"><div class="empty">Сотрудников пока нет</div></div>';
    let html = `<div class="hero hero--ring"><div>${ring(p.summary, 76)}</div><div class="hero-ring-text"><div class="hero-label">Средний прогресс</div>` +
        `<div class="hero-value">${p.summary}%</div><div class="hero-sub">${p.employees.length} ${plural(p.employees.length, "сотрудник", "сотрудника", "сотрудников")} · ${p.trainings.length} ${plural(p.trainings.length, "материал", "материала", "материалов")}</div></div></div>`;
    html += '<div class="section-title">Сотрудники</div><div class="section section--stagger">';
    p.employees.forEach((e, i) => {
        const tone = e.percent >= 100 ? "good" : e.percent === 0 ? "none" : "";
        html += `<div class="pe" data-pe="${e.id}" style="--i:${i}"><button type="button" class="pe-head" data-action="tr-emp:${e.id}">` +
            `${avatar(e.name)}<div class="pe-main"><div class="pe-name">${esc(e.name)}</div><div class="pe-sub">${esc(e.position || "Сотрудник")} · ${e.done} из ${e.total}</div>${bar(e.percent, tone)}</div>` +
            `<div class="pe-pct">${e.percent}%</div><span class="pe-chev">${icon("chevron")}</span></button>` +
            '<div class="pe-body"><div class="pe-body-in">' +
            (e.items.length ? e.items.map((it) => `<div class="pe-item${it.done ? " pe-item--done" : ""}"><span class="pe-dot">${it.done ? "✓" : ""}</span><span class="pe-item-title">${esc(it.title)}</span><span class="pe-item-at">${it.at ? esc(humanDate(it.at.slice(0, 10))) : "не изучено"}</span></div>`).join("") : '<div class="empty">Материалов пока нет</div>') +
            "</div></div></div>";
    });
    html += "</div>";
    if (p.trainings.length) {
        html += '<div class="section-title">По материалам</div><div class="section section--stagger">';
        p.trainings.forEach((t, i) => {
            html += `<div class="row-bar" style="--i:${i}"><div class="row-bar-top"><span class="row-bar-title">${esc(t.title)}</span><span class="row-bar-val">${t.done}/${t.total}</span></div>${bar(pct(t.done, t.total))}</div>`;
        });
        html += "</div>";
    }
    return html;
}
function renderTrainings(d) {
    const manager = d.can_manage;
    if (trainingTab === "library" && libScreen === "upload" && libraryData)
        return libraryUploadScreen(libraryData);
    let html = '<div class="screen screen--wide"><button class="back-link" data-action="trainings-back">‹ Назад</button><div class="screen-title">Обучение и Методички</div>';
    html += `<div class="screen-sub">${manager ? "Материалы, файлы-методички и прогресс каждого сотрудника." : "Изучайте материалы, открывайте методички и отмечайте прогресс."}</div>`;
    const tabs = [{ id: "list", label: "Материалы" }, { id: "library", label: "Методички" }];
    if (manager) {
        tabs.push({ id: "progress", label: "Прогресс" });
        tabs.push({ id: "new", label: "Новый" });
    }
    html += segmented("training", tabs, trainingTab, "tr-tab:");
    if (trainingTab === "library")
        return html + libraryBody(libraryData) + "</div>";
    if (manager) {
        if (trainingTab === "new")
            return html + trainingForm() + "</div>";
        if (trainingTab === "progress") {
            return html + (trainingProgress ? trainingProgressView(trainingProgress) : '<div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div>') + "</div>";
        }
    }
    else {
        const p = d.progress || { done: 0, total: d.trainings.length };
        const percent = pct(p.done, p.total);
        html += `<div class="hero hero--ring"><div>${ring(percent, 76)}</div><div class="hero-ring-text"><div class="hero-label">Мой прогресс</div>` +
            `<div class="hero-value">${p.done} из ${p.total}</div><div class="hero-sub">${p.total && p.done >= p.total ? "Всё изучено — отлично!" : "материалов изучено"}</div></div></div>`;
    }
    if (!d.trainings.length)
        return html + '<div class="section"><div class="empty">Материалов пока нет</div></div></div>';
    html += `<div class="section-title">Материалы</div><div class="tr-list">${d.trainings.map((t2, i) => trainingCard(t2, manager, i)).join("")}</div>`;
    return html + "</div>";
}
async function loadTrainings(skeletonFirst) {
    if (skeletonFirst !== false)
        root().innerHTML = skeleton(3);
    try {
        const d = await api("/trainings");
        if (d.error)
            return void (root().innerHTML = noAccess());
        trainingsData = d;
        if (trainingTab === "library")
            void loadLibrary(false);
        if (d.can_manage && trainingTab === "progress") {
            try {
                const p = await api("/trainings/progress");
                trainingProgress = p.error ? null : p;
            }
            catch (e) {
                trainingProgress = null;
            }
        }
        if (!trainingsMode)
            return;
        if (skeletonFirst === false)
            rerender(renderTrainings(d));
        else
            root().innerHTML = renderTrainings(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить обучение. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
async function toggleTraining(id) {
    if (!trainingsData || trainingBusy)
        return;
    const item = trainingsData.trainings.find((t) => t.id === id);
    if (!item)
        return;
    trainingBusy = true;
    const next = !item.done;
    item.done = next;
    item.completed_at = next ? new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 19).replace("T", " ") : null;
    if (trainingsData.progress)
        trainingsData.progress.done = trainingsData.trainings.filter((t) => t.done).length;
    rerender(renderTrainings(trainingsData));
    try {
        tg.HapticFeedback.impactOccurred(next ? "medium" : "light");
    }
    catch (e) { /* ignore */ }
    try {
        const r = await api("/trainings/complete", { method: "POST", body: JSON.stringify({ training_id: id, done: next }) });
        if (!r.ok)
            throw new Error("not_saved");
    }
    catch (err) {
        item.done = !next;
        item.completed_at = null;
        if (trainingsData.progress)
            trainingsData.progress.done = trainingsData.trainings.filter((t) => t.done).length;
        rerender(renderTrainings(trainingsData));
        tg.showAlert("Не удалось сохранить отметку. Проверьте связь.");
    }
    finally {
        trainingBusy = false;
    }
}
async function submitTraining() {
    const form = root().querySelector("#training-form");
    if (!form || !trainingsMode)
        return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const body = String(values.get("body") || "").trim();
    const url = String(values.get("url") || "").trim();
    if (title.length < 2 || body.length < 2) {
        tg.showAlert("Укажите название и описание материала.");
        return;
    }
    const button = form.querySelector(".staff-submit");
    if (button) {
        button.disabled = true;
        button.textContent = "Добавляем…";
    }
    try {
        const result = await api(trainingEditId ? "/trainings/update" : "/trainings", { method: "POST", body: JSON.stringify({ id: trainingEditId || undefined, title, body, url, positions: audienceState.tr || [] }) });
        if (!result.ok) {
            tg.showAlert(result.reason === "bad_url" ? "Укажите корректную ссылку с https://." : "Проверьте материал и попробуйте снова.");
            try {
                tg.HapticFeedback.notificationOccurred("error");
            }
            catch (e) { /* ignore */ }
            return;
        }
        try {
            tg.HapticFeedback.notificationOccurred("success");
        }
        catch (e) { /* ignore */ }
        trainingTab = "list";
        trainingEditId = 0;
        audienceState.tr = [];
        void loadTrainings();
    }
    catch (err) {
        tg.showAlert("Не удалось добавить материал. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        if (button) {
            button.disabled = false;
            button.textContent = trainingEditId ? "Сохранить" : "Добавить материал";
        }
    }
}
function deleteTraining(id) {
    tg.showConfirm("Удалить материал? Отметки сотрудников об изучении тоже удалятся.", (ok) => {
        if (!ok)
            return;
        void api("/trainings/delete", { method: "POST", body: JSON.stringify({ id }) }).then((r) => {
            if (!r.ok)
                return void tg.showAlert("Не удалось удалить материал.");
            haptic("success");
            void loadTrainings(false);
        }).catch(() => tg.showAlert("Не удалось удалить материал. Проверьте связь."));
    });
}
let checklistTab = "mine";
let checklistData = null;
let checklistReport = null;
let checklistDate = "";
let checklistPositions = [];
let checklistChoices = [];
let checklistBusy = false;
let checklistEditId = 0;
function checklistCard(c, index) {
    const total = c.items.length;
    const done = c.done.length;
    const full = total > 0 && done >= total;
    let html = `<div class="cl-card${full ? " cl-card--full" : ""}" style="--i:${index}"><div class="cl-head"><div class="cl-title">${esc(c.title)}</div>` +
        `<div class="cl-count${full ? " cl-count--full" : ""}">${full ? "Готово ✓" : done + "/" + total}</div></div>` +
        (c.positions && c.positions.length ? `<div class="cl-aud">Для: ${esc(c.positions.join(", "))}</div>` : "") +
        bar(pct(done, total), full ? "good" : "") + '<div class="cl-items">';
    c.items.forEach((item, idx) => {
        const isDone = c.done.indexOf(idx) >= 0;
        const at = c.times && c.times[String(idx)];
        html += `<button class="checklist-item${isDone ? " checklist-item--done" : ""}" data-action="checklist-toggle:${c.id}:${idx}" type="button">` +
            '<span class="checklist-mark"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg></span>' +
            `<span class="cl-text">${esc(item)}</span>${isDone && at ? `<span class="cl-time">${esc(at)}</span>` : ""}</button>`;
    });
    return html + "</div></div>";
}
function checklistForm(positions) {
    checklistChoices = positions;
    const c = checklistEditId && checklistReport ? checklistReport.checklists.find((x) => x.id === checklistEditId) : undefined;
    return '<form class="section staff-form staff-form--card" id="checklist-form">' +
        `<div class="staff-form-heading">${c ? "Редактирование чек-листа" : "Новый чек-лист"}</div>` +
        `<label class="field"><span class="field-label">Название</span><input name="title" maxlength="120" placeholder="Например, Открытие смены" value="${c ? esc(c.title) : ""}" required></label>` +
        `<label class="field"><span class="field-label">Задачи</span><textarea name="items" maxlength="7200" placeholder="Каждая задача — с новой строки" required>${c ? esc(c.items.join("\n")) : ""}</textarea></label>` +
        '<div class="field"><span class="field-label">Для кого</span><div class="chips">' +
        `<button type="button" class="chip${checklistPositions.length ? "" : " chip--on"}" data-action="cl-pos:all">Все</button>` +
        positions.map((p, i) => `<button type="button" class="chip${checklistPositions.indexOf(p) >= 0 ? " chip--on" : ""}" data-action="cl-pos:${i}">${esc(p)}</button>`).join("") +
        "</div></div>" +
        `<button class="button staff-submit" type="submit">${c ? "Сохранить" : "Создать чек-лист"}</button>` +
        (c ? '<button type="button" class="button button--secondary staff-cancel" data-action="cl-edit-cancel">Отмена</button>' : "") + '</form>' +
        '<div class="section-footer">Сотрудники получат уведомление. Каждый день чек-лист начинается заново, а вы видите, кто и какие задачи выполнил.</div>';
}
function reportPerson(c, p, idx) {
    const total = c.items.length;
    const status = p.complete ? ["Готово", "good"] : p.done.length ? ["В процессе", "warn"] : ["Не начал", "none"];
    return `<div class="pe" data-pe="${c.id}-${p.id}" style="--i:${idx}"><button type="button" class="pe-head" data-action="cl-emp:${c.id}:${p.id}">` +
        `${avatar(p.name)}<div class="pe-main"><div class="pe-name">${esc(p.name)}</div><div class="pe-sub">${esc(p.position || "Сотрудник")} · ${p.done.length} из ${total}</div>${bar(pct(p.done.length, total), p.complete ? "good" : "")}</div>` +
        `<span class="status status--${status[1]}">${status[0]}</span><span class="pe-chev">${icon("chevron")}</span></button>` +
        '<div class="pe-body"><div class="pe-body-in">' +
        c.items.map((item, i) => {
            const d = p.done.indexOf(i) >= 0;
            return `<div class="pe-item${d ? " pe-item--done" : ""}"><span class="pe-dot">${d ? "✓" : ""}</span><span class="pe-item-title">${esc(item)}</span><span class="pe-item-at">${d ? esc(p.times[String(i)] || "") : "не сделано"}</span></div>`;
        }).join("") + "</div></div></div>";
}
function reportByTask(c) {
    return '<div class="by-task">' + c.items.map((item, i) => {
        const doers = c.people.filter((p) => p.done.indexOf(i) >= 0);
        const waiting = c.people.length - doers.length;
        return `<div class="bt-row"><div class="bt-task">${esc(item)}</div><div class="bt-who">` +
            (doers.length ? doers.map((p) => `<span class="who">${esc(p.name.split(" ")[0])}${p.times[String(i)] ? ` <small>${esc(p.times[String(i)])}</small>` : ""}</span>`).join("") : "") +
            (waiting > 0 ? `<span class="who who--wait">ещё ${waiting}</span>` : "") + "</div></div>";
    }).join("") + "</div>";
}
function checklistReportView(r) {
    const isToday = r.date === r.today;
    let html = '<div class="date-nav">' +
        `<button type="button" class="nav-arrow" data-action="cl-date:-1" aria-label="Предыдущий день"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
        `<div class="date-nav-title">${isToday ? "Сегодня" : esc(humanDate(r.date))}<small>${esc(humanDate(r.date))}</small></div>` +
        `<button type="button" class="nav-arrow" data-action="cl-date:1" aria-label="Следующий день"${isToday ? " disabled" : ""}><svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
    if (!r.checklists.length)
        return html + '<div class="section"><div class="empty">Чек-листов на эту дату нет. Создайте первый во вкладке «Новый».</div></div>';
    const totalPeople = r.checklists.reduce((s, c) => s + c.summary.total, 0);
    const totalDone = r.checklists.reduce((s, c) => s + c.summary.complete, 0);
    const percent = pct(totalDone, totalPeople);
    html += `<div class="hero hero--ring"><div>${ring(percent, 76)}</div><div class="hero-ring-text"><div class="hero-label">Выполнено полностью</div>` +
        `<div class="hero-value">${totalDone} из ${totalPeople}</div><div class="hero-sub">назначений по ${r.checklists.length} ${plural(r.checklists.length, "чек-листу", "чек-листам", "чек-листам")}</div></div></div>`;
    r.checklists.forEach((c, ci) => {
        const s = c.summary;
        html += `<div class="rep-card" style="--i:${ci}"><div class="rep-head"><div><div class="rep-title">${esc(c.title)}</div>` +
            `<div class="rep-aud">${c.positions.length ? "Для: " + esc(c.positions.join(", ")) : "Для всех сотрудников"} · ${c.items.length} ${plural(c.items.length, "задача", "задачи", "задач")}</div></div>` +
            `<div class="rep-btns"><button type="button" class="icon-btn" data-action="cl-edit:${c.id}" aria-label="Редактировать чек-лист"><svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 8.5 3 3"/></svg></button><button type="button" class="icon-btn icon-btn--danger" data-action="cl-delete:${c.id}" aria-label="Удалить чек-лист"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg></button></div></div>` +
            `<div class="rep-sum"><span>Выполнили ${s.complete} из ${s.total}</span><span>Начали ${s.started}</span></div>${bar(pct(s.complete, s.total), s.total && s.complete === s.total ? "good" : "")}`;
        if (!c.people.length)
            html += '<div class="empty">Нет сотрудников для этого чек-листа</div>';
        else
            html += '<div class="rep-people">' + c.people.map((p, i) => reportPerson(c, p, i)).join("") + "</div>" +
                `<button type="button" class="link-btn" data-action="cl-bytask:${c.id}">Кто что сделал по задачам</button><div class="bt-wrap" data-bt="${c.id}"><div class="bt-wrap-in">${reportByTask(c)}</div></div>`;
        html += "</div>";
    });
    return html;
}
function renderChecklists(d) {
    const manager = d.can_manage;
    let html = '<div class="screen screen--wide"><button class="back-link" data-action="checklists-back">‹ Назад</button><div class="screen-title">Чек-листы</div>';
    html += `<div class="screen-sub">${manager ? "Создавайте чек-листы и смотрите, кто и что выполнил." : "Отмечайте выполненные задачи — они сохраняются на сегодня."}</div>`;
    if (manager) {
        html += segmented("checklist", [{ id: "report", label: "Отчёт" }, { id: "mine", label: "Мои" }, { id: "new", label: "Новый" }], checklistTab, "cl-tab:");
        if (checklistTab === "new")
            return html + checklistForm(d.positions_available || []) + "</div>";
        if (checklistTab === "report") {
            return html + (checklistReport ? checklistReportView(checklistReport) : '<div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div>') + "</div>";
        }
    }
    if (!d.checklists.length)
        return html + '<div class="section"><div class="empty">Чек-листов пока нет</div></div></div>';
    const itemsTotal = d.checklists.reduce((s, c) => s + c.items.length, 0);
    const itemsDone = d.checklists.reduce((s, c) => s + c.done.length, 0);
    const percent = pct(itemsDone, itemsTotal);
    html += `<div class="hero hero--ring"><div>${ring(percent, 76)}</div><div class="hero-ring-text"><div class="hero-label">Сегодня</div>` +
        `<div class="hero-value">${itemsDone} из ${itemsTotal}</div><div class="hero-sub">${itemsTotal && itemsDone >= itemsTotal ? "Все задачи выполнены!" : "задач выполнено"}</div></div></div>`;
    html += '<div class="cl-list">' + d.checklists.map((c, i) => checklistCard(c, i)).join("") + "</div>";
    return html + "</div>";
}
async function loadChecklistReport() {
    try {
        const r = await api("/checklists/report?date=" + encodeURIComponent(checklistDate || ""));
        checklistReport = r.error ? null : r;
        if (r.date)
            checklistDate = r.date;
    }
    catch (e) {
        checklistReport = null;
    }
}
async function loadChecklists(skeletonFirst) {
    if (skeletonFirst !== false)
        root().innerHTML = skeleton(3);
    try {
        const d = await api("/checklists");
        if (d.error)
            return void (root().innerHTML = noAccess());
        checklistData = d;
        if (d.can_manage && checklistTab === "report")
            await loadChecklistReport();
        if (!d.can_manage)
            checklistTab = "mine";
        if (!checklistsMode)
            return;
        if (skeletonFirst === false)
            rerender(renderChecklists(d));
        else
            root().innerHTML = renderChecklists(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить чек-листы. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
async function toggleChecklist(checklistId, itemIndex) {
    if (!checklistsMode || !checklistData || checklistBusy)
        return;
    const list = checklistData.checklists.find((c) => c.id === checklistId);
    if (!list)
        return;
    checklistBusy = true;
    const before = { done: list.done.slice(), times: { ...(list.times || {}) } };
    const pos = list.done.indexOf(itemIndex);
    list.times = list.times || {};
    if (pos >= 0) {
        list.done.splice(pos, 1);
        delete list.times[String(itemIndex)];
    }
    else {
        list.done.push(itemIndex);
        list.done.sort((a, b) => a - b);
        list.times[String(itemIndex)] = new Date(Date.now() + 5 * 3600000).toISOString().slice(11, 16);
    }
    rerender(renderChecklists(checklistData));
    try {
        tg.HapticFeedback.selectionChanged();
    }
    catch (e) { /* ignore */ }
    try {
        const result = await api("/checklists/toggle", {
            method: "POST",
            body: JSON.stringify({ checklist_id: checklistId, item_index: itemIndex }),
        });
        if (!result.ok)
            throw new Error(result.reason || "not_saved");
        if (result.done)
            list.done = result.done;
        if (result.times)
            list.times = result.times;
    }
    catch (err) {
        list.done = before.done;
        list.times = before.times;
        rerender(renderChecklists(checklistData));
        tg.showAlert("Не удалось сохранить отметку. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        checklistBusy = false;
    }
}
async function submitChecklist() {
    const form = root().querySelector("#checklist-form");
    if (!form || !checklistsMode)
        return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const items = String(values.get("items") || "").split("\n").map((item) => item.trim()).filter(Boolean);
    if (title.length < 2 || !items.length) {
        tg.showAlert("Укажите название и хотя бы одну задачу.");
        return;
    }
    const button = form.querySelector(".staff-submit");
    if (button) {
        button.disabled = true;
        button.textContent = "Создаём…";
    }
    try {
        const result = await api(checklistEditId ? "/checklists/update" : "/checklists", {
            method: "POST",
            body: JSON.stringify({ id: checklistEditId || undefined, title, items, positions: checklistPositions }),
        });
        if (!result.ok) {
            tg.showAlert("Проверьте название и список задач.");
            try {
                tg.HapticFeedback.notificationOccurred("error");
            }
            catch (e) { /* ignore */ }
            return;
        }
        try {
            tg.HapticFeedback.notificationOccurred("success");
        }
        catch (e) { /* ignore */ }
        checklistPositions = [];
        checklistEditId = 0;
        checklistTab = "report";
        void loadChecklists();
    }
    catch (err) {
        tg.showAlert("Не удалось создать чек-лист. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        if (button) {
            button.disabled = false;
            button.textContent = checklistEditId ? "Сохранить" : "Создать чек-лист";
        }
    }
}
function deleteChecklist(id) {
    tg.showConfirm("Удалить чек-лист вместе с историей выполнения?", (ok) => {
        if (!ok)
            return;
        void api("/checklists/delete", { method: "POST", body: JSON.stringify({ id }) }).then((r) => {
            if (!r.ok)
                return void tg.showAlert("Не удалось удалить чек-лист.");
            haptic("success");
            void loadChecklists(false);
        }).catch(() => tg.showAlert("Не удалось удалить чек-лист. Проверьте связь."));
    });
}
function shiftIsoDate(iso, days) {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
/** Opens the trainings / checklists screens straight on the manager report tab. */
function openLearningReport(kind) {
    if (kind === "trainings") {
        trainingTab = "progress";
        openTrainings();
    }
    else {
        checklistTab = "report";
        checklistDate = "";
        openChecklists();
    }
}
/** Returns true when the action was handled here. */
function handleLearningAction(action) {
    if (handleAudienceAction(action))
        return true;
    if (action.indexOf("tr-tab:") === 0) {
        const tab = action.slice(7);
        if (tab !== "list" && tab !== "library" && tab !== "progress" && tab !== "new")
            return true;
        if (tab === "library") {
            libScreen = "list";
            void loadLibrary(false);
        }
        if (tab === "new" && trainingTab !== "new") {
            trainingEditId = 0;
            audienceState.tr = [];
        }
        trainingTab = tab;
        haptic("light");
        if (tab === "progress")
            void loadTrainings(false);
        else if (trainingsData)
            rerender(renderTrainings(trainingsData));
        return true;
    }
    if (action.indexOf("tr-edit:") === 0 && trainingsData) {
        const t = trainingsData.trainings.find((x) => x.id === Number(action.slice(8)));
        if (t) {
            trainingEditId = t.id;
            audienceState.tr = (t.audience || []).slice();
            trainingTab = "new";
            haptic("light");
            rerender(renderTrainings(trainingsData));
            root().scrollTop = 0;
        }
        return true;
    }
    if (action === "tr-edit-cancel" && trainingsData) {
        trainingEditId = 0;
        audienceState.tr = [];
        trainingTab = "list";
        rerender(renderTrainings(trainingsData));
        return true;
    }
    if (action.indexOf("tr-done:") === 0) {
        void toggleTraining(Number(action.slice(8)));
        return true;
    }
    if (action.indexOf("tr-delete:") === 0) {
        deleteTraining(Number(action.slice(10)));
        return true;
    }
    if (action.indexOf("tr-emp:") === 0 || action.indexOf("cl-emp:") === 0) {
        const key = action.indexOf("tr-emp:") === 0 ? action.slice(7) : action.slice(7).replace(":", "-");
        const el = root().querySelector(`[data-pe="${key}"]`);
        if (el)
            el.classList.toggle("pe--open");
        return true;
    }
    if (action.indexOf("cl-bytask:") === 0) {
        const el = root().querySelector(`[data-bt="${action.slice(10)}"]`);
        if (el)
            el.classList.toggle("bt-wrap--open");
        return true;
    }
    if (action.indexOf("cl-tab:") === 0) {
        const tab = action.slice(7);
        if (tab !== "report" && tab !== "mine" && tab !== "new")
            return true;
        if (tab === "new" && checklistTab !== "new") {
            checklistEditId = 0;
            checklistPositions = [];
        }
        checklistTab = tab;
        haptic("light");
        if (tab === "report")
            void loadChecklists(false);
        else if (checklistData)
            rerender(renderChecklists(checklistData));
        return true;
    }
    if (action.indexOf("cl-date:") === 0) {
        const dir = Number(action.slice(8));
        if (dir !== -1 && dir !== 1)
            return true;
        const current = checklistDate || uzbekistanToday();
        const next = shiftIsoDate(current, dir);
        if (next > uzbekistanToday())
            return true;
        checklistDate = next;
        void loadChecklistReport().then(() => { if (checklistData && checklistsMode)
            rerender(renderChecklists(checklistData)); });
        return true;
    }
    if (action.indexOf("cl-edit:") === 0 && checklistReport && checklistData) {
        const c = checklistReport.checklists.find((x) => x.id === Number(action.slice(8)));
        if (c) {
            checklistEditId = c.id;
            checklistPositions = c.positions.slice();
            checklistTab = "new";
            haptic("light");
            rerender(renderChecklists(checklistData));
            root().scrollTop = 0;
        }
        return true;
    }
    if (action === "cl-edit-cancel" && checklistData) {
        checklistEditId = 0;
        checklistPositions = [];
        checklistTab = "report";
        rerender(renderChecklists(checklistData));
        return true;
    }
    if (action.indexOf("cl-delete:") === 0) {
        deleteChecklist(Number(action.slice(10)));
        return true;
    }
    if (action.indexOf("cl-pos:") === 0) {
        const key = action.slice(7);
        if (key === "all")
            checklistPositions = [];
        else {
            const name = checklistChoices[Number(key)];
            if (name) {
                const at = checklistPositions.indexOf(name);
                if (at >= 0)
                    checklistPositions.splice(at, 1);
                else
                    checklistPositions.push(name);
            }
        }
        root().querySelectorAll("[data-action^='cl-pos:']").forEach((chip) => {
            const k = (chip.dataset.action || "").slice(7);
            const on = k === "all" ? checklistPositions.length === 0 : checklistPositions.indexOf(checklistChoices[Number(k)]) >= 0;
            chip.classList.toggle("chip--on", on);
        });
        return true;
    }
    return false;
}
let branchesData = null;
let branchDetail = null;
function renderBranches(d) {
    let html = '<div class="screen"><button class="back-link" data-action="branches-back">‹ Назад</button><div class="screen-title">Филиалы</div>';
    html += '<div class="screen-sub">Нажмите на филиал, чтобы переименовать его и посмотреть сотрудников по подразделениям.</div>';
    html += '<div class="section branch-list section--stagger">';
    if (!d.branches.length)
        html += '<div class="empty">Филиалов пока нет</div>';
    d.branches.forEach((b, i) => {
        html += `<button type="button" class="cell cell--tappable" data-action="branch-open:${b.id}" style="--i:${i}"><div class="cell-icon" data-i="branch">${icon("branch")}</div><div class="cell-body"><div class="cell-title">${esc(b.name)}</div>` +
            `<div class="cell-subtitle">${b.address ? esc(b.address) + " · " : ""}${b.staff} ${plural(b.staff, "сотрудник", "сотрудника", "сотрудников")}</div></div><span class="inv-chev">${icon("chevron")}</span></button>`;
    });
    html += "</div>";
    if (d.can_manage) {
        html += '<div class="section-title">Добавить филиал</div>' +
            '<form class="section staff-form staff-form--card" id="branch-form">' +
            '<label class="field"><span class="field-label">Название</span><input name="name" maxlength="80" placeholder="Например, Филиал Чиланзар" required></label>' +
            '<label class="field"><span class="field-label">Адрес</span><input name="address" maxlength="200" placeholder="Необязательно"></label>' +
            '<button class="button staff-submit" type="submit">Добавить филиал</button></form>' +
            '<div class="section-footer">При добавлении сотрудника можно выбрать его филиал. Менеджеры видят только свой филиал, владелец и финансовый директор видят все.</div>';
    }
    return html + "</div>";
}
function renderBranchDetail(d) {
    let html = `<div class="screen"><button class="back-link" data-action="branches-back">‹ Филиалы</button><div class="screen-title">${esc(d.branch.name)}</div>`;
    html += `<div class="screen-sub">${d.branch.address ? esc(d.branch.address) + " · " : ""}${d.total} ${plural(d.total, "сотрудник", "сотрудника", "сотрудников")}</div>`;
    if (d.can_edit) {
        html += '<div class="section-title">Название и адрес</div><form class="section staff-form staff-form--card" id="branch-edit-form">' +
            `<label class="field"><span class="field-label">Название</span><input name="name" maxlength="80" value="${esc(d.branch.name)}" required></label>` +
            `<label class="field"><span class="field-label">Адрес</span><input name="address" maxlength="200" value="${esc(d.branch.address || "")}" placeholder="Необязательно"></label>` +
            '<button class="button staff-submit" type="submit">Сохранить</button></form>';
    }
    if (!d.groups.length)
        return html + '<div class="section-title">Сотрудники</div><div class="section"><div class="empty">В этом филиале пока нет сотрудников</div></div></div>';
    d.groups.forEach((g, gi) => {
        html += `<div class="section-title">${esc(g.name)} · ${g.staff.length}</div><div class="section section--stagger">` + g.staff.map((p, i) => `<div class="person" style="--i:${Math.min(i + gi, 8)}">${avatar(p.name)}<div class="person-main"><div class="person-name">${esc(p.name)}</div><div class="person-sub">${esc(p.position)}</div></div><div class="person-phone">${esc(p.phone || "")}</div></div>`).join("") + "</div>";
    });
    return html + "</div>";
}
async function loadBranches() {
    if (branchDetail) {
        void loadBranchDetail(branchDetail.branch.id, false);
        return;
    }
    root().innerHTML = skeleton(2);
    try {
        const d = await api("/branches");
        if (d.error)
            return void (root().innerHTML = noAccess());
        branchesData = d;
        if (branchesMode)
            root().innerHTML = renderBranches(d);
    }
    catch (e) {
        root().innerHTML = errorState("Не удалось загрузить филиалы. Проверьте связь.");
    }
}
async function loadBranchDetail(id, skeletonFirst) {
    if (skeletonFirst)
        root().innerHTML = skeleton(3);
    try {
        const d = await api("/branches/get?id=" + id);
        if (d.error) {
            branchDetail = null;
            void loadBranches();
            return;
        }
        branchDetail = d;
        if (!branchesMode)
            return;
        if (skeletonFirst)
            root().innerHTML = renderBranchDetail(d);
        else
            rerender(renderBranchDetail(d));
    }
    catch (e) {
        root().innerHTML = errorState("Не удалось загрузить филиал. Проверьте связь.");
    }
}
function branchBack() {
    if (!branchesMode || !branchDetail)
        return false;
    branchDetail = null;
    void loadBranches();
    return true;
}
async function submitBranch() {
    const form = root().querySelector("#branch-form");
    if (!form || !branchesMode)
        return;
    const v = new FormData(form);
    const name = String(v.get("name") || "").trim();
    if (name.length < 2)
        return void tg.showAlert("Укажите название филиала.");
    try {
        const r = await api("/branches", { method: "POST", body: JSON.stringify({ name, address: String(v.get("address") || "").trim() }) });
        if (!r.ok)
            return void tg.showAlert(r.reason === "duplicate" ? "Филиал с таким названием уже есть." : "Проверьте название филиала.");
        haptic("success");
        void loadBranches();
    }
    catch (e) {
        tg.showAlert("Не удалось добавить филиал. Проверьте связь.");
    }
}
async function submitBranchEdit() {
    const form = root().querySelector("#branch-edit-form");
    if (!form || !branchesMode || !branchDetail)
        return;
    const v = new FormData(form);
    const name = String(v.get("name") || "").trim();
    if (name.length < 2)
        return void tg.showAlert("Укажите название филиала.");
    const id = branchDetail.branch.id;
    try {
        const r = await api("/branches/update", { method: "POST", body: JSON.stringify({ id, name, address: String(v.get("address") || "").trim() }) });
        if (!r.ok)
            return void tg.showAlert(r.reason === "duplicate" ? "Филиал с таким названием уже есть." : "Проверьте название филиала.");
        haptic("success");
        void loadBranchDetail(id, false);
    }
    catch (e) {
        tg.showAlert("Не удалось сохранить. Проверьте связь.");
    }
}
function handleBranchesAction(action) {
    if (action === "branches") {
        branchesMode = true;
        branchDetail = null;
        setOverlayControls(true);
        void loadBranches();
        return true;
    }
    if (action === "branches-back") {
        if (!branchBack())
            closeOverlay();
        return true;
    }
    if (action.indexOf("branch-open:") === 0 && branchesMode) {
        haptic("light");
        void loadBranchDetail(Number(action.slice(12)), true);
        return true;
    }
    return false;
}
