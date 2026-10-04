/**
 * Manager-only staff directory: /staff — list, add an employee, set a position.
 * The add flow is a short step-by-step dialog kept in memory per manager.
 */

const employees = require("../lib/employees");
const staff = require("../lib/staff");

/** In-progress dialogs, keyed by the manager's Telegram id. */
const drafts = new Map();

const POSITION_KEYBOARD = {
  inline_keyboard: [
    [
      { text: "Официант", callback_data: "staff_pos_waiter" },
      { text: "Хостес", callback_data: "staff_pos_hostess" },
    ],
    [
      { text: "Бармен", callback_data: "staff_pos_barman" },
      { text: "Бариста", callback_data: "staff_pos_barista" },
    ],
    [
      { text: "Повар", callback_data: "staff_pos_cook" },
      { text: "Кассир", callback_data: "staff_pos_cashier" },
    ],
    [{ text: "Тех персонал", callback_data: "staff_pos_tech" }],
    [
      { text: "Шеф-повар", callback_data: "staff_pos_chef" },
      { text: "Бар-менеджер", callback_data: "staff_pos_barmanager" },
    ],
    [
      { text: "Финансовый директор", callback_data: "staff_pos_finance" },
      { text: "Менеджер", callback_data: "staff_pos_manager" },
    ],
    [{ text: "✍️ Своя должность", callback_data: "staff_pos_custom" }],
    [{ text: "✖️ Отмена", callback_data: "staff_cancel" }],
  ],
};

module.exports = function registerStaff(bot, sdk) {
  const { db, log } = sdk;

  const manager = (ctx) => {
    const emp = employees.byTelegramId(db, ctx.from.id);
    return employees.isManager(emp) ? emp : null;
  };

  function listText() {
    const rows = staff.list(db);
    if (!rows.length) return "👥 <b>Сотрудники</b>\n\nПока никого нет.";
    const lines = rows.map((r) => {
      const pos = r.position || (r.role === "manager" ? "Менеджер" : "Официант");
      const linked = r.telegram_id ? "✅" : "⏳";
      return (
        `${linked} <b>${sdk.escapeHtml(r.full_name)}</b> — ${sdk.escapeHtml(pos)}\n` +
        `<code>${sdk.escapeHtml(r.phone || "")}</code> · ${r.hourly_rate.toLocaleString("ru-RU")} сум/час`
      );
    });
    return (
      `👥 <b>Сотрудники</b> (${rows.length})\n\n` +
      lines.join("\n\n") +
      `\n\n✅ — вошёл в приложение, ⏳ — ещё не входил`
    );
  }

  function listKeyboard() {
    const rows = staff.list(db).map((r) => [
      { text: `✏️ ${r.full_name}`, callback_data: `staff_emp_${r.id}` },
    ]);
    rows.unshift([{ text: "➕ Добавить сотрудника", callback_data: "staff_add" }]);
    return { inline_keyboard: rows };
  }

  async function showList(ctx) {
    return ctx.reply(listText(), {
      parse_mode: "HTML",
      reply_markup: listKeyboard(),
    });
  }

  bot.command("staff", async (ctx) => {
    if (!manager(ctx)) return ctx.reply("Эта команда доступна только менеджеру.");
    return showList(ctx);
  });

  bot.callbackQuery("staff_add", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!manager(ctx)) return;
    drafts.set(ctx.from.id, { mode: "create", step: "name" });
    return ctx.reply(
      "➕ <b>Новый сотрудник</b>\n\nШаг 1 из 4. Напишите фамилию и имя.",
      {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✖️ Отмена", callback_data: "staff_cancel" }]] },
      }
    );
  });

  bot.callbackQuery("staff_cancel", async (ctx) => {
    drafts.delete(ctx.from.id);
    await ctx.answerCallbackQuery("Отменено");
    return ctx.reply("Добавление отменено.");
  });

  bot.callbackQuery(/^staff_emp_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!manager(ctx)) return;
    const emp = staff.byId(db, Number(ctx.match[1]));
    if (!emp) return ctx.reply("Сотрудник не найден.");
    drafts.set(ctx.from.id, { mode: "edit", id: emp.id, full_name: emp.full_name });
    return ctx.reply(
      `✏️ <b>${sdk.escapeHtml(emp.full_name)}</b>\nТекущая должность: ${sdk.escapeHtml(emp.position || "—")}\n\nВыберите новую должность:`,
      { parse_mode: "HTML", reply_markup: POSITION_KEYBOARD }
    );
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data || "";
    if (data.indexOf("staff_pos_") !== 0) return next();

    await ctx.answerCallbackQuery();
    if (!manager(ctx)) return;
    const draft = drafts.get(ctx.from.id);
    if (!draft) return ctx.reply("Начните заново: /staff");

    const key = data.slice("staff_pos_".length);
    if (key === "custom") {
      draft.step = "position";
      return ctx.reply("Напишите должность одним словом или фразой.");
    }

    const preset = staff.positionByKey(key);
    if (!preset) return;
    return applyPosition(ctx, draft, preset.title, preset.role);
  });

  async function applyPosition(ctx, draft, title, role) {
    if (draft.mode === "edit") {
      staff.setPosition(db, draft.id, title, role);
      employees.notify(
        db,
        draft.id,
        "Должность обновлена",
        `Ваша должность теперь: ${title}`
      );
      drafts.delete(ctx.from.id);
      return ctx.reply(
        `✅ Должность обновлена: <b>${sdk.escapeHtml(draft.full_name)}</b> — ${sdk.escapeHtml(title)}`,
        { parse_mode: "HTML" }
      );
    }

    draft.position = title;
    draft.role = role;
    draft.step = "rate";
    return ctx.reply(
      `Шаг 4 из 5. Ставка в час, в сумах.\nПо умолчанию ${staff.DEFAULT_RATE.toLocaleString("ru-RU")} сум.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Оставить 20 000 сум", callback_data: "staff_rate_default" }],
            [{ text: "✖️ Отмена", callback_data: "staff_cancel" }],
          ],
        },
      }
    );
  }

  function requestQr(ctx, draft, rate) {
    draft.rate = rate;
    draft.step = "qr";
    return ctx.reply(
      "Шаг 5 из 5. Отправьте QR-код сотрудника фотографией. Он появится у сотрудника во вкладке «Приход», чтобы его можно было отсканировать с другого устройства.",
      { reply_markup: { inline_keyboard: [[{ text: "✖️ Отмена", callback_data: "staff_cancel" }]] } }
    );
  }

  bot.callbackQuery("staff_rate_default", async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = drafts.get(ctx.from.id);
    if (!draft || !manager(ctx)) return;
    return requestQr(ctx, draft, staff.DEFAULT_RATE);
  });

  async function finish(ctx, draft, qrFileId) {
    const res = staff.create(sdk, db, draft);
    drafts.delete(ctx.from.id);

    if (!res.ok) {
      const text =
        res.reason === "duplicate"
          ? `Сотрудник с номером ${sdk.escapeHtml(draft.phone)} уже есть: ${sdk.escapeHtml(res.employee.full_name)}.`
          : "Номер телефона выглядит неверно. Начните заново: /staff";
      return ctx.reply(`❌ ${text}`, { parse_mode: "HTML" });
    }

    staff.saveQrCode(db, res.employee.id, qrFileId);
    log.info(`staff created: employee ${res.employee.id}`);
    return ctx.reply(
      `✅ <b>Сотрудник добавлен</b>\n\n` +
        `${sdk.escapeHtml(res.employee.full_name)} — ${sdk.escapeHtml(res.employee.position)}\n` +
        `Ставка: ${res.employee.hourly_rate.toLocaleString("ru-RU")} сум/час\n` +
        `QR-код сохранён во вкладке «Приход».\n\n` +
        `Передайте сотруднику данные для входа в бот:\n` +
        `<code>/login ${sdk.escapeHtml(res.employee.phone)} ${res.password}</code>\n\n` +
        `Пароль показывается один раз — сохраните его.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "👥 Список сотрудников", callback_data: "staff_list" }]],
        },
      }
    );
  }

  bot.on("message:photo", async (ctx, next) => {
    const draft = drafts.get(ctx.from.id);
    if (!draft || draft.step !== "qr") return next();
    if (!manager(ctx)) {
      drafts.delete(ctx.from.id);
      return next();
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    return finish(ctx, draft, photo.file_id);
  });

  bot.callbackQuery("staff_list", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!manager(ctx)) return;
    return showList(ctx);
  });

  bot.on("message:text", async (ctx, next) => {
    const draft = drafts.get(ctx.from.id);
    const text = (ctx.message.text || "").trim();
    if (!draft || !text || text[0] === "/") return next();
    if (!manager(ctx)) {
      drafts.delete(ctx.from.id);
      return next();
    }

    if (draft.step === "name") {
      draft.full_name = text;
      draft.step = "phone";
      return ctx.reply("Шаг 2 из 4. Номер телефона в формате +998901234567.");
    }

    if (draft.step === "phone") {
      const phone = employees.normalizePhone(text);
      if (phone.length < 9) return ctx.reply("Не похоже на номер. Напишите, например: +998901234567");
      draft.phone = phone;
      draft.step = "positionPick";
      return ctx.reply("Шаг 3 из 4. Выберите должность:", { reply_markup: POSITION_KEYBOARD });
    }

    if (draft.step === "position") {
      const role = staff.roleForPosition(text);
      return applyPosition(ctx, draft, text, role);
    }

    if (draft.step === "rate") {
      const rate = parseInt(text.replace(/\D/g, ""), 10);
      if (!rate) return ctx.reply("Напишите ставку числом, например 20000.");
      return requestQr(ctx, draft, rate);
    }

    if (draft.step === "qr") {
      return ctx.reply("Отправьте QR-код именно фотографией или отмените добавление.");
    }

    return next();
  });
};
