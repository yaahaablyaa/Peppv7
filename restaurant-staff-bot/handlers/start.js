/**
 * Entry point: /start, /login (phone + password), /help.
 */

const employees = require("../lib/employees");

module.exports = function registerStart(bot, sdk) {
  const { db, log } = sdk;

  bot.command("start", async (ctx) => {
    const emp = employees.byTelegramId(db, ctx.from.id);

    if (!emp) {
      return ctx.reply(
        `👋 <b>Добро пожаловать!</b>\n\n` +
          `Это рабочее приложение для официантов и менеджеров.\n\n` +
          `Ваш Telegram пока не привязан к сотруднику.\n` +
          `Войдите командой:\n<code>/login телефон пароль</code>\n\n` +
          `Например: <code>/login +998901234567 1234</code>`,
        { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
      );
    }

    const isMgr = employees.isManager(emp);
    await ctx.reply(
      `👋 <b>${sdk.escapeHtml(emp.full_name)}</b>\n` +
        `${isMgr ? "Панель менеджера" : "Staff Hub"}\n\n` +
        `Приложение доступно через кнопку «Приложение» в меню чата.`,
      { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
    );
  });

  bot.command("login", async (ctx) => {
    const parts = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      return ctx.reply(
        "Формат: <code>/login телефон пароль</code>",
        { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
      );
    }
    const [phone, password] = parts;
    const res = employees.login(sdk, db, ctx.from.id, ctx.from.username, phone, password);

    try {
      await ctx.deleteMessage();
    } catch (e) {
      log.debug("could not delete /login message");
    }

    if (!res.ok) {
      const text =
        res.reason === "not_found"
          ? "Сотрудник с таким номером не найден."
          : res.reason === "inactive"
          ? "Учётная запись отключена. Обратитесь к менеджеру."
          : "Неверный пароль.";
      return ctx.reply(`❌ ${text}`);
    }

    log.info(`login ok: employee ${res.employee.id}`);
    return ctx.reply(
      `✅ <b>Вход выполнен</b>\nЗдравствуйте, ${sdk.escapeHtml(res.employee.full_name)}!\n\n` +
        `Откройте рабочее приложение через кнопку «Приложение» в меню чата.`,
      { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
    );
  });

  bot.command("help", (ctx) =>
    ctx.reply(
      `📖 <b>Команды</b>\n\n` +
        `/start — открыть приложение\n` +
        `/login телефон пароль — вход\n` +
        `/staff — сотрудники и должности (для менеджера)\n` +
        `/schedule — график смен (для менеджера)\n` +
        `/help — эта справка`,
      { parse_mode: "HTML", reply_markup: { remove_keyboard: true } }
    )
  );
};
