/**
 * Manager-only shift planning: /schedule — pick an employee, walk the week,
 * set a shift time, a day off, or clear the day. Employees get notified.
 */

const employees = require("../lib/employees");
const staff = require("../lib/staff");
const shifts = require("../lib/shifts");

/** Managers waiting to type a custom time, keyed by Telegram id. */
const pending = new Map();

module.exports = function registerShifts(bot, sdk) {
  const { db, log } = sdk;

  const manager = (ctx) => {
    const emp = employees.byTelegramId(db, ctx.from.id);
    return employees.isManager(emp) ? emp : null;
  };

  function assignedEmployee(managerAccount, id) {
    return staff.byId(db, id, managerAccount.branch_id);
  }

  /* ------------------------------------------------------- экран: сотрудники */

  function peopleView(managerAccount) {
    const rows = staff.list(db, managerAccount.branch_id);
    const keyboard = rows.map((r) => [
      { text: r.full_name, callback_data: `sh_e_${r.id}_0` },
    ]);
    return {
      text: rows.length
        ? "🗓 <b>График смен</b>\n\nВыберите сотрудника, чтобы составить его неделю."
        : "🗓 <b>График смен</b>\n\nСначала добавьте сотрудников: /staff",
      keyboard: { inline_keyboard: keyboard },
    };
  }

  /* ------------------------------------------------------------ экран: неделя */

  function weekView(emp, offset) {
    const dates = shifts.weekDates(sdk, offset);
    const planned = shifts.forEmployee(db, emp.id, dates);
    const today = shifts.isoToday(sdk);

    const lines = dates.map((d) => {
      const mark = d === today ? "▸ " : "";
      return `${mark}<b>${sdk.escapeHtml(shifts.labelDate(sdk, d))}</b> — ${shifts.describe(planned[d])}`;
    });

    const dayButtons = sdk.chunk(
      dates.map((d) => ({
        text: `${shifts.labelDate(sdk, d)}${planned[d] ? (planned[d].is_day_off ? " 🌙" : " ✅") : ""}`,
        callback_data: `sh_d_${emp.id}_${shifts.packDate(d)}`,
      })),
      2
    );

    return {
      text:
        `🗓 <b>${sdk.escapeHtml(emp.full_name)}</b>\n` +
        `${sdk.escapeHtml(shifts.labelDate(sdk, dates[0]))} — ${sdk.escapeHtml(shifts.labelDate(sdk, dates[6]))}\n\n` +
        lines.join("\n"),
      keyboard: {
        inline_keyboard: [
          ...dayButtons,
          [
            { text: "◀️ Неделя", callback_data: `sh_e_${emp.id}_${offset - 1}` },
            { text: "Неделя ▶️", callback_data: `sh_e_${emp.id}_${offset + 1}` },
          ],
          [{ text: "👥 Другой сотрудник", callback_data: "shifts_menu" }],
        ],
      },
    };
  }

  /* --------------------------------------------------------------- экран: день */

  function dayView(emp, date) {
    const row = shifts.forEmployee(db, emp.id, [date])[date];
    const presets = shifts.PRESETS.map((p) => [
      {
        text: `${p.start} — ${p.end}`,
        callback_data: `sh_s_${emp.id}_${shifts.packDate(date)}_${p.key}`,
      },
    ]);
    return {
      text:
        `📅 <b>${sdk.escapeHtml(shifts.labelDate(sdk, date))}</b> · ${sdk.escapeHtml(emp.full_name)}\n` +
        `Сейчас: ${shifts.describe(row)}\n\nВыберите время смены:`,
      keyboard: {
        inline_keyboard: [
          ...presets,
          [
            { text: "✍️ Своё время", callback_data: `sh_s_${emp.id}_${shifts.packDate(date)}_custom` },
            { text: "🌙 Выходной", callback_data: `sh_s_${emp.id}_${shifts.packDate(date)}_off` },
          ],
          [{ text: "🗑 Очистить день", callback_data: `sh_s_${emp.id}_${shifts.packDate(date)}_clear` }],
          [{ text: "◀️ К неделе", callback_data: `sh_e_${emp.id}_0` }],
        ],
      },
    };
  }

  async function show(ctx, view) {
    const opts = { parse_mode: "HTML", reply_markup: view.keyboard };
    if (ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(view.text, opts);
      } catch (e) {
        log.debug("shift view edit skipped: " + e.message);
      }
    }
    return ctx.reply(view.text, opts);
  }

  /** Tells the employee their day changed, in the app and in the bot. */
  async function announce(emp, date, description) {
    const title = "График обновлён";
    const body = `${shifts.labelDate(sdk, date)}: ${description}`;
    employees.notify(db, emp.id, title, body);
    if (!emp.telegram_id || !emp.notifications_on) return;
    try {
      await bot.api.sendMessage(
        emp.telegram_id,
        `🗓 <b>График обновлён</b>\n${sdk.escapeHtml(body)}`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      log.warn(`shift notify failed for employee ${emp.id}: ${e.message}`);
    }
  }

  /* ------------------------------------------------------------------ handlers */

  bot.command("schedule", async (ctx) => {
    const account = manager(ctx);
    if (!account) return ctx.reply("Эта команда доступна только менеджеру.");
    return show(ctx, peopleView(account));
  });

  bot.callbackQuery("shifts_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    const account = manager(ctx);
    if (!account) return;
    return show(ctx, peopleView(account));
  });

  bot.callbackQuery(/^sh_e_(\d+)_(-?\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const account = manager(ctx);
    if (!account) return;
    const emp = assignedEmployee(account, Number(ctx.match[1]));
    if (!emp) return ctx.reply("Сотрудник не найден.");
    return show(ctx, weekView(emp, Number(ctx.match[2])));
  });

  bot.callbackQuery(/^sh_d_(\d+)_(\d{8})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const account = manager(ctx);
    if (!account) return;
    const emp = assignedEmployee(account, Number(ctx.match[1]));
    if (!emp) return ctx.reply("Сотрудник не найден.");
    return show(ctx, dayView(emp, shifts.unpackDate(ctx.match[2])));
  });

  bot.callbackQuery(/^sh_s_(\d+)_(\d{8})_(\w+)$/, async (ctx) => {
    const account = manager(ctx);
    if (!account) return ctx.answerCallbackQuery();
    const emp = assignedEmployee(account, Number(ctx.match[1]));
    if (!emp) return ctx.answerCallbackQuery("Сотрудник не найден");
    const date = shifts.unpackDate(ctx.match[2]);
    const action = ctx.match[3];

    if (action === "custom") {
      await ctx.answerCallbackQuery();
      pending.set(ctx.from.id, { employeeId: emp.id, date });
      return ctx.reply(
        `Напишите время смены на ${sdk.escapeHtml(shifts.labelDate(sdk, date))}, например: <code>10:00 22:00</code>`,
        { parse_mode: "HTML" }
      );
    }

    let description;
    if (action === "off") {
      shifts.setDayOff(db, emp.id, date);
      description = "выходной";
    } else if (action === "clear") {
      shifts.clearDay(db, emp.id, date);
      description = "смена снята";
    } else {
      const preset = shifts.presetByKey(action);
      if (!preset) return ctx.answerCallbackQuery();
      shifts.setShift(db, emp.id, date, preset.start, preset.end);
      description = `${preset.start}–${preset.end}`;
    }

    await ctx.answerCallbackQuery("Сохранено");
    await announce(emp, date, description);
    return show(ctx, weekView(emp, 0));
  });

  bot.on("message:text", async (ctx, next) => {
    const wait = pending.get(ctx.from.id);
    const text = (ctx.message.text || "").trim();
    if (!wait || !text || text[0] === "/") return next();
    const account = manager(ctx);
    if (!account) {
      pending.delete(ctx.from.id);
      return next();
    }

    const range = shifts.parseTimeRange(text);
    if (!range) return ctx.reply("Не понял время. Напишите так: 10:00 22:00");

    pending.delete(ctx.from.id);
    const emp = assignedEmployee(account, wait.employeeId);
    if (!emp) return ctx.reply("Сотрудник не найден.");

    shifts.setShift(db, emp.id, wait.date, range.start, range.end);
    await announce(emp, wait.date, `${range.start}–${range.end}`);
    return show(ctx, weekView(emp, 0));
  });
};
