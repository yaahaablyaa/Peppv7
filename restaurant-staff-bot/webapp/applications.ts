/** Employee requests and manager review screen. */

interface ApplicationRow {
  id: number;
  kind: string;
  body: string;
  status: string;
  created_at: string;
  employee_name?: string;
}

interface ApplicationsData {
  can_manage: boolean;
  mine: ApplicationRow[];
  team: ApplicationRow[];
  error?: string;
}

const APPLICATION_KINDS: Record<string, string> = {
  leave: "Отгул или выходной",
  schedule: "Изменение графика",
  payroll: "Вопрос по зарплате",
  other: "Другое",
};

const APPLICATION_STATUSES: Record<string, string> = {
  pending: "На рассмотрении",
  approved: "Одобрено",
  rejected: "Отклонено",
};

function applicationKind(kind: string): string {
  return APPLICATION_KINDS[kind] || APPLICATION_KINDS.other;
}

function applicationStatus(status: string): string {
  return APPLICATION_STATUSES[status] || APPLICATION_STATUSES.pending;
}

function applicationRow(item: ApplicationRow, showEmployee: boolean): string {
  const title = showEmployee && item.employee_name
    ? `${esc(item.employee_name)} · ${applicationKind(item.kind)}`
    : applicationKind(item.kind);
  const date = item.created_at ? humanDate(item.created_at.slice(0, 10)) : "";
  return cell({
    icon: "doc",
    title,
    subtitle: esc(item.body),
    value: `${applicationStatus(item.status)}${date ? ` · ${date}` : ""}`,
  });
}

function renderApplications(data: ApplicationsData): string {
  let html = '<div class="screen"><button class="back-link" data-action="applications-back">‹ Назад</button><div class="screen-title">Заявления</div>';

  if (!data.can_manage) {
    html += '<div class="screen-sub">Отправьте запрос менеджеру и следите за его статусом.</div>';
    html += '<form class="section staff-form staff-form--card" id="application-form">';
    html += '<div class="staff-form-heading">Новое заявление</div>';
    html += '<label class="field"><span class="field-label">Тема</span><select name="kind"><option value="leave">Отгул или выходной</option><option value="schedule">Изменение графика</option><option value="payroll">Вопрос по зарплате</option><option value="other">Другое</option></select></label>';
    html += '<label class="field"><span class="field-label">Сообщение</span><textarea name="body" maxlength="2000" placeholder="Опишите ваш запрос" required></textarea></label>';
    html += '<button class="button staff-submit" type="submit">Отправить заявление</button></form>';

    html += '<div class="section-title">Мои заявления</div><div class="section">';
    if (!data.mine.length) html += '<div class="empty">Здесь появятся ваши заявления</div>';
    else data.mine.forEach((item) => { html += applicationRow(item, false); });
    html += '</div>';
  }

  if (data.can_manage) {
    html += '<div class="section-title">Заявления команды</div><div class="section">';
    if (!data.team.length) {
      html += '<div class="empty">Новых заявлений от команды нет</div>';
    } else {
      data.team.forEach((item) => {
        html += applicationRow(item, true);
        if (item.status === "pending") {
          html += `<div class="attendance-actions"><button class="button button--secondary attendance-action" type="button" data-action="application-status:${item.id}:rejected">Отклонить</button><button class="button attendance-action" type="button" data-action="application-status:${item.id}:approved">Одобрить</button></div>`;
        }
      });
    }
    html += '</div>';
  }

  return html + '</div>';
}

function applicationsError(): void {
  root().innerHTML = '<div class="screen"><button class="back-link" data-action="applications-back">‹ Назад</button><div class="screen-title">Заявления</div><div class="section"><div class="empty">Не удалось загрузить заявления. Проверьте связь и попробуйте снова.</div><button class="button" type="button" data-action="applications-retry">Повторить</button></div></div>';
  try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) { /* ignore */ }
}

async function loadApplications(): Promise<void> {
  root().innerHTML = skeleton(3);
  try {
    const data = await api<ApplicationsData>("/applications");
    if (data.error) return void (root().innerHTML = noAccess());
    root().innerHTML = renderApplications(data);
  } catch (error) {
    applicationsError();
  }
}

let applicationsMode = false;

function openApplications(): void {
  applicationsMode = true;
  setOverlayControls(true);
  void loadApplications();
}

async function submitApplication(): Promise<void> {
  const form = root().querySelector<HTMLFormElement>("#application-form");
  if (!form) return;
  const values = new FormData(form);
  const kind = String(values.get("kind") || "other");
  const body = String(values.get("body") || "").trim();
  if (body.length < 3) {
    tg.showAlert("Опишите ваш запрос подробнее.");
    return;
  }
  const button = form.querySelector<HTMLButtonElement>(".staff-submit");
  if (button) { button.disabled = true; button.textContent = "Отправляем…"; }
  try {
    const result = await api<{ ok: boolean }>("/applications", { method: "POST", body: JSON.stringify({ kind, body }) });
    if (!result.ok) throw new Error("not_saved");
    try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) { /* ignore */ }
    void loadApplications();
  } catch (error) {
    tg.showAlert("Не удалось отправить заявление. Проверьте связь.");
    try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) { /* ignore */ }
    if (button) { button.disabled = false; button.textContent = "Отправить заявление"; }
  }
}

async function updateApplicationStatus(id: number, status: "approved" | "rejected"): Promise<void> {
  try {
    const result = await api<{ ok: boolean }>("/applications/status", { method: "POST", body: JSON.stringify({ id, status }) });
    if (!result.ok) throw new Error("not_saved");
    try { tg.HapticFeedback.notificationOccurred("success"); } catch (e) { /* ignore */ }
    void loadApplications();
  } catch (error) {
    tg.showAlert("Не удалось обновить статус заявления. Проверьте связь.");
    try { tg.HapticFeedback.notificationOccurred("error"); } catch (e) { /* ignore */ }
  }
}

document.addEventListener("click", (event) => {
  const element = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  const action = element && element.dataset.action;
  if (!action) return;
  if (action === "applications") return openApplications();
  if (action === "applications-back") return closeOverlay();
  if (action === "applications-retry") return void loadApplications();
  if (action.indexOf("application-status:") === 0) {
    const [, id, status] = action.split(":");
    if (Number.isInteger(Number(id)) && (status === "approved" || status === "rejected")) {
      void updateApplicationStatus(Number(id), status);
    }
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (form.id !== "application-form") return;
  event.preventDefault();
  void submitApplication();
});
