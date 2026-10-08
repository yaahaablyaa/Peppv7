"use strict";
/** Shared types, API client, formatting and icons. */
const tg = window.Telegram.WebApp;
const MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
/** Вне Telegram (обычный браузер) вход держится на подписанной сессии. */
const WEB_TOKEN_KEY = "staff_web_token";
function webToken() {
    try {
        return window.localStorage.getItem(WEB_TOKEN_KEY) || "";
    }
    catch (e) {
        return "";
    }
}
function setWebToken(token) {
    try {
        if (token)
            window.localStorage.setItem(WEB_TOKEN_KEY, token);
        else
            window.localStorage.removeItem(WEB_TOKEN_KEY);
    }
    catch (e) { /* ignore */ }
}
async function api(path, init) {
    const res = await fetch("_api" + path, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            Authorization: tg.initData ? "tma " + tg.initData : "web " + webToken(),
            ...(init && init.headers ? init.headers : {}),
        },
    });
    const json = (await res.json());
    if (init && init.method && init.method.toUpperCase() !== "GET" && path.indexOf("/settings/") !== 0 && typeof invalidateTabs === "function")
        invalidateTabs();
    if (json && json.data !== undefined)
        return json.data;
    return json;
}
function money(n) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n || 0)) + " сум";
}
function hoursText(h) {
    const whole = Math.floor(h);
    const mins = Math.round((h - whole) * 60);
    return mins ? `${whole} ч ${mins} мин` : `${whole} ч`;
}
function uzbekistanToday() {
    return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
/** "2026-08-30" -> "30 августа" */
function humanDate(iso) {
    const parts = iso.split("-");
    const d = parseInt(parts[2], 10);
    const m = parseInt(parts[1], 10) - 1;
    return `${d} ${MONTHS_GEN[m] || ""}`;
}
function shortTime(value) {
    if (!value)
        return "—";
    const m = value.match(/(\d{2}:\d{2})/);
    return m ? m[1] : value;
}
function esc(s) {
    return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
function haptic(style) {
    try {
        if (style === "success" || style === "error") {
            tg.HapticFeedback.notificationOccurred(style);
            return;
        }
        tg.HapticFeedback.impactOccurred(style);
    }
    catch (e) {
        /* older clients */
    }
}
const POSITION_LIST = ["Официант", "Хостес", "Кассир", "Повар", "Бариста", "Тех персонал", "Шеф-повар", "Бар-менеджер", "Финансовый директор", "Менеджер"];
const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9.5V20h13V9.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M13.5 13.5h3v3m4 0v4h-7v-3"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3.5"/><path d="M3 10h18M16.5 14.5h1.5"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11m5 9V5m5 15v-7m5 7V9M2 20h20"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 20.5h4"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9 17l10.5-10"/></svg>',
    news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M7 9h7M7 13h10M7 16h6"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.7 4-5.5 7.5-5.5s6.3 1.8 7.5 5.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h7l5 5V20.5H6z"/><path d="M13 3.5V9h5M9 13h6M9 16.5h4"/></svg>',
    exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5H6.5v15H14"/><path d="M11 12h9m0 0-3-3m3 3-3 3"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-3.8-3.8"/></svg>',
    branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6M2.5 20h19"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
};
function icon(name) {
    return ICONS[name] || "";
}
function cell(opts) {
    const cls = "cell" + (opts.tappable ? " cell--tappable" : "") + (opts.icon ? "" : " cell--plain");
    const attr = opts.action ? ` data-action="${opts.action}"` : "";
    return (`<div class="${cls}"${attr}>` +
        (opts.icon ? `<div class="cell-icon" data-i="${opts.icon}">${icon(opts.icon)}</div>` : "") +
        `<div class="cell-body"><div class="cell-title">${esc(opts.title)}</div>` +
        (opts.subtitle ? `<div class="cell-subtitle">${esc(opts.subtitle)}</div>` : "") +
        `</div>` +
        (opts.value ? `<div class="cell-value">${esc(opts.value)}</div>` : "") +
        (opts.tappable ? `<span class="chevron">${icon("chevron")}</span>` : "") +
        `</div>`);
}
function skeleton(blocks) {
    let out = "";
    for (let i = 0; i < blocks; i++)
        out += '<div class="skeleton skeleton--block"></div>';
    return `<div class="screen">${out}</div>`;
}
function errorState(message) {
    return (`<div class="screen"><div class="section"><div class="empty">${esc(message)}</div></div>` +
        `<button class="button button--secondary" data-action="retry">Повторить</button></div>`);
}
/** Outside Telegram (laptop browser) native alert/confirm are replaced by animated in-page dialogs. */
function installDialogs() {
    if (tg.initData)
        return;
    const open = (text, buttons, done) => {
        const back = document.createElement("div");
        back.className = "dlg-back";
        const box = document.createElement("div");
        box.className = "dlg";
        box.setAttribute("role", "alertdialog");
        box.setAttribute("aria-modal", "true");
        const p = document.createElement("p");
        p.className = "dlg-text";
        p.textContent = text;
        const row = document.createElement("div");
        row.className = "dlg-actions";
        let closed = false;
        const close = (v) => {
            if (closed)
                return;
            closed = true;
            document.removeEventListener("keydown", onKey);
            back.classList.add("dlg-back--out");
            window.setTimeout(() => { back.remove(); done(v); }, 150);
        };
        const onKey = (e) => {
            if (e.key === "Escape")
                close(false);
            else if (e.key === "Enter")
                close(buttons[buttons.length - 1].value);
        };
        buttons.forEach((b) => {
            const el = document.createElement("button");
            el.type = "button";
            el.className = "dlg-btn" + (b.main ? " dlg-btn--main" : "");
            el.textContent = b.label;
            el.onclick = () => close(b.value);
            row.appendChild(el);
        });
        box.appendChild(p);
        box.appendChild(row);
        back.appendChild(box);
        back.addEventListener("click", (e) => { if (e.target === back)
            close(false); });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(back);
        const main = row.querySelector(".dlg-btn--main");
        if (main)
            main.focus();
    };
    const t = tg;
    t.showAlert = (message, cb) => open(String(message), [{ label: "Понятно", main: true, value: true }], () => { if (cb)
        cb(); });
    t.showConfirm = (message, cb) => open(String(message), [{ label: "Отмена", value: false }, { label: "Подтвердить", main: true, value: true }], cb);
}
