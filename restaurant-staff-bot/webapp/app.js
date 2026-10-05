"use strict";
/** Screens and navigation for the restaurant staff app. */
const TABS = [
    { id: "home", label: "Главная", icon: "home" },
    { id: "schedule", label: "График", icon: "calendar" },
    { id: "attendance", label: "Приход", icon: "qr" },
    { id: "salary", label: "Зарплата", icon: "wallet" },
    { id: "more", label: "Ещё", icon: "more" },
];
let activeTab = "home";
let calendarMonth = new Date().toISOString().slice(0, 7);
let profile = null;
let staffMode = false;
let staffScreen = "add";
let selectedStaffId = null;
let teamScheduleMode = false;
let announcementsMode = false;
let checklistsMode = false;
let trainingsMode = false;
let trainingsData = null;
let teamScheduleStart = schedulePeriodStart(uzbekistanToday());
let teamScheduleData = null;
let selectedTeamCell = null;
let loginMode = false;
let branchesMode = false;
let salaryMonth = uzbekistanToday().slice(0, 7);
let salaryView = "";
function root() {
    return document.getElementById("app");
}
function noAccess() {
    loginMode = true;
    setOverlayControls(false);
    const tabbar = document.getElementById("tabbar");
    if (tabbar)
        tabbar.hidden = true;
    return '<div class="screen"><div class="screen-title">Вход</div><div class="screen-sub">Введите данные, которые вы получили от менеджера.</div>' +
        '<form class="section" id="login-form">' +
        '<label class="field"><span class="field-label">Номер телефона</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="+998" data-phone-prefix required maxlength="24"></label>' +
        '<label class="field"><span class="field-label">Пароль</span><input name="password" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Пароль" required maxlength="64"></label>' +
        '<button class="button staff-submit" type="submit">Войти</button></form>' +
        '<div class="section-footer">Если у вас нет данных для входа, обратитесь к менеджеру.</div></div>';
}
/* ---------------------------------------------------------------- Главная */
function renderHome(d) {
    const t = d.today;
    const shiftLine = t.has_shift
        ? `${shortTime(t.start_time)} — ${shortTime(t.end_time)}`
        : "Выходной";
    const status = t.check_in
        ? t.check_out
            ? `Смена закрыта в ${shortTime(t.check_out)}`
            : `Вы на смене с ${shortTime(t.check_in)}`
        : t.has_shift
            ? "Приход ещё не отмечен"
            : "Отдыхайте";
    let html = '<div class="screen screen--home">';
    html += `<div class="screen-title">Привет, ${esc(d.employee.name.split(" ")[0])}</div>`;
    html += `<div class="screen-sub">${humanDate(t.date)} · ${esc(d.employee.position)}</div>`;
    if (d.manager_summary) {
        const s = d.manager_summary;
        html += '<div class="section-title">Смены сегодня</div>';
        html += `<div class="hero"><div class="hero-label">Команда</div>` +
            `<div class="hero-value">${s.on_shift} на смене</div>` +
            `<div class="hero-sub">Назначено ${s.scheduled} из ${s.total} сотрудников</div></div>`;
        html += '<div class="stat-row stat-row--manager">' +
            `<div class="stat"><div class="stat-value">${s.late}</div><div class="stat-label">Опоздали</div></div>` +
            `<div class="stat"><div class="stat-value">${s.missing}</div><div class="stat-label">Не отметились</div></div>` +
            `<div class="stat"><div class="stat-value">${s.day_off}</div><div class="stat-label">Выходной</div></div>` +
            '</div>';
    }
    html += `<div class="hero"><div class="hero-label">Моя смена · ${t.has_shift ? "сегодня" : "выходной"}</div>` +
        `<div class="hero-value">${esc(shiftLine)}</div>` +
        `<div class="hero-sub">${esc(status)}${t.late_minutes ? ` · опоздание ${t.late_minutes} мин` : ""}</div>` +
        (t.note ? `<div class="hero-sub">${esc(t.note)}</div>` : "") +
        `</div>`;
    html += '<div class="stat-row">' +
        `<div class="stat"><div class="stat-value">${hoursText(d.salary.hours)}</div><div class="stat-label">Часы за период</div></div>` +
        `<div class="stat"><div class="stat-value">${money(d.salary.amount)}</div><div class="stat-label">Начислено</div></div>` +
        "</div>";
    if (d.progress) {
        const pt = d.progress.trainings;
        const pc = d.progress.checklists;
        const ptPct = pct(pt.done, pt.total);
        const pcPct = pct(pc.items_done, pc.items_total);
        html += '<div class="progress-grid">' +
            `<button type="button" class="pcard" data-action="trainings">${ring(ptPct, 54)}<div class="pcard-text"><div class="pcard-title">Обучение</div><div class="pcard-sub">${pt.done} из ${pt.total}</div></div></button>` +
            `<button type="button" class="pcard" data-action="checklists">${ring(pcPct, 54)}<div class="pcard-text"><div class="pcard-title">Чек-листы</div><div class="pcard-sub">${pc.items_done} из ${pc.items_total} задач</div></div></button></div>`;
    }
    html += '<div class="section-title">Быстрые действия</div><div class="section">';
    html += cell({ icon: "qr", title: "Приход и уход", subtitle: "Отметить смену", tappable: true, action: "tab:attendance" });
    html += cell({ icon: "book", title: "Обучение", value: String(d.counts.trainings), tappable: true, action: "trainings" });
    html += cell({ icon: "check", title: "Чек-листы", value: String(d.counts.checklists), tappable: true, action: "checklists" });
    if (canAnalytics(d.employee))
        html += cell({ icon: "analytics", title: "Аналитика", subtitle: "Периоды и показатели команды", tappable: true, action: "tab:analytics" });
    if (canLead(d.employee) && !isMgr(d.employee))
        html += cell({ icon: "calendar", title: "График для команды", subtitle: "Смены вашего отдела", tappable: true, action: "team-schedule" });
    html += "</div>";
    html += '<div class="section-title">Новости и объявления</div><div class="section">';
    if (!d.news.length) {
        html += '<div class="empty">Пока нет новостей</div>';
    }
    else {
        d.news.forEach((p) => {
            html += cell({
                icon: p.kind === "announcement" ? "bell" : "news",
                title: p.title,
                subtitle: p.body.slice(0, 90),
                value: humanDate(p.created_at.slice(0, 10)),
            });
        });
    }
    html += "</div>";
    if (d.notifications.length) {
        html += '<div class="section-title">Последние уведомления</div><div class="section">';
        d.notifications.slice(0, 5).forEach((n) => {
            html += cell({ icon: "bell", title: n.title, subtitle: n.body, value: humanDate(n.created_at.slice(0, 10)) });
        });
        html += "</div>";
    }
    return html + "</div>";
}
/* ---------------------------------------------------------------- График */
function renderSchedule(d) {
    const [ys, ms] = d.month.split("-");
    const year = parseInt(ys, 10);
    const month = parseInt(ms, 10);
    const byDate = {};
    d.shifts.forEach((s) => (byDate[s.date] = s));
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const todayIso = uzbekistanToday();
    let html = '<div class="screen"><div class="screen-title">Мой график</div>';
    html += '<div class="screen-sub">Личные смены и выходные</div>';
    html += '<div class="month-nav"><button class="nav-arrow" data-action="month:prev" type="button" aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        `<div class="month-name">${MONTHS[month - 1]} ${year}</div>` +
        '<button class="nav-arrow" data-action="month:next" type="button" aria-label="Следующий месяц"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    html += '<div class="section"><div class="cal">';
    DOW.forEach((n) => (html += `<div class="cal-dow">${n}</div>`));
    for (let i = 0; i < offset; i++)
        html += '<div class="cal-day cal-day--empty"></div>';
    for (let day = 1; day <= days; day++) {
        const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const s = byDate[iso];
        let cls = "cal-day";
        if (s && !s.is_day_off)
            cls += " cal-day--shift";
        else if (s && s.is_day_off)
            cls += " cal-day--off";
        if (iso === todayIso)
            cls += " cal-day--today";
        const dot = s && !s.is_day_off && s.start_time ? `<span class="cal-dot">${shortTime(s.start_time)}</span>` : "";
        html += `<div class="${cls}">${day}${dot}</div>`;
    }
    html += "</div></div>";
    const upcoming = d.shifts.filter((s) => s.date >= todayIso);
    html += '<div class="section-title">Ближайшие дни</div><div class="section">';
    if (!upcoming.length) {
        html += '<div class="empty">На этот месяц смен пока нет</div>';
    }
    else {
        upcoming.slice(0, 12).forEach((s) => {
            html += cell({
                icon: "calendar",
                title: humanDate(s.date),
                subtitle: s.is_day_off ? "Выходной" : `${shortTime(s.start_time)} — ${shortTime(s.end_time)}`,
                value: s.note || "",
            });
        });
    }
    html += "</div>";
    html += '<div class="section-footer">График составляет менеджер. При изменениях вам придёт уведомление в бот.</div>';
    return html + "</div>";
}
/* ---------------------------------------------------------------- Приход */
function renderAttendance(d) {
    const t = d.today;
    const canCheckIn = t.has_shift && !t.check_in && !t.check_out;
    const canCheckOut = !!t.check_in && !t.check_out;
    const status = t.check_in ? (t.check_out ? "Смена закрыта" : "На смене") : "Не отмечен";
    let html = '<div class="screen"><div class="screen-title">Приход</div>';
    html += `<div class="screen-sub">${humanDate(t.date)}</div>`;
    html += '<div class="attendance-qr section">';
    if (d.employee.qr_code)
        html += `<img src="${esc(d.employee.qr_code)}" alt="QR-код сотрудника">`;
    else
        html += '<div class="empty">Менеджер ещё не загрузил ваш QR-код.</div>';
    html += '</div>';
    html += '<div class="hero">' +
        `<div class="hero-label">${status}</div>` +
        `<div class="hero-value" id="attendance-timer" data-check-in="${esc(t.check_in || "")}">${t.check_in && !t.check_out ? "00:00:00" : `${shortTime(t.check_in)} — ${shortTime(t.check_out)}`}</div>` +
        `<div class="hero-sub">${t.has_shift ? `По графику ${shortTime(t.start_time)} — ${shortTime(t.end_time)}` : "Сегодня выходной"}${t.late_minutes ? ` · опоздание ${t.late_minutes} мин` : ""}</div></div>`;
    html += '<div class="attendance-actions">';
    html += `<button class="button${canCheckIn ? "" : " button--secondary"} attendance-action" data-action="attendance:check-in"${canCheckIn ? "" : " disabled"}>Приход</button>`;
    html += `<button class="button${canCheckOut ? "" : " button--secondary"} attendance-action" data-action="attendance:check-out"${canCheckOut ? "" : " disabled"}>Уход</button>`;
    html += '</div>';
    html += `<div class="section-footer attendance-hint">${t.check_out ? "Время смены сохранено." : t.has_shift ? "Отсканируйте QR-код в системе Workly и отметьте начало или окончание смены" : "На сегодня смена не назначена."}</div>`;
    html += '<div class="section-title">Сегодня</div><div class="section">';
    html += cell({ icon: "check", title: "Приход", value: shortTime(t.check_in) });
    html += cell({ icon: "check", title: "Уход", value: shortTime(t.check_out) });
    html += cell({ icon: "bell", title: "Опоздание", value: t.late_minutes ? `${t.late_minutes} мин` : "нет" });
    return html + "</div></div>";
}
/* -------------------------------------------------------------- Зарплата */
function renderSalary(d) {
    const periodLabels = { p1: "1–15 число", p2: "16 — конец месяца", full: "Весь месяц" };
    const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const [yy, mm] = d.month.split("-");
    let html = '<div class="screen"><div class="screen-title">Зарплата</div>';
    html += `<div class="screen-sub">Ставка ${money(d.rate)} в час</div>`;
    const atCurrent = d.month >= d.current_month;
    html += '<div class="month-nav"><button class="nav-arrow" data-action="salary-month:-1" type="button" aria-label="Предыдущий месяц"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        `<div class="month-name">${months[Number(mm) - 1]} ${yy}</div>` +
        `<button class="nav-arrow" data-action="salary-month:1" type="button" aria-label="Следующий месяц"${atCurrent ? " disabled" : ""}><svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
    html += segmented("salary", [{ id: "p1", label: "1–15" }, { id: "p2", label: "16–конец" }, { id: "full", label: "Месяц" }], d.view, "salary-view:");
    const payoutLine = d.period.payout ? ` · выплата ${humanDate(d.period.payout)}` : "";
    html += `<div class="hero hero--grad"><div class="hero-label">${periodLabels[d.view]} · ${humanDate(d.period.start)} — ${humanDate(d.period.end)}</div>` +
        `<div class="hero-value" ${countAttr(d.period.amount, "money")}>${money(d.period.amount)}</div>` +
        `<div class="hero-sub">${hoursText(d.period.hours)}${payoutLine}</div></div>`;
    if (d.view === "full") {
        html += '<div class="section-title">По периодам</div><div class="section section--stagger">';
        ["p1", "p2"].forEach((key, i) => {
            const p = d.periods[key];
            const paid = !!p.paid;
            html += `<button type="button" class="cell cell--tappable period-row" data-action="salary-view:${key}" style="--i:${i}"><div class="cell-icon" data-i="wallet">${icon("wallet")}</div>` +
                `<div class="cell-body"><div class="cell-title">${money(p.amount)}</div><div class="cell-subtitle">${periodLabels[key]} · ${hoursText(p.hours)}</div></div>` +
                `<div class="cell-value"><span class="status status--${paid ? "good" : "warn"}">${paid ? "Выплачено" : "Выплата " + humanDate(p.payout || "").replace(/ ([а-я]{3})[а-я]*$/, " $1.")}</span></div></button>`;
        });
        html += "</div>";
    }
    if (d.pending && d.view !== "full") {
        html += '<div class="section"><div class="cell cell--plain"><div class="cell-body">' +
            `<div class="cell-title">${money(d.pending.amount)}</div>` +
            `<div class="cell-subtitle">Ожидает выплаты: ${humanDate(d.pending.start)} — ${humanDate(d.pending.end)} · выплата ${humanDate(d.pending.payout)}</div>` +
            "</div></div></div>";
    }
    html += '<div class="section-title">История смен</div><div class="section section--stagger">';
    if (!d.shifts.length) {
        html += '<div class="empty">В этом периоде отработанных смен пока нет</div>';
    }
    else {
        d.shifts.forEach((s, i) => {
            const h = (s.worked_minutes || 0) / 60;
            html += cell({
                icon: "wallet",
                title: humanDate(s.date),
                subtitle: `${shortTime(s.check_in)} — ${shortTime(s.check_out)} · ${hoursText(h)}` +
                    (s.late_minutes ? ` · опоздание ${s.late_minutes} мин` : ""),
                value: money(h * d.rate),
            }).replace('class="cell', `style="--i:${Math.min(i, 14)}" class="cell`);
        });
    }
    html += "</div>";
    html += '<div class="section-footer">Расчёт по фактически отработанному времени. Два периода в месяц: с 1 по 15 число — выплата 25-го числа этого же месяца; с 16 числа по конец месяца — выплата 10-го числа следующего месяца.</div>';
    return html + "</div>";
}
/* ------------------------------------------------------------------ Ещё */
function renderMore(e) {
    let html = '<div class="screen"><div class="screen-title">Ещё</div>';
    html += '<div class="section">';
    html += cell({ icon: "user", title: e.name, subtitle: `${e.role_title && e.role !== "waiter" ? e.role_title : e.position} · ${e.phone}` });
    html += "</div>";
    if (isMgr(e)) {
        html += '<div class="section-title">Управление</div><div class="section">';
        html += cell({ icon: "user", title: "Команда", subtitle: "Посмотреть сотрудников", tappable: true, action: "team" });
        html += cell({ icon: "user", title: "Добавить сотрудника", subtitle: "Создать новый профиль", tappable: true, action: "staff" });
        html += cell({ icon: "calendar", title: "График для команды", subtitle: "Смены всех сотрудников, включая тех персонал", tappable: true, action: "team-schedule" });
        html += cell({ icon: "analytics", title: "Аналитика", subtitle: "Периоды 1–15, 16–конец и весь месяц", tappable: true, action: "tab:analytics" });
        html += cell({ icon: "book", title: "Прогресс обучения", subtitle: "Кто что изучил", tappable: true, action: "learn-report:trainings" });
        html += cell({ icon: "check", title: "Отчёт по чек-листам", subtitle: "Кто и что выполнил", tappable: true, action: "learn-report:checklists" });
        if (e.perms && e.perms.branches)
            html += cell({ icon: "branch", title: "Филиалы", subtitle: "Список и добавление филиалов", tappable: true, action: "branches" });
        html += "</div>";
    }
    else if (canLead(e)) {
        const scopeText = { chef: "Вы составляете график для поваров", bar_manager: "Вы составляете график для барист и барменов", finance: "Вы видите график всех, составляете график для кассиров" };
        html += '<div class="section-title">Управление</div><div class="section">';
        html += cell({ icon: "calendar", title: "График для команды", subtitle: scopeText[e.role] || "График сотрудников", tappable: true, action: "team-schedule" });
        if (canAnalytics(e))
            html += cell({ icon: "analytics", title: "Аналитика", subtitle: "По всем филиалам и периодам месяца", tappable: true, action: "tab:analytics" });
        if (e.perms && e.perms.branches)
            html += cell({ icon: "branch", title: "Филиалы", subtitle: "Список и добавление филиалов", tappable: true, action: "branches" });
        html += "</div>";
    }
    html += '<div class="section-title">Работа</div><div class="section">';
    html += cell({ icon: "news", title: "Объявления", subtitle: "Новости для команды", tappable: true, action: "announcements" });
    html += cell({ icon: "book", title: "Обучение", subtitle: "Материалы и мой прогресс", tappable: true, action: "trainings" });
    html += cell({ icon: "check", title: "Чек-листы", tappable: true, action: "checklists" });
    html += cell({ icon: "doc", title: "Заявления", subtitle: "Отправить запрос менеджеру", tappable: true, action: "applications" });
    html += "</div>";
    html += '<div class="section-title">Настройки</div><div class="section">';
    html += cell({ icon: "bell", title: "Уведомления", value: e.notifications_on ? "Вкл" : "Выкл", tappable: true, action: "toggle-notifications" });
    const themeLabels = { auto: "Как в Telegram", light: "Светлая", dark: "Тёмная" };
    html += cell({ icon: "settings", title: "Тема", value: themeLabels[e.theme] || "Как в Telegram", tappable: true, action: "theme" });
    html += cell({ icon: "exit", title: "Выход", tappable: true, action: "logout" });
    html += "</div>";
    return html + "</div>";
}
function renderAnnouncements(d) {
    let html = '<div class="screen"><button class="back-link" data-action="announcements-back">‹ Назад</button><div class="screen-title">Объявления</div>';
    html += '<div class="screen-sub">Новости и важная информация для команды.</div>';
    if (d.can_publish) {
        html += '<form class="section staff-form staff-form--card" id="announcement-form">';
        html += '<div class="staff-form-heading">Новое объявление</div>';
        html += '<label class="field"><span class="field-label">Заголовок</span><input name="title" maxlength="120" placeholder="Например, Изменение графика" required></label>';
        html += '<label class="field"><span class="field-label">Текст</span><textarea name="body" maxlength="2000" placeholder="Напишите объявление для команды" required></textarea></label>';
        html += '<button class="button staff-submit" type="submit">Опубликовать</button></form>';
    }
    html += '<div class="section-title">Все объявления</div><div class="section">';
    if (!d.announcements.length) {
        html += '<div class="empty">Объявлений пока нет</div>';
    }
    else {
        d.announcements.forEach((post) => {
            html += cell({ icon: "news", title: post.title, subtitle: post.body, value: humanDate(post.created_at.slice(0, 10)) });
        });
    }
    return html + '</div></div>';
}
function renderStaff(d) {
    let html = '<div class="screen staff-screen"><div class="screen-title">Добавить сотрудника</div>';
    html += '<div class="screen-sub">Создайте профиль и передайте сотруднику данные для входа.</div>';
    html += '<div class="staff-intro section"><div class="staff-intro-icon">' + icon("user") + '</div><div><div class="staff-intro-title">Новый сотрудник</div><div class="staff-intro-sub">После сохранения профиль сразу появится в разделе «Команда».</div></div></div>';
    html += '<form class="staff-form" id="staff-form">';
    html += '<section class="section staff-form-group"><div class="staff-form-heading">Основные данные</div>';
    html += '<label class="field"><span class="field-label">Имя и фамилия</span><input name="full_name" autocomplete="name" placeholder="Например, Анна Каримова" required maxlength="100"></label>';
    html += '<label class="field"><span class="field-label">Номер телефона</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" value="+998" data-phone-prefix required maxlength="24"></label>';
    html += '<label class="field"><span class="field-label">Должность</span><select name="position">' + POSITION_LIST.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("") + '</select></label>';
    if (d.branches && d.branches.length > 1) {
        html += '<label class="field"><span class="field-label">Филиал</span><select name="branch_id">' + d.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("") + '</select></label>';
    }
    html += '</section>';
    html += '<section class="section staff-form-group"><div class="staff-form-heading">Оплата и доступ</div>';
    html += '<label class="field"><span class="field-label">Ставка за час, сум</span><span class="field-input-wrap"><input name="rate" type="number" inputmode="numeric" min="1" step="1" value="20000" required><b>сум/час</b></span></label>';
    html += '<label class="field"><span class="field-label">Пароль сотрудника</span><span class="field-input-wrap"><input id="staff-password" name="password" type="password" autocomplete="new-password" placeholder="Минимум 4 символа" required minlength="4" maxlength="64"><button class="field-toggle" type="button" data-action="toggle-staff-password">Показать</button></span></label>';
    html += '<div class="staff-login-hint">Telegram будет привязан автоматически, когда сотрудник впервые войдёт в приложение.</div></section>';
    html += '<section class="section staff-form-group"><div class="staff-form-heading">QR-код сотрудника</div>';
    html += '<label class="qr-upload"><input name="qr_image" type="file" accept="image/*" required><span class="qr-upload-icon">' + icon("qr") + '</span><span class="qr-upload-title">Загрузить QR-код</span><span class="qr-upload-sub">Изображение до 1,5 МБ. Сотрудник покажет его в разделе «Приход».</span></label></section>';
    html += '<div class="staff-access"><span class="cell-icon">' + icon("check") + '</span><div><b>Аккаунт будет активен</b><small>Сотрудник сможет войти сразу после создания.</small></div></div>';
    html += '<button class="button staff-submit" type="submit">Добавить сотрудника</button>';
    html += "</form>";
    html += '<div class="section-footer">Пароль и QR-код будут привязаны к профилю сотрудника.</div>';
    return html + "</div>";
}
function renderTeam(d) {
    let html = '<div class="screen"><button class="back-link" data-action="team-back">‹ Назад</button><div class="screen-title">Команда</div>';
    html += '<div class="screen-sub">Сотрудники ресторана</div><div class="section">';
    if (!d.employees.length) {
        html += '<div class="empty">Сотрудников пока нет</div>';
    }
    else {
        d.employees.forEach((employee) => {
            html += cell({
                icon: "user",
                title: employee.name,
                subtitle: `${esc(employee.position)} · ${employee.active ? "Активен" : "Неактивен"}`,
                tappable: true,
                action: `team-edit:${employee.id}`,
            });
        });
    }
    return html + '</div></div>';
}
function renderStaffEdit(employee) {
    const positions = POSITION_LIST.slice();
    if (positions.indexOf(employee.position) < 0 && employee.position)
        positions.push(employee.position);
    const options = positions.map((position) => `<option value="${esc(position)}"${employee.position === position ? " selected" : ""}>${esc(position)}</option>`).join("");
    let html = '<div class="screen staff-screen"><button class="back-link" data-action="team">‹ Назад</button><div class="screen-title">Редактирование сотрудника</div>';
    html += '<div class="section staff-profile"><div class="staff-avatar">' + icon("user") + '</div><div class="cell-body"><div class="staff-intro-title">' + esc(employee.name) + '</div><div class="staff-intro-sub">' + esc(employee.position) + '</div></div><span class="pill ' + (employee.active ? "" : "pill--off") + '">' + (employee.active ? "Активен" : "Отключён") + '</span></div>';
    if (employee.salary) {
        html += '<div class="staff-form-heading">Зарплата за текущий период</div><div class="stat-row"><div class="stat"><div class="stat-value">' + hoursText(employee.salary.hours) + '</div><div class="stat-label">Отработано с ' + humanDate(employee.salary.period_start) + ' по ' + humanDate(employee.salary.period_end) + '</div></div><div class="stat"><div class="stat-value">' + money(employee.salary.amount) + '</div><div class="stat-label">К выплате ' + humanDate(employee.salary.payout) + '</div></div></div>';
    }
    html += '<form class="section staff-form staff-form--card" id="team-edit-form"><div class="staff-form-heading">Данные сотрудника</div>';
    html += '<label class="field"><span class="field-label">Имя и фамилия</span><input name="full_name" value="' + esc(employee.name) + '" required maxlength="100"></label>';
    html += '<label class="field"><span class="field-label">Номер телефона</span><input name="phone" type="tel" inputmode="tel" value="' + esc(employee.phone) + '" data-phone-prefix required maxlength="24"></label>';
    html += '<label class="field"><span class="field-label">Должность</span><select name="position">' + options + '</select></label>';
    html += '<label class="field"><span class="field-label">Ставка за час, сум</span><input name="rate" type="number" inputmode="numeric" min="1" value="' + String(employee.rate) + '" required></label>';
    html += '<label class="field"><span class="field-label">Новый пароль</span><span class="field-input-wrap"><input id="team-edit-password" name="password" type="password" placeholder="Оставьте пустым, чтобы не менять" minlength="4" maxlength="64"><button class="field-toggle" type="button" data-action="toggle-edit-password">Показать</button></span></label>';
    html += '<label class="field staff-active"><span><span class="field-label">Доступ</span><b>' + (employee.active ? "Аккаунт активен" : "Аккаунт отключён") + '</b></span><input name="active" type="checkbox"' + (employee.active ? " checked" : "") + '></label>';
    html += '<div class="staff-form-heading">QR-код сотрудника</div><div class="qr-editor">' + (employee.qr_code ? '<img src="' + esc(employee.qr_code) + '" alt="QR-код сотрудника">' : '<div class="qr-editor-empty">QR-код ещё не загружен</div>') + '<label class="button button--secondary qr-change"><input name="qr_image" type="file" accept="image/*">Изменить QR-код</label>' + (employee.qr_code ? '<button class="qr-delete" type="button" data-action="staff-qr-remove:' + employee.id + '">Удалить QR-код</button>' : '') + '</div>';
    html += '<button class="button staff-submit" type="submit">Сохранить изменения</button></form><button class="staff-dismiss" type="button" data-action="staff-remove:' + employee.id + '">Уволить сотрудника</button>';
    return html + '</div>';
}
function schedulePeriodStart(date) {
    const value = new Date(`${date}T00:00:00.000Z`);
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() <= 15 ? 1 : 16))
        .toISOString().slice(0, 10);
}
function scheduleDates(start) {
    const first = new Date(`${schedulePeriodStart(start)}T00:00:00.000Z`);
    const last = first.getUTCDate() === 1
        ? new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 15))
        : new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const dates = [];
    for (const current = new Date(first); current <= last; current.setUTCDate(current.getUTCDate() + 1)) {
        dates.push(current.toISOString().slice(0, 10));
    }
    return dates;
}
function moveTeamSchedulePeriod(direction) {
    const current = new Date(`${teamScheduleStart}T00:00:00.000Z`);
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    const day = current.getUTCDate();
    const next = direction < 0
        ? day === 16 ? new Date(Date.UTC(year, month, 1)) : new Date(Date.UTC(year, month - 1, 16))
        : day === 1 ? new Date(Date.UTC(year, month, 16)) : new Date(Date.UTC(year, month + 1, 1));
    teamScheduleStart = next.toISOString().slice(0, 10);
}
function xlsxText(value) {
    return value.replace(/[ --]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function xlsxColumn(index) {
    let column = "";
    while (index > 0) {
        const remainder = (index - 1) % 26;
        column = String.fromCharCode(65 + remainder) + column;
        index = Math.floor((index - 1) / 26);
    }
    return column;
}
function xlsxCrc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function createXlsx(files) {
    const encoder = new TextEncoder();
    const entries = files.map((file) => ({
        ...file,
        nameBytes: encoder.encode(file.name),
        data: encoder.encode(file.content),
        localOffset: 0,
        crc: 0,
    }));
    const localSize = entries.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.data.length, 0);
    const centralSize = entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
    const output = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(output.buffer);
    let offset = 0;
    const write16 = (value) => { view.setUint16(offset, value, true); offset += 2; };
    const write32 = (value) => { view.setUint32(offset, value >>> 0, true); offset += 4; };
    entries.forEach((entry) => {
        entry.localOffset = offset;
        entry.crc = xlsxCrc32(entry.data);
        write32(0x04034b50);
        write16(20);
        write16(0x0800);
        write16(0);
        write16(0);
        write16(0);
        write32(entry.crc);
        write32(entry.data.length);
        write32(entry.data.length);
        write16(entry.nameBytes.length);
        write16(0);
        output.set(entry.nameBytes, offset);
        offset += entry.nameBytes.length;
        output.set(entry.data, offset);
        offset += entry.data.length;
    });
    const centralOffset = offset;
    entries.forEach((entry) => {
        write32(0x02014b50);
        write16(20);
        write16(20);
        write16(0x0800);
        write16(0);
        write16(0);
        write16(0);
        write32(entry.crc);
        write32(entry.data.length);
        write32(entry.data.length);
        write16(entry.nameBytes.length);
        write16(0);
        write16(0);
        write16(0);
        write16(0);
        write32(0);
        write32(entry.localOffset);
        output.set(entry.nameBytes, offset);
        offset += entry.nameBytes.length;
    });
    write32(0x06054b50);
    write16(0);
    write16(0);
    write16(entries.length);
    write16(entries.length);
    write32(offset - centralOffset);
    write32(centralOffset);
    write16(0);
    return new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function exportTeamSchedule() {
    if (!teamScheduleData)
        return;
    try {
        const data = teamScheduleData;
        const dates = scheduleDates(data.start);
        const shifts = {};
        data.shifts.forEach((shift) => { shifts[`${shift.employee_id}:${shift.date}`] = shift; });
        const cols = dates.length + 2;
        const lastCol = xlsxColumn(cols);
        const endRow = data.employees.length + 3;
        const xml = (value) => xlsxText(value);
        const cell = (row, col, value, style) => `<c r="${xlsxColumn(col)}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(/^[=+\-@]/.test(value) ? `'${value}` : value)}</t></is></c>`;
        const title = `График смен · ${humanDate(data.start)} — ${humanDate(data.end)}`;
        const titleRow = `<row r="1" ht="34" customHeight="1">${cell(1, 1, title, 1)}</row>`;
        const subtitleRow = `<row r="2" ht="25" customHeight="1">${cell(2, 1, 'Смены команды  ·  время указано по местному времени', 2)}</row>`;
        const headings = ['Сотрудник', 'Должность', ...dates.map((date) => `${date.slice(8)}.${date.slice(5, 7)} ${DOW[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7]}`)];
        const headerRow = `<row r="3" ht="36" customHeight="1">${headings.map((value, index) => cell(3, index + 1, value, 3)).join('')}</row>`;
        const rows = data.employees.map((employee, index) => {
            const row = index + 4;
            const base = index % 2 ? 5 : 4;
            const values = [employee.name, employee.position || '—', ...dates.map((date) => {
                    const shift = shifts[`${employee.id}:${date}`];
                    if (!shift)
                        return '—';
                    return shift.is_day_off ? 'Выходной' : `${shortTime(shift.start_time)} – ${shortTime(shift.end_time)}`;
                })];
            return `<row r="${row}" ht="32" customHeight="1">${values.map((value, col) => cell(row, col + 1, value, col < 2 ? base : value === 'Выходной' ? 6 : value === '—' ? base : 7)).join('')}</row>`;
        }).join('');
        const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="C4" sqref="C4"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="30"/><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="20" customWidth="1"/><col min="3" max="${cols}" width="19" customWidth="1"/></cols><sheetData>${titleRow}${subtitleRow}${headerRow}${rows}</sheetData><mergeCells count="2"><mergeCell ref="A1:${lastCol}1"/><mergeCell ref="A2:${lastCol}2"/></mergeCells><autoFilter ref="A3:${lastCol}${Math.max(endRow, 4)}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
        const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17212B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F3F7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9EDF3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE9F5EB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
        const url = URL.createObjectURL(createXlsx([
            { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
            { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
            { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="График" sheetId="1" r:id="rId1"/></sheets></workbook>' },
            { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
            { name: 'xl/styles.xml', content: styles },
            { name: 'xl/worksheets/sheet1.xml', content: sheet },
        ]));
        const link = document.createElement('a');
        link.href = url;
        link.download = `Grafik_${data.start}_${data.end}.xlsx`;
        document.body.appendChild(link);
        link.click();
        window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 60000);
        haptic('light');
    }
    catch (error) {
        try {
            tg.HapticFeedback.notificationOccurred('error');
        }
        catch (e) { /* ignore */ }
        tg.showAlert('Не удалось подготовить файл. Попробуйте ещё раз.');
    }
}
function renderTeamSchedule(d) {
    const dates = scheduleDates(d.start);
    const shiftByCell = {};
    d.shifts.forEach((shift) => (shiftByCell[`${shift.employee_id}:${shift.date}`] = shift));
    const selected = selectedTeamCell ? shiftByCell[`${selectedTeamCell.employeeId}:${selectedTeamCell.date}`] : null;
    const selectedEmployee = selectedTeamCell ? d.employees.find((employee) => employee.id === selectedTeamCell.employeeId) : null;
    const periodLabel = d.start.slice(8) === "01" ? "1–15" : `16–${d.end.slice(8)}`;
    const startDate = new Date(`${d.start}T00:00:00.000Z`);
    let html = '<div class="screen team-schedule-screen"><div class="screen-title">График для команды</div>';
    html += `<div class="screen-sub">${d.scope === "department" ? "Показан ваш отдел. Выберите ячейку, укажите смену и сохраните." : "Выберите ячейку, укажите смену и сохраните. Ячейки сотрудников, чей график вы не ведёте, доступны только для просмотра."}</div>`;
    html += '<div class="team-schedule-toolbar"><button class="team-toolbar-button nav-arrow" data-action="team-range:-1" type="button" aria-label="Предыдущий период"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="team-period-title"><span>' + MONTHS[startDate.getUTCMonth()] + ' ' + startDate.getUTCFullYear() + '</span><small>' + periodLabel + '</small></div><button class="team-toolbar-button nav-arrow" data-action="team-range:1" type="button" aria-label="Следующий период"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>';
    html += '<div class="team-schedule-actions"><button class="team-export-button" data-action="team-export" type="button">' + icon("doc") + '<span>Скачать Excel</span></button></div>';
    if (selectedTeamCell && selectedEmployee) {
        const isDayOff = !selected || !!selected.is_day_off;
        html += '<form class="section team-cell-form" id="team-cell-form">';
        html += `<div class="team-cell-heading"><span class="team-cell-avatar">${icon("calendar")}</span><span class="team-cell-person"><b>${esc(selectedEmployee.name)}</b><small>${humanDate(selectedTeamCell.date)}</small></span></div>`;
        html += '<div class="team-cell-kind"><label><input type="radio" name="kind" value="shift"' + (isDayOff ? "" : " checked") + '><span>Смена</span></label>';
        html += '<label><input type="radio" name="kind" value="day_off"' + (isDayOff ? " checked" : "") + '><span>Выходной</span></label></div>';
        html += '<div class="time-fields"><label class="field"><span class="field-label">Начало</span><input name="start_time" type="time" value="' + esc(selected && selected.start_time ? shortTime(selected.start_time) : "10:00") + '" required></label>';
        html += '<label class="field"><span class="field-label">Конец</span><input name="end_time" type="time" value="' + esc(selected && selected.end_time ? shortTime(selected.end_time) : "22:00") + '" required></label></div>';
        html += '<button class="button team-cell-submit" type="submit">Сохранить смену</button></form>';
    }
    html += '<div class="team-table-card"><div class="team-table-wrap"><table class="team-table"><thead><tr><th class="team-name-head">Сотрудник</th>';
    dates.forEach((date) => {
        const weekday = DOW[(new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7];
        html += `<th class="team-date-head${date === uzbekistanToday() ? " team-date-head--today" : ""}"><small>${weekday}</small><b>${date.slice(8)}</b></th>`;
    });
    html += '</tr></thead><tbody>';
    if (!d.employees.length) {
        html += `<tr><td class="team-empty" colspan="${dates.length + 1}">Сотрудников пока нет</td></tr>`;
    }
    else {
        d.employees.forEach((employee) => {
            html += `<tr><th class="team-name"><span>${esc(employee.name)}</span><small>${esc(employee.position || "Должность не указана")}${employee.can_edit === false ? " · просмотр" : ""}</small><em>${esc(employee.phone || "Телефон не указан")}</em></th>`;
            dates.forEach((date) => {
                const shift = shiftByCell[`${employee.id}:${date}`];
                const active = selectedTeamCell && selectedTeamCell.employeeId === employee.id && selectedTeamCell.date === date;
                const label = shift && !shift.is_day_off ? `${shortTime(shift.start_time)}<br>${shortTime(shift.end_time)}` : "Выходной";
                const editable = employee.can_edit !== false;
                html += `<td><button class="team-shift${shift && !shift.is_day_off ? " team-shift--work" : " team-shift--off"}${active ? " team-shift--selected" : ""}${editable ? "" : " team-shift--locked"}" ${editable ? `data-action="team-cell:${employee.id}:${date}"` : "disabled"} type="button">${label}</button></td>`;
            });
            html += '</tr>';
        });
    }
    html += '</tbody></table></div></div><div class="section-footer">Изменения сохраняются по кнопке «Сохранить смену». Сотрудник сразу получит уведомление.</div></div>';
    return html;
}
/* --------------------------------------------------------------- Роутер */
function setOverlayControls(_visible) {
    const isSubscreen = !loginMode && (activeTab === "analytics" || staffMode || teamScheduleMode || announcementsMode || checklistsMode || trainingsMode || applicationsMode || branchesMode);
    document.body.classList.remove("has-main-button");
    document.body.classList.remove("has-native-back");
    try {
        tg.MainButton.hide();
        if (isSubscreen && tg.initData) {
            tg.BackButton.show();
            document.body.classList.add("has-native-back");
        }
        else {
            tg.BackButton.hide();
        }
    }
    catch (e) {
        /* Keep the in-page back link on clients without a native back button. */
    }
}
async function loadStaff() {
    root().innerHTML = skeleton(4);
    try {
        const d = await api("/staff");
        if (d.error)
            return void (root().innerHTML = noAccess());
        root().innerHTML = renderStaff(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить сотрудников. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
function showTabLoading(blocks) {
    root().innerHTML = '<div class="tab-loading" aria-busy="true"><div class="tab-loading-progress"><span></span></div>' + skeleton(blocks) + "</div>";
}
/* ---- tab navigation: instant from cache, prefetch, directional transitions ---- */
const TAB_ORDER = ["home", "schedule", "attendance", "salary", "more", "analytics"];
const tabCache = {};
const tabPending = {};
let paintedTab = null;
let tabSeq = 0;
let prefetchTimer = 0;
function tabKey(tab) {
    if (tab === "schedule")
        return "schedule:" + calendarMonth;
    if (tab === "salary")
        return "salary:" + salaryMonth + ":" + (salaryView || "auto");
    return tab;
}
function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/** Builds the HTML of a tab from the server. Never touches the DOM except tab bar bootstrap. */
async function buildTab(tab) {
    try {
        if (tab === "home" || tab === "attendance") {
            const d = await api("/home");
            if (d.error)
                return { html: noAccess(), ok: false };
            const first = !profile;
            profile = d.employee;
            applyTheme(profile.theme);
            if (first || !document.querySelector(".tab"))
                buildTabBar();
            return { html: tab === "home" ? renderHome(d) : renderAttendance(d), ok: true };
        }
        if (tab === "schedule") {
            const d = await api("/schedule?month=" + calendarMonth);
            if (d.error)
                return { html: noAccess(), ok: false };
            return { html: renderSchedule(d), ok: true };
        }
        if (tab === "salary") {
            const d = await api("/salary?month=" + salaryMonth + (salaryView ? "&view=" + salaryView : ""));
            if (d.error)
                return { html: noAccess(), ok: false };
            salaryMonth = d.month;
            salaryView = d.view;
            return { html: renderSalary(d), ok: true };
        }
        if (tab === "analytics") {
            if (!profile) {
                const me = await api("/me");
                if (!me.employee)
                    return { html: noAccess(), ok: false };
                profile = me.employee;
            }
            if (!canAnalytics(profile))
                return { html: errorState("Раздел доступен менеджеру и финансовому директору."), ok: false };
            const d = await api(`/analytics/overview?view=${analyticsView}&month=${analyticsMonth}&branch=${analyticsBranch}`);
            if (d.error)
                return { html: errorState("Не удалось загрузить аналитику."), ok: false };
            analyticsData = d;
            return { html: renderAnalytics(d), ok: true };
        }
        const d = profile ? { employee: profile } : await api("/me");
        if (!d.employee)
            return { html: noAccess(), ok: false };
        profile = d.employee;
        applyTheme(profile.theme);
        return { html: renderMore(d.employee), ok: true };
    }
    catch (err) {
        return { html: errorState("Не удалось загрузить данные. Проверьте связь."), ok: false };
    }
}
function requestTab(tab) {
    const key = tabKey(tab);
    const pending = tabPending[key];
    if (pending)
        return pending;
    const p = buildTab(tab).then((r) => {
        delete tabPending[key];
        if (r.ok)
            tabCache[key] = r.html;
        return r;
    });
    tabPending[key] = p;
    return p;
}
function prefetchTab(tab) {
    if (loginMode || !profile)
        return;
    const key = tabKey(tab);
    if (tabCache[key] === undefined && !tabPending[key])
        void requestTab(tab);
}
function prefetchAll() {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
        ["schedule", "attendance", "salary", "more", "home"].forEach(prefetchTab);
    }, 350);
}
function invalidateTabs() {
    Object.keys(tabCache).forEach((k) => delete tabCache[k]);
    if (paintedTab)
        prefetchAll();
}
/** Swaps the content. kind: "switch" slides between tabs, "stay" quietly refreshes, "first" is the initial paint. */
function paintTab(tab, html, kind, dir) {
    const el = root();
    const keepScroll = kind === "stay";
    const y = el.scrollTop;
    const apply = (anim) => {
        el.innerHTML = html;
        const screen = el.querySelector(".screen");
        if (screen) {
            if (anim === "static")
                screen.classList.add("screen--static");
            else if (anim)
                screen.classList.add(anim);
        }
        el.scrollTop = keepScroll ? y : 0;
    };
    paintedTab = tab;
    if (kind === "first")
        return apply("");
    if (kind === "stay")
        return apply("screen--static");
    const doc = document;
    if (doc.startViewTransition && !prefersReducedMotion()) {
        const html5 = document.documentElement;
        html5.dataset.vt = dir >= 0 ? "fwd" : "back";
        try {
            const t = doc.startViewTransition(() => apply("screen--vt"));
            t.finished.then(() => { delete html5.dataset.vt; }, () => { delete html5.dataset.vt; });
            return;
        }
        catch (e) {
            delete html5.dataset.vt;
        }
    }
    apply(dir >= 0 ? "screen--from-right" : "screen--from-left");
}
async function loadTab(tab) {
    if (loginMode) {
        loginMode = false;
        const tabbar = document.getElementById("tabbar");
        if (tabbar)
            tabbar.hidden = false;
    }
    const seq = ++tabSeq;
    const key = tabKey(tab);
    const sameTab = paintedTab === tab;
    const dir = sameTab ? 0 : TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(paintedTab || "home") ? 1 : -1;
    const kind = paintedTab === null ? "first" : sameTab ? "stay" : "switch";
    const cached = tabCache[key];
    // Instant paint from cache, then refresh in the background without replaying animations.
    if (cached !== undefined && kind !== "stay") {
        paintTab(tab, cached, kind, dir);
        const r = await requestTab(tab);
        if (seq !== tabSeq || !r.ok || r.html === cached)
            return;
        paintTab(tab, r.html, "stay", 0);
        return;
    }
    // Nothing cached: keep the current screen until data arrives (no skeleton flash).
    // Only the very first paint, or a long wait, shows a skeleton.
    let skeletonTimer = 0;
    if (kind === "first")
        showTabLoading(tab === "schedule" ? 2 : 3);
    else
        skeletonTimer = window.setTimeout(() => { if (seq === tabSeq)
            showTabLoading(tab === "schedule" ? 2 : 3); }, 450);
    const result = await requestTab(tab);
    window.clearTimeout(skeletonTimer);
    if (seq !== tabSeq)
        return;
    if (!result.ok) {
        root().innerHTML = result.html;
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
        paintedTab = null;
        return;
    }
    paintTab(tab, result.html, kind === "first" ? "first" : kind, dir);
    if (kind === "first")
        prefetchAll();
}
function closeOverlay() {
    if (activeTab === "analytics") {
        setTab("more");
        return;
    }
    if (staffMode && staffScreen === "edit") {
        openTeam();
        return;
    }
    if (!staffMode && !teamScheduleMode && !announcementsMode && !checklistsMode && !trainingsMode && !applicationsMode && !branchesMode)
        return;
    staffMode = false;
    staffScreen = "add";
    selectedStaffId = null;
    teamScheduleMode = false;
    announcementsMode = false;
    checklistsMode = false;
    trainingsMode = false;
    applicationsMode = false;
    branchesMode = false;
    trainingsData = null;
    setOverlayControls(false);
    void loadTab("more");
}
function openStaff() {
    staffMode = true;
    staffScreen = "add";
    selectedStaffId = null;
    teamScheduleMode = false;
    haptic("light");
    setOverlayControls(true);
    void loadStaff();
}
async function loadTeam() {
    root().innerHTML = skeleton(4);
    try {
        const d = await api("/staff");
        if (d.error)
            return void (root().innerHTML = noAccess());
        root().innerHTML = renderTeam(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить команду. Проверьте связь.");
    }
}
function openTeam() {
    staffMode = true;
    staffScreen = "team";
    selectedStaffId = null;
    teamScheduleMode = false;
    haptic("light");
    setOverlayControls(false);
    void loadTeam();
}
async function loadTeamEdit(employeeId) {
    selectedStaffId = employeeId;
    staffMode = true;
    staffScreen = "edit";
    setOverlayControls(false);
    root().innerHTML = skeleton(4);
    try {
        const d = await api("/staff/member?id=" + employeeId);
        if (!d.employee)
            return void (root().innerHTML = errorState("Сотрудник не найден."));
        root().innerHTML = renderStaffEdit(d.employee);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить данные сотрудника. Проверьте связь.");
    }
}
async function loadAnnouncements() {
    root().innerHTML = skeleton(3);
    try {
        const d = await api("/announcements");
        if (d.error)
            return void (root().innerHTML = noAccess());
        root().innerHTML = renderAnnouncements(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить объявления. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
function openAnnouncements() {
    announcementsMode = true;
    checklistsMode = false;
    staffMode = false;
    teamScheduleMode = false;
    haptic("light");
    setOverlayControls(false);
    void loadAnnouncements();
}
function openTrainings() {
    if (!isMgr(profile))
        trainingTab = "list";
    trainingsMode = true;
    announcementsMode = false;
    checklistsMode = false;
    staffMode = false;
    teamScheduleMode = false;
    haptic("light");
    setOverlayControls(false);
    void loadTrainings();
}
function openChecklists() {
    if (!isMgr(profile))
        checklistTab = "mine";
    else if (checklistTab !== "report" && checklistTab !== "new")
        checklistTab = "report";
    checklistsMode = true;
    announcementsMode = false;
    staffMode = false;
    teamScheduleMode = false;
    haptic("light");
    setOverlayControls(false);
    void loadChecklists();
}
async function loadTeamSchedule() {
    root().innerHTML = skeleton(4);
    try {
        const d = await api("/schedule/team?start=" + teamScheduleStart);
        if (d.error)
            return void (root().innerHTML = noAccess());
        teamScheduleData = d;
        root().innerHTML = renderTeamSchedule(d);
    }
    catch (err) {
        root().innerHTML = errorState("Не удалось загрузить график команды. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
function openTeamSchedule() {
    teamScheduleMode = true;
    staffMode = false;
    selectedTeamCell = null;
    haptic("light");
    setOverlayControls(false);
    void loadTeamSchedule();
}
function setTab(tab) {
    if (staffMode || teamScheduleMode || announcementsMode || checklistsMode || trainingsMode || applicationsMode || branchesMode) {
        staffMode = false;
        staffScreen = "add";
        selectedStaffId = null;
        teamScheduleMode = false;
        announcementsMode = false;
        checklistsMode = false;
        trainingsMode = false;
        applicationsMode = false;
        branchesMode = false;
    }
    activeTab = tab;
    setOverlayControls(false);
    document.querySelectorAll(".tab").forEach((el) => {
        el.classList.toggle("tab--active", el.dataset.tab === (tab === "analytics" ? "more" : tab));
    });
    document.querySelectorAll(".side-link").forEach((el) => {
        el.classList.toggle("side-link--on", el.dataset.action === "tab:" + tab);
    });
    haptic("light");
    void loadTab(tab);
}
function shiftMonth(delta) {
    const parts = calendarMonth.split("-");
    const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + delta, 1));
    calendarMonth = d.toISOString().slice(0, 7);
    void loadTab("schedule");
}
/** Laptop sidebar: brand, role shortcuts and the signed-in person. Hidden on phones by CSS. */
function sideExtras() {
    const e = profile;
    const links = [];
    if (e && isMgr(e)) {
        links.push({ icon: "calendar", title: "График для команды", action: "team-schedule" });
        links.push({ icon: "analytics", title: "Аналитика", action: "tab:analytics" });
        links.push({ icon: "user", title: "Команда", action: "team" });
        links.push({ icon: "user", title: "Добавить сотрудника", action: "staff" });
        links.push({ icon: "book", title: "Прогресс обучения", action: "learn-report:trainings" });
        links.push({ icon: "check", title: "Отчёт по чек-листам", action: "learn-report:checklists" });
        if (e.perms && e.perms.branches)
            links.push({ icon: "branch", title: "Филиалы", action: "branches" });
    }
    else if (e && canLead(e)) {
        links.push({ icon: "calendar", title: "График для команды", action: "team-schedule" });
        if (canAnalytics(e))
            links.push({ icon: "analytics", title: "Аналитика", action: "tab:analytics" });
        if (e.perms && e.perms.branches)
            links.push({ icon: "branch", title: "Филиалы", action: "branches" });
    }
    if (e) {
        links.push({ icon: "news", title: "Объявления", action: "announcements" });
        links.push({ icon: "book", title: "Обучение", action: "trainings" });
        links.push({ icon: "check", title: "Чек-листы", action: "checklists" });
    }
    const top = '<div class="side-brand"><span class="side-logo">' + icon("home") + '</span><span class="side-brand-text">Рабочее место<small>Персонал ресторана</small></span></div>';
    const mid = links.length
        ? '<div class="side-sep">Разделы</div>' + links.map((l) => `<button type="button" class="side-link" data-action="${l.action}">${icon(l.icon)}<span>${esc(l.title)}</span></button>`).join("")
        : "";
    const bottom = e
        ? `<div class="side-user">${avatar(e.name)}<div class="side-user-text"><b>${esc(e.name)}</b><small>${esc((e.role !== "waiter" && e.role_title) ? e.role_title : e.position)}</small></div></div>`
        : "";
    return { top, bottom: mid + bottom };
}
function buildTabBar() {
    const bar = document.getElementById("tabbar");
    const extras = sideExtras();
    bar.innerHTML = extras.top + '<div class="tab-group">' + TABS.map((t) => `<button class="tab${(t.id === activeTab || t.id === "more" && activeTab === "analytics") ? " tab--active" : ""}" data-tab="${t.id}">` +
        `${icon(t.icon)}<span>${t.label}</span></button>`).join("") + "</div>" + extras.bottom;
    bar.onpointerdown = (ev) => {
        const btn = ev.target.closest(".tab");
        if (btn && btn.dataset.tab)
            prefetchTab(btn.dataset.tab);
    };
    bar.onclick = (ev) => {
        const link = ev.target.closest(".side-link");
        if (link && link.dataset.action) {
            haptic("light");
            handleAction(link.dataset.action);
            return;
        }
        const btn = ev.target.closest(".tab");
        if (btn && btn.dataset.tab)
            setTab(btn.dataset.tab);
    };
}
function showLoginAlert(message) {
    window.alert(message);
}
async function submitLogin() {
    const form = root().querySelector("#login-form");
    if (!form)
        return;
    const values = new FormData(form);
    const phone = String(values.get("phone") || "").trim();
    const password = String(values.get("password") || "");
    const button = form.querySelector("button");
    if (!phone || !password)
        return showLoginAlert("Укажите номер телефона и пароль.");
    if (button) {
        button.disabled = true;
        button.textContent = "Входим…";
    }
    try {
        if (!tg.initData) {
            const session = await api("/web/session", { method: "POST", body: JSON.stringify({ phone, password }) });
            if (!session.ok || !session.token) {
                const webMessages = { not_found: "Сотрудник с таким номером не найден.", inactive: "Учётная запись отключена. Обратитесь к менеджеру.", bad_password: "Неверный пароль.", too_many: "Слишком много попыток. Подождите 15 минут." };
                showLoginAlert(webMessages[session.reason || ""] || "Не удалось выполнить вход.");
                return;
            }
            setWebToken(session.token);
        }
        const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) });
        if (!result.ok || !result.employee) {
            const messages = { not_found: "Сотрудник с таким номером не найден.", inactive: "Учётная запись отключена. Обратитесь к менеджеру.", bad_password: "Неверный пароль." };
            showLoginAlert(messages[result.reason || ""] || "Не удалось выполнить вход.");
            return;
        }
        profile = result.employee;
        haptic("light");
        void loadTab("home");
    }
    catch (err) {
        showLoginAlert("Не удалось выполнить вход. Проверьте связь.");
    }
    finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Войти";
        }
    }
}
async function submitAttendance(kind) {
    const button = root().querySelector(`[data-action="attendance:${kind}"]`);
    if (button) {
        button.disabled = true;
        button.textContent = "Сохраняем…";
    }
    try {
        const result = await api(`/attendance/${kind}`, {
            method: "POST",
            body: "{}",
        });
        if (!result.ok) {
            const messages = {
                no_shift: "На сегодня смена не назначена.",
                already_checked_in: "Приход уже отмечен.",
                already_checked_out: "Смена уже закрыта.",
                no_check_in: "Сначала отметьте приход.",
            };
            tg.showAlert(messages[result.reason || ""] || "Не удалось сохранить отметку.");
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
        void loadTab("attendance");
    }
    catch (err) {
        tg.showAlert("Не удалось сохранить отметку. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
        if (button) {
            button.disabled = false;
            button.textContent = kind === "check-in" ? "Отметить приход" : "Отметить уход";
        }
    }
}
async function removeStaff(employeeId) {
    if (!staffMode)
        return;
    tg.showConfirm("Уволить сотрудника? Его профиль, QR-код, график, отметки и другие рабочие данные будут удалены без возможности восстановления.", (confirmed) => {
        if (!confirmed)
            return;
        void api("/staff/remove", {
            method: "POST",
            body: JSON.stringify({ employee_id: employeeId }),
        }).then((result) => {
            if (!result.ok) {
                const messages = {
                    self: "Нельзя уволить себя.",
                    last_manager: "Нельзя уволить единственного менеджера.",
                    not_found: "Сотрудник не найден.",
                };
                tg.showAlert(messages[result.reason || ""] || "Не удалось уволить сотрудника.");
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
            void loadStaff();
        }).catch(() => {
            tg.showAlert("Не удалось удалить сотрудника. Проверьте связь.");
            try {
                tg.HapticFeedback.notificationOccurred("error");
            }
            catch (e) { /* ignore */ }
        });
    });
}
async function submitStaff() {
    const form = root().querySelector("#staff-form");
    if (!form || !staffMode)
        return;
    const values = new FormData(form);
    const fullName = String(values.get("full_name") || "").trim();
    const phone = String(values.get("phone") || "").trim();
    const position = String(values.get("position") || "Официант");
    const password = String(values.get("password") || "");
    const rate = Number(values.get("rate"));
    const qrFile = values.get("qr_image");
    if (!Number.isSafeInteger(rate) || rate <= 0 || rate > 2147483647) {
        tg.showAlert("Укажите ставку за час целым положительным числом в сумах.");
        return;
    }
    if (!fullName || !phone || password.length < 4 || !qrFile || !qrFile.size) {
        tg.showAlert("Заполните все поля, включая пароль и QR-код.");
        return;
    }
    if (qrFile.size > 1500000 || !qrFile.type.startsWith("image/")) {
        tg.showAlert("Загрузите изображение QR-кода размером до 1,5 МБ.");
        return;
    }
    const fallbackButton = form.querySelector(".staff-submit");
    if (fallbackButton)
        fallbackButton.disabled = true;
    try {
        tg.MainButton.showProgress();
    }
    catch (e) { /* unavailable on older clients */ }
    try {
        const result = await api("/staff", {
            method: "POST",
            body: JSON.stringify({ full_name: fullName, phone, position, password, rate, qr_image: await fileAsDataUrl(qrFile), ...(values.get("branch_id") ? { branch_id: Number(values.get("branch_id")) } : {}) }),
        });
        if (!result.ok) {
            const message = result.reason === "owner_only"
                ? "Должность финансового директора может назначить только владелец."
                : result.reason === "duplicate"
                    ? "Сотрудник с этим номером уже добавлен."
                    : result.reason === "bad_name"
                        ? "Проверьте имя сотрудника."
                        : result.reason === "bad_pay"
                            ? "Укажите ставку за час целым положительным числом в сумах."
                            : result.reason === "bad_qr"
                                ? "Проверьте изображение QR-кода."
                                : result.reason === "bad_password"
                                    ? "Пароль должен состоять минимум из 4 символов."
                                    : "Проверьте номер телефона и попробуйте снова.";
            tg.showAlert(message);
            try {
                tg.HapticFeedback.notificationOccurred("error");
            }
            catch (e) { /* ignore */ }
            return;
        }
        form.reset();
        try {
            tg.HapticFeedback.notificationOccurred("success");
        }
        catch (e) { /* ignore */ }
        tg.showAlert("Сотрудник добавлен. Передайте сотруднику заданные вами номер телефона и пароль для входа.");
        void loadStaff();
    }
    catch (err) {
        tg.showAlert("Не удалось добавить сотрудника. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        if (fallbackButton)
            fallbackButton.disabled = false;
        try {
            tg.MainButton.hideProgress();
        }
        catch (e) { /* ignore */ }
    }
}
async function submitTeamEdit() {
    const form = root().querySelector("#team-edit-form");
    if (!form || !selectedStaffId)
        return;
    const values = new FormData(form);
    const button = form.querySelector(".staff-submit");
    const qrFile = values.get("qr_image");
    if (qrFile && qrFile.size && (qrFile.size > 1500000 || !qrFile.type.startsWith("image/"))) {
        tg.showAlert("Загрузите изображение QR-кода размером до 1,5 МБ.");
        return;
    }
    if (button)
        button.disabled = true;
    try {
        const result = await api("/staff/update", {
            method: "POST",
            body: JSON.stringify({
                employee_id: selectedStaffId,
                full_name: String(values.get("full_name") || "").trim(),
                phone: String(values.get("phone") || "").trim(),
                position: String(values.get("position") || ""),
                rate: Number(values.get("rate") || 0),
                password: String(values.get("password") || ""),
                active: values.get("active") === "on",
                qr_image: qrFile && qrFile.size ? await fileAsDataUrl(qrFile) : "",
            }),
        });
        if (!result.ok) {
            const messages = {
                duplicate: "Сотрудник с этим номером уже существует.",
                bad_phone: "Проверьте номер телефона.",
                bad_name: "Проверьте имя сотрудника.",
                bad_password: "Пароль должен состоять минимум из 4 символов.",
                bad_qr: "Проверьте изображение QR-кода.",
                bad_pay: "Укажите ставку за час целым положительным числом в сумах.",
                last_manager: "Нельзя отключить единственного менеджера.",
            };
            tg.showAlert(messages[result.reason || ""] || "Проверьте заполненные данные.");
            return;
        }
        try {
            tg.HapticFeedback.notificationOccurred("success");
        }
        catch (e) { /* ignore */ }
        openTeam();
    }
    catch (err) {
        tg.showAlert("Не удалось сохранить изменения. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        if (button)
            button.disabled = false;
    }
}
async function submitAnnouncement() {
    const form = root().querySelector("#announcement-form");
    if (!form || !announcementsMode)
        return;
    const values = new FormData(form);
    const title = String(values.get("title") || "").trim();
    const body = String(values.get("body") || "").trim();
    if (title.length < 2 || body.length < 2) {
        showLoginAlert("Укажите заголовок и текст объявления.");
        return;
    }
    const button = form.querySelector(".staff-submit");
    if (button) {
        button.disabled = true;
        button.textContent = "Публикуем…";
    }
    try {
        const result = await api("/announcements", {
            method: "POST",
            body: JSON.stringify({ title, body }),
        });
        if (!result.ok) {
            showLoginAlert("Не удалось опубликовать объявление. Проверьте текст.");
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
        void loadAnnouncements();
    }
    catch (err) {
        showLoginAlert("Не удалось опубликовать объявление. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
    finally {
        if (button) {
            button.disabled = false;
            button.textContent = "Опубликовать";
        }
    }
}
async function submitTeamCell() {
    const form = root().querySelector("#team-cell-form");
    if (!form || !teamScheduleMode || !selectedTeamCell)
        return;
    const values = new FormData(form);
    const button = form.querySelector(".team-cell-submit");
    if (button) {
        if (button.disabled)
            return;
        button.disabled = true;
        button.textContent = "Сохраняем…";
    }
    try {
        const result = await api("/schedule/team/cell", {
            method: "POST",
            body: JSON.stringify({
                employee_id: selectedTeamCell.employeeId,
                date: selectedTeamCell.date,
                kind: String(values.get("kind") || ""),
                start_time: String(values.get("start_time") || ""),
                end_time: String(values.get("end_time") || ""),
            }),
        });
        if (!result.ok) {
            tg.showAlert("Проверьте время смены и попробуйте снова.");
            try {
                tg.HapticFeedback.notificationOccurred("error");
            }
            catch (e) { /* ignore */ }
            if (button) {
                button.disabled = false;
                button.textContent = "Сохранить смену";
            }
            return;
        }
        selectedTeamCell = null;
        try {
            tg.HapticFeedback.notificationOccurred("success");
        }
        catch (e) { /* ignore */ }
        void loadTeamSchedule();
    }
    catch (err) {
        tg.showAlert("Не удалось сохранить график. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
        if (button)
            button.disabled = false;
    }
}
function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
function applyTheme(theme) {
    const resolved = theme === "auto" ? tg.colorScheme : theme;
    document.body.dataset.theme = theme;
    document.body.classList.toggle("dark", resolved === "dark");
}
async function saveTheme(theme) {
    if (!profile)
        return;
    const previousTheme = profile.theme;
    profile.theme = theme;
    applyTheme(theme);
    haptic("light");
    try {
        const result = await api("/settings/theme", {
            method: "POST",
            body: JSON.stringify({ theme }),
        });
        if (!result.ok)
            throw new Error("theme_not_saved");
        void loadTab("more");
    }
    catch (err) {
        profile.theme = previousTheme;
        applyTheme(previousTheme);
        tg.showAlert("Не удалось сохранить тему. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
async function toggleNotifications() {
    if (!profile)
        return;
    const notificationsOn = !profile.notifications_on;
    try {
        const result = await api("/settings/notifications", {
            method: "POST",
            body: JSON.stringify({ notifications_on: notificationsOn }),
        });
        if (!result.ok)
            throw new Error("notifications_not_saved");
        profile.notifications_on = result.notifications_on === undefined ? notificationsOn : result.notifications_on;
        haptic("success");
        void loadTab("more");
    }
    catch (err) {
        tg.showAlert("Не удалось изменить настройки уведомлений. Проверьте связь.");
        try {
            tg.HapticFeedback.notificationOccurred("error");
        }
        catch (e) { /* ignore */ }
    }
}
function chooseTheme() {
    try {
        tg.showPopup({ title: "Тема", message: "Выберите оформление приложения", buttons: [
                { id: "light", type: "default", text: "Светлая" },
                { id: "dark", type: "default", text: "Тёмная" },
                { id: "auto", type: "default", text: "Как в Telegram" },
            ] }, (id) => {
            if (id === "light" || id === "dark" || id === "auto")
                void saveTheme(id);
        });
    }
    catch (e) {
        tg.showAlert("Откройте приложение в Telegram, чтобы изменить тему.");
    }
}
async function removeStaffQr(employeeId) {
    tg.showConfirm("Удалить QR-код сотрудника?", (confirmed) => {
        if (!confirmed)
            return;
        void api("/staff/qr/remove", { method: "POST", body: JSON.stringify({ employee_id: employeeId }) }).then((result) => {
            if (!result.ok)
                return void tg.showAlert("Не удалось удалить QR-код.");
            void loadTeamEdit(employeeId);
        }).catch(() => tg.showAlert("Не удалось удалить QR-код. Проверьте связь."));
    });
}
function handleAction(action) {
    if (action.indexOf("tab:") === 0)
        return setTab(action.slice(4));
    if (action === "analytics-back")
        return setTab("more");
    if (handleBranchesAction(action))
        return;
    if (handleAnalyticsAction(action) || handleLearningAction(action))
        return;
    if (action.indexOf("learn-report:") === 0)
        return openLearningReport(action.slice(13));
    if (action.indexOf("salary-view:") === 0) {
        const v = action.slice(12);
        if (v === "p1" || v === "p2" || v === "full") {
            salaryView = v;
            haptic("light");
            void loadTab("salary");
        }
        return;
    }
    if (action.indexOf("salary-month:") === 0) {
        const dir = Number(action.slice(13));
        if (dir !== -1 && dir !== 1)
            return;
        const parts = salaryMonth.split("-");
        const next = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1 + dir, 1)).toISOString().slice(0, 7);
        if (next > uzbekistanToday().slice(0, 7))
            return;
        salaryMonth = next;
        salaryView = next === uzbekistanToday().slice(0, 7) ? (Number(uzbekistanToday().slice(8, 10)) <= 15 ? "p1" : "p2") : "full";
        haptic("light");
        void loadTab("salary");
        return;
    }
    if (action === "month:prev")
        return shiftMonth(-1);
    if (action === "month:next")
        return shiftMonth(1);
    if (action === "retry")
        return void (staffMode ? (staffScreen === "team" ? loadTeam() : staffScreen === "edit" && selectedStaffId ? loadTeamEdit(selectedStaffId) : loadStaff()) : teamScheduleMode ? openTeamSchedule() : announcementsMode ? loadAnnouncements() : checklistsMode ? loadChecklists() : trainingsMode ? loadTrainings() : branchesMode ? loadBranches() : loadTab(activeTab));
    if (action === "staff")
        return openStaff();
    if (action === "team")
        return openTeam();
    if (action === "team-back")
        return closeOverlay();
    if (action.indexOf("team-edit:") === 0)
        return void loadTeamEdit(Number(action.slice(10)));
    if (action.indexOf("staff-remove:") === 0)
        return void removeStaff(Number(action.slice(13)));
    if (action === "team-schedule")
        return openTeamSchedule();
    if (action === "announcements")
        return openAnnouncements();
    if (action === "announcements-back")
        return closeOverlay();
    if (action === "checklists") {
        checklistTab = isMgr(profile) ? "report" : "mine";
        checklistDate = "";
        return openChecklists();
    }
    if (action === "checklists-back")
        return closeOverlay();
    if (action === "trainings") {
        trainingTab = "list";
        return openTrainings();
    }
    if (action === "trainings-back")
        return closeOverlay();
    if (action.indexOf("training-open:") === 0) {
        const id = Number(action.slice(14));
        const training = trainingsData && trainingsData.trainings.find((item) => item.id === id);
        if (training && training.url) {
            try {
                tg.openLink(training.url);
            }
            catch (e) {
                window.open(training.url, "_blank", "noopener");
            }
        }
        return;
    }
    if (action.indexOf("checklist-toggle:") === 0) {
        const [, checklistId, itemIndex] = action.split(":");
        if (Number.isInteger(Number(checklistId)) && Number.isInteger(Number(itemIndex)))
            void toggleChecklist(Number(checklistId), Number(itemIndex));
        return;
    }
    if (action.indexOf("team-range:") === 0) {
        const direction = Number(action.slice(11));
        if (direction !== -1 && direction !== 1)
            return;
        moveTeamSchedulePeriod(direction);
        selectedTeamCell = null;
        return void loadTeamSchedule();
    }
    if (action === "team-export")
        return exportTeamSchedule();
    if (action.indexOf("team-cell:") === 0) {
        const [, employeeId, date] = action.split(":");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isInteger(Number(employeeId)))
            return;
        selectedTeamCell = { employeeId: Number(employeeId), date };
        return void loadTeamSchedule();
    }
    if (action === "theme")
        return chooseTheme();
    if (action === "toggle-notifications")
        return void toggleNotifications();
    if (action === "toggle-staff-password" || action === "toggle-edit-password") {
        const input = document.getElementById(action === "toggle-staff-password" ? "staff-password" : "team-edit-password");
        const button = root().querySelector('[data-action="' + action + '"]');
        if (input) {
            input.type = input.type === "password" ? "text" : "password";
            if (button)
                button.textContent = input.type === "password" ? "Показать" : "Скрыть";
        }
        return;
    }
    if (action.indexOf("staff-qr-remove:") === 0)
        return void removeStaffQr(Number(action.slice(15)));
    if (action === "attendance:check-in")
        return void submitAttendance("check-in");
    if (action === "attendance:check-out")
        return void submitAttendance("check-out");
    if (action === "notifications") {
        void api("/notifications/read", { method: "POST", body: "{}" }).then(() => loadTab("home"));
        return;
    }
    if (action === "logout") {
        tg.showConfirm("Выйти из аккаунта на этом устройстве? Для нового входа понадобятся номер телефона и пароль.", (ok) => {
            if (!ok)
                return;
            void api("/auth/logout", { method: "POST", body: "{}" }).then((result) => {
                if (!result.ok)
                    return void tg.showAlert("Не удалось выйти из аккаунта. Проверьте связь.");
                setWebToken("");
                profile = null;
                loginMode = true;
                const tabbar = document.getElementById("tabbar");
                if (tabbar)
                    tabbar.hidden = true;
                root().innerHTML = noAccess();
                haptic("success");
            }).catch(() => tg.showAlert("Не удалось выйти из аккаунта. Проверьте связь."));
        });
        return;
    }
    if (action === "soon")
        tg.showAlert("Этот раздел скоро появится.");
}
function syncFullscreenLayout() {
    try {
        const fullscreen = tg.isVersionAtLeast("8.0") && tg.isFullscreen;
        document.body.classList.toggle("is-fullscreen", fullscreen);
        const safeArea = fullscreen && tg.safeAreaInset ? tg.safeAreaInset : { top: 0, bottom: 0 };
        const contentArea = fullscreen && tg.contentSafeAreaInset ? tg.contentSafeAreaInset : { top: 0 };
        const topInset = Math.max(safeArea.top || 0, contentArea.top || 0);
        const fallbackTop = fullscreen ? 104 : 0;
        document.documentElement.style.setProperty("--fullscreen-safe-top", `${Math.max(fallbackTop, topInset)}px`);
        document.documentElement.style.setProperty("--fullscreen-safe-bottom", `${Math.max(0, safeArea.bottom || 0)}px`);
    }
    catch (e) {
        document.body.classList.remove("is-fullscreen");
    }
}
function syncFullscreenLayoutLater() {
    syncFullscreenLayout();
    window.setTimeout(syncFullscreenLayout, 100);
    window.setTimeout(syncFullscreenLayout, 400);
}
function boot() {
    try {
        let queued = false;
        new MutationObserver(() => {
            if (queued)
                return;
            queued = true;
            window.requestAnimationFrame(() => { queued = false; afterRender(); });
        }).observe(root(), { childList: true });
    }
    catch (e) { /* ignore */ }
    tg.ready();
    tg.expand();
    applyTheme("auto");
    try {
        tg.setHeaderColor("secondary_bg_color");
        if (tg.isVersionAtLeast("7.7"))
            tg.disableVerticalSwipes();
        tg.BackButton.onClick(() => closeOverlay());
        tg.MainButton.onClick(() => {
            if (staffMode)
                void submitStaff();
            if (teamScheduleMode)
                void submitTeamCell();
        });
        if (tg.isVersionAtLeast("8.0")) {
            tg.onEvent("fullscreenChanged", syncFullscreenLayoutLater);
            tg.onEvent("safeAreaChanged", syncFullscreenLayoutLater);
            tg.onEvent("contentSafeAreaChanged", syncFullscreenLayoutLater);
            window.addEventListener("resize", syncFullscreenLayoutLater);
            syncFullscreenLayoutLater();
            if (!tg.isFullscreen)
                tg.requestFullscreen();
        }
    }
    catch (e) {
        /* older clients */
    }
    tg.onEvent("themeChanged", () => {
        if (profile?.theme === "auto")
            applyTheme("auto");
    });
    // Forms in the app are handled in JavaScript; never allow the browser to reload it.
    document.addEventListener("submit", (ev) => ev.preventDefault(), true);
    buildTabBar();
    root().addEventListener("input", (ev) => {
        const input = ev.target;
        if (!input.matches("[data-phone-prefix]"))
            return;
        const digits = input.value.replace(/\D/g, "");
        input.value = digits.startsWith("998") ? `+${digits}` : `+998${digits}`;
    });
    root().addEventListener("click", (ev) => {
        const el = ev.target.closest("[data-action]");
        if (el && el.dataset.action) {
            ev.preventDefault();
            haptic("light");
            handleAction(el.dataset.action);
        }
    });
    root().addEventListener("submit", (ev) => {
        const form = ev.target;
        if (form.id === "staff-form" || form.id === "team-edit-form" || form.id === "team-cell-form" || form.id === "announcement-form" || form.id === "checklist-form" || form.id === "training-form" || form.id === "branch-form" || form.id === "login-form") {
            if (form.id === "staff-form")
                void submitStaff();
            else if (form.id === "team-edit-form")
                void submitTeamEdit();
            else if (form.id === "team-cell-form")
                void submitTeamCell();
            else if (form.id === "announcement-form")
                void submitAnnouncement();
            else if (form.id === "checklist-form")
                void submitChecklist();
            else if (form.id === "training-form")
                void submitTraining();
            else if (form.id === "branch-form")
                void submitBranch();
            else
                void submitLogin();
        }
    });
    void loadTab("home");
}
boot();
