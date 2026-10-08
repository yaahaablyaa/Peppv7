"use strict";
/** Методички: файлы для команды (меню, стандарты, инструкции). Загрузка, выбор аудитории, открытие по защищённой ссылке. */
let libraryData = null;
let libScreen = "list";
let libCategory = "all";
let libQuery = "";
let libListenersReady = false;
let libBusy = false;
let libEditId = 0;
const LIB_LABELS = { pdf: "PDF", png: "IMG", jpg: "IMG", jpeg: "IMG", webp: "IMG", docx: "DOC", xlsx: "XLS", pptx: "PPT", txt: "TXT", csv: "CSV" };
function fmtSize(bytes) {
    if (bytes >= 1048576)
        return (bytes / 1048576).toFixed(1).replace(".", ",") + " МБ";
    return Math.max(1, Math.round(bytes / 1024)) + " КБ";
}
function libList() {
    const d = libraryData;
    const q = libQuery.trim().toLowerCase();
    const files = d.files.filter((f) => (libCategory === "all" || f.category === libCategory) && (!q || f.title.toLowerCase().indexOf(q) >= 0 || f.filename.toLowerCase().indexOf(q) >= 0));
    if (!d.files.length)
        return '<div class="section"><div class="empty">Файлов пока нет.' + (d.can_manage ? " Нажмите «Загрузить файл», чтобы добавить первую методичку." : "") + "</div></div>";
    if (!files.length)
        return '<div class="section"><div class="empty">Ничего не найдено</div></div>';
    return '<div class="section section--stagger">' + files.map((f, i) => `<div class="lib-row" style="--i:${Math.min(i, 10)}"><button type="button" class="lib-open" data-action="lib-open:${f.id}"><span class="lib-ico lib-ico--${esc(f.ext)}">${esc(LIB_LABELS[f.ext] || "FILE")}</span>` +
        `<span class="lib-main"><span class="lib-title">${esc(f.title)}</span><span class="lib-meta">${esc(f.category)} · ${fmtSize(f.size)} · ${esc(humanDate(f.created_at.slice(0, 10)))}${f.can_edit || d.can_manage ? audienceTag(f.audience) : ""}</span></span></button>` +
        (f.can_edit ? `<button type="button" class="icon-btn" data-action="lib-edit:${f.id}" aria-label="Редактировать файл"><svg viewBox="0 0 24 24"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 8.5 3 3"/></svg></button><button type="button" class="icon-btn icon-btn--danger" data-action="lib-delete:${f.id}" aria-label="Удалить файл"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></svg></button>` : "") +
        "</div>").join("") + "</div>";
}
function audienceBlock(key, positions, lock) {
    audienceList[key] = positions;
    audienceLocked[key] = lock;
    if (!audienceState[key])
        audienceState[key] = [];
    if (lock && !audienceState[key].length)
        audienceState[key] = positions.slice();
    const sel = audienceState[key];
    return `<div class="aud-block" data-aud-box="${key}"><div class="section-title">Для кого</div><div class="section aud-card"><div class="chips">` +
        (lock ? "" : `<button type="button" class="chip${sel.length ? "" : " chip--on"}" data-action="aud:${key}:all">Все</button>`) +
        positions.map((p, i) => `<button type="button" class="chip${sel.indexOf(p) >= 0 ? " chip--on" : ""}" data-action="aud:${key}:${i}">${esc(p)}</button>`).join("") +
        `</div><div class="aud-hint" data-aud-hint="${key}">${esc(audienceHint(sel))}</div></div></div>`;
}
function libraryUploadScreen(d) {
    const f = libEditId ? d.files.find((x) => x.id === libEditId) : undefined;
    const cat = f ? f.category : libCategory !== "all" ? libCategory : "Меню";
    return `<div class="screen"><button class="back-link" data-action="library-back">‹ Назад</button><div class="screen-title">${f ? "Редактирование файла" : "Новый файл"}</div>` +
        `<div class="screen-sub">${f ? "Измените название, раздел и аудиторию или замените файл." : `PDF, фото, Word, Excel, PowerPoint или текст, до ${d.max_mb} МБ.`}</div>` +
        '<form class="form-stack" id="lib-form"><div class="section staff-form staff-form--card">' +
        (f ? `<div class="field field--hint lib-current">Сейчас: ${esc(f.filename)} · ${fmtSize(f.size)}</div>` : "") +
        `<label class="field"><span class="field-label">${f ? "Заменить файл (необязательно)" : "Файл"}</span><input id="lib-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.csv"${f ? "" : " required"}></label>` +
        `<label class="field"><span class="field-label">Название</span><input name="title" maxlength="120" placeholder="Например, Меню зала, осень" value="${f ? esc(f.title) : ""}" required></label>` +
        `<label class="field"><span class="field-label">Раздел</span><select name="category">${d.categories.map((c) => `<option value="${esc(c)}"${c === cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>` +
        audienceBlock("lib", d.positions, !!d.restricted) +
        `<button class="button staff-submit" type="submit">${f ? "Сохранить" : "Загрузить"}</button>` +
        (f ? '<button type="button" class="button button--secondary staff-cancel" data-action="lib-edit-cancel">Отмена</button>' : "") + '</form>' +
        `<div class="section-footer">${d.restricted ? "Файл увидят выбранные должности вашего отдела." : "Файл увидят только выбранные должности (менеджеры видят всё)."} Сотрудникам придёт уведомление о новом файле.</div></div>`;
}
/** The "Методички" tab inside "Обучение и Методички". */
function libraryBody(d) {
    if (!d)
        return '<div class="skeleton skeleton--block"></div><div class="skeleton skeleton--block"></div>';
    let html = '<div class="chips chips--scroll"><button type="button" class="chip' + (libCategory === "all" ? " chip--on" : "") + '" data-action="lib-cat:all">Все</button>' +
        d.categories.map((c, i) => `<button type="button" class="chip${libCategory === c ? " chip--on" : ""}" data-action="lib-cat:${i}">${esc(c)}</button>`).join("") + "</div>";
    html += `<div class="searchbox">${icon("search")}<input id="lib-search" type="search" placeholder="Найти файл" value="${esc(libQuery)}" autocomplete="off"></div>`;
    if (d.can_manage)
        html += '<button type="button" class="button inv-add" data-action="lib-new">+ Загрузить файл</button>';
    html += '<div id="lib-list">' + libList() + "</div>";
    return html;
}
function libRepaint() {
    if (trainingsMode && trainingsData)
        rerender(renderTrainings(trainingsData));
}
async function loadLibrary(skeletonFirst) {
    void skeletonFirst;
    try {
        const d = await api("/library");
        if (d.error)
            return;
        libraryData = d;
        libRepaint();
    }
    catch (e) {
        tg.showAlert("Не удалось загрузить методички. Проверьте связь.");
    }
}
function libBack() {
    if (!trainingsMode || trainingTab !== "library" || libScreen === "list")
        return false;
    libScreen = "list";
    libEditId = 0;
    libRepaint();
    return true;
}
function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read_failed"));
        r.readAsDataURL(file);
    });
}
/** In-app viewer: works in a browser, in a home-screen web app and falls back to Telegram's link opener. */
function showViewer(title, url, ext) {
    const old = document.querySelector(".viewer");
    if (old)
        old.remove();
    const box = document.createElement("div");
    box.className = "viewer";
    const isImg = ["png", "jpg", "jpeg", "webp"].indexOf(ext) >= 0;
    const isPdf = ext === "pdf";
    box.innerHTML = `<div class="viewer-bar"><button type="button" class="viewer-close" aria-label="Закрыть">‹ Закрыть</button><span class="viewer-title">${esc(title)}</span>` +
        `<a class="viewer-btn" href="${esc(url)}" target="_blank" rel="noopener">Открыть</a><a class="viewer-btn viewer-btn--main" href="${esc(url)}" download>Скачать</a></div>` +
        `<div class="viewer-body">${isImg ? `<img src="${esc(url)}" alt="${esc(title)}">` : isPdf ? `<iframe src="${esc(url)}" title="${esc(title)}"></iframe>` : `<div class="viewer-note"><b>${esc(title)}</b><span>Этот тип файла открывается в другом приложении. Нажмите «Скачать».</span></div>`}</div>`;
    document.body.appendChild(box);
    const close = () => { box.classList.add("viewer--out"); window.setTimeout(() => box.remove(), 200); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape")
        close(); };
    document.addEventListener("keydown", onKey);
    const btn = box.querySelector(".viewer-close");
    if (btn)
        btn.onclick = close;
}
async function openLibFile(id) {
    if (libBusy)
        return;
    libBusy = true;
    try {
        const r = await api("/library/link?id=" + id);
        if (!r.url)
            throw new Error("no_link");
        const abs = window.location.origin + r.url;
        const f = libraryData ? libraryData.files.find((x) => x.id === id) : undefined;
        if (tg.initData)
            tg.openLink(abs);
        else
            showViewer(f ? f.title : "Файл", r.url, f ? f.ext : "");
    }
    catch (e) {
        tg.showAlert("Не удалось открыть файл. Проверьте связь.");
    }
    finally {
        libBusy = false;
    }
}
async function submitLibrary() {
    const form = root().querySelector("#lib-form");
    if (!form || !trainingsMode || !libraryData)
        return;
    const input = form.querySelector("#lib-file");
    const file = input && input.files && input.files[0];
    const v = new FormData(form);
    const title = String(v.get("title") || "").trim();
    if (!file && !libEditId)
        return void tg.showAlert("Выберите файл.");
    if (title.length < 2)
        return void tg.showAlert("Укажите название.");
    if (file && file.size > libraryData.max_mb * 1048576)
        return void tg.showAlert(`Файл слишком большой. Максимум ${libraryData.max_mb} МБ.`);
    const button = form.querySelector(".staff-submit");
    const label = libEditId ? "Сохранить" : "Загрузить";
    if (button) {
        button.disabled = true;
        button.textContent = "Сохраняем…";
    }
    try {
        const payload = { title, category: String(v.get("category") || "Другое"), positions: audienceState.lib || [] };
        if (file) {
            payload.filename = file.name;
            payload.data = await readFileAsDataUrl(file);
        }
        if (libEditId)
            payload.id = libEditId;
        const r = await api(libEditId ? "/library/update" : "/library/upload", { method: "POST", body: JSON.stringify(payload) });
        if (!r.ok) {
            tg.showAlert(r.reason === "too_big" ? "Файл слишком большой." : "Этот тип файла не поддерживается или файл повреждён.");
            haptic("error");
            return;
        }
        haptic("success");
        audienceState.lib = [];
        libEditId = 0;
        libScreen = "list";
        void loadLibrary(false);
    }
    catch (e) {
        tg.showAlert("Не удалось сохранить файл. Проверьте связь.");
    }
    finally {
        if (button) {
            button.disabled = false;
            button.textContent = label;
        }
    }
}
function ensureLibListeners() {
    if (libListenersReady)
        return;
    libListenersReady = true;
    root().addEventListener("input", (ev) => {
        const t = ev.target;
        if (!trainingsMode || trainingTab !== "library" || t.id !== "lib-search" || !libraryData)
            return;
        libQuery = t.value;
        const list = root().querySelector("#lib-list");
        if (list)
            list.innerHTML = libList();
    });
    root().addEventListener("change", (ev) => {
        const t = ev.target;
        if (!trainingsMode || t.id !== "lib-file" || !t.files || !t.files[0])
            return;
        const title = root().querySelector('#lib-form input[name="title"]');
        if (title && !title.value)
            title.value = t.files[0].name.replace(/\.[^.]+$/, "");
    });
}
function handleLibraryAction(action) {
    if (action === "library") {
        trainingTab = "library";
        libScreen = "list";
        openTrainings();
        return true;
    }
    if (action.indexOf("lib") !== 0)
        return false;
    if (action === "library-back") {
        if (!libBack())
            closeOverlay();
        return true;
    }
    if (!trainingsMode || !libraryData)
        return false;
    if (action.indexOf("lib-cat:") === 0) {
        const k = action.slice(8);
        libCategory = k === "all" ? "all" : libraryData.categories[Number(k)] || "all";
        libRepaint();
        return true;
    }
    if (action === "lib-new") {
        libEditId = 0;
        audienceState.lib = [];
        libScreen = "upload";
        libRepaint();
        root().scrollTop = 0;
        return true;
    }
    if (action.indexOf("lib-edit:") === 0) {
        const f = libraryData.files.find((x) => x.id === Number(action.slice(9)));
        if (f) {
            libEditId = f.id;
            audienceState.lib = f.audience.slice();
            libScreen = "upload";
            haptic("light");
            libRepaint();
            root().scrollTop = 0;
        }
        return true;
    }
    if (action === "lib-edit-cancel") {
        libEditId = 0;
        audienceState.lib = [];
        libScreen = "list";
        libRepaint();
        return true;
    }
    if (action.indexOf("lib-open:") === 0) {
        void openLibFile(Number(action.slice(9)));
        return true;
    }
    if (action.indexOf("lib-delete:") === 0) {
        const id = Number(action.slice(11));
        tg.showConfirm("Удалить файл? Он пропадёт у всех сотрудников.", (ok) => {
            if (!ok)
                return;
            void api("/library/delete", { method: "POST", body: JSON.stringify({ id }) }).then((r) => {
                if (!r.ok)
                    return void tg.showAlert("Не удалось удалить файл.");
                haptic("success");
                void loadLibrary(false);
            }).catch(() => tg.showAlert("Не удалось удалить. Проверьте связь."));
        });
        return true;
    }
    return false;
}
