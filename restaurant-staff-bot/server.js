/**
 * Сервер: веб-приложение + Telegram-бот в одном процессе.
 *
 * Переменные окружения: BOT_TOKEN, PUBLIC_URL (или RENDER_EXTERNAL_URL),
 * SESSION_SECRET, DATABASE_PATH, PORT. См. .env.example и README.md.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

try { process.loadEnvFile && fs.existsSync(".env") && process.loadEnvFile(".env"); } catch (e) { /* ignore */ }

const express = require("express");
const dbAdapter = require("./lib/db-adapter");
const employees = require("./lib/employees");
const schema = require("./lib/schema");
const setupBot = require("./bot");
const libraryTypes = require("./lib/library").TYPES;

const WEB_DIR = path.join(__dirname, "webapp");
const SESSION_DAYS = 30;

const log = {
  info: (m) => console.log(`[info] ${m}`),
  warn: (m) => console.warn(`[warn] ${m}`),
  error: (m) => console.error(`[error] ${m}`),
};

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------ авторизация */

function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 7 * 24 * 3600) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || typeof user.id !== "number") return null;
    return { id: user.id, username: user.username || "" };
  } catch (e) {
    return null;
  }
}

function signSession(secret, userId) {
  const payload = Buffer.from(JSON.stringify({ id: userId, exp: Date.now() + SESSION_DAYS * 86400000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(secret, token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || data.exp < Date.now() || typeof data.id !== "number") return null;
    return { id: data.id, username: "" };
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ ядро */

function createServer({ db, bot, botToken, sessionSecret }) {
  const routes = { GET: new Map(), POST: new Map() };

  const signFile = (id) => {
    const exp = Date.now() + 15 * 60 * 1000;
    const sig = crypto.createHmac("sha256", sessionSecret).update(`file:${id}:${exp}`).digest("base64url");
    return `/files/${id}?exp=${exp}&sig=${sig}`;
  };

  const sdk = {
    db,
    signFile,
    log,
    escapeHtml,
    chunk,
    crypto,
    miniapp: {
      get: (p, handler) => routes.GET.set(p, handler),
      post: (p, handler) => routes.POST.set(p, handler),
      setMenuButton: (b, text) => {
        const url = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
        if (!url || !b || !b.api) return;
        b.api
          .setChatMenuButton({ menu_button: { type: "web_app", text, web_app: { url } } })
          .catch((e) => log.warn(`setChatMenuButton failed: ${e.message}`));
      },
    },
  };

  setupBot(bot, sdk);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use("/_api/library/upload", express.json({ limit: "10mb" }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (req, res) => res.type("text").send("ok"));

  /* library files: signed, short-lived links */
  app.get("/files/:id", (req, res) => {
    const id = Number(req.params.id);
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig || "");
    const expected = crypto.createHmac("sha256", sessionSecret).update(`file:${id}:${exp}`).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (!Number.isInteger(id) || !exp || exp < Date.now() || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).type("text").send("Ссылка устарела. Откройте файл из приложения заново.");
    }
    const row = db.get("SELECT filename, mime, data FROM library_files WHERE id = ?", [id]);
    if (!row) return res.status(404).type("text").send("Файл не найден");
    const ext = (row.filename.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
    const inline = !!(libraryTypes[ext] && libraryTypes[ext].inline);
    res.setHeader("Content-Type", row.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
    res.send(Buffer.from(row.data));
  });

  /* антиперебор паролей */
  const attempts = new Map();
  function tooManyAttempts(key) {
    const now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
    attempts.set(key, list);
    return list.length >= 8;
  }
  function recordAttempt(key) {
    attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
  }

  /* вход из обычного браузера: телефон + пароль -> подписанная сессия */
  app.post("/_api/web/session", (req, res) => {
    const body = req.body || {};
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    if (!phone || !password) return res.json({ ok: false, reason: "missing" });
    const key = `${req.ip}|${employees.normalizePhone(phone)}`;
    if (tooManyAttempts(key)) return res.status(429).json({ ok: false, reason: "too_many" });

    const emp = employees.byPhone(db, phone);
    if (!emp) { recordAttempt(key); return res.json({ ok: false, reason: "not_found" }); }
    let id = emp.telegram_id;
    if (!id) id = emp.phone === schema.OWNER_PHONE ? schema.OWNER_TELEGRAM_ID : -emp.id;
    if (emp.role === "owner") id = schema.OWNER_TELEGRAM_ID;

    const result = employees.login(sdk, db, id, emp.username || "", phone, password);
    if (!result.ok) { recordAttempt(key); return res.json({ ok: false, reason: result.reason }); }
    if (id === schema.OWNER_TELEGRAM_ID) {
      db.run("UPDATE employees SET role = 'owner', position = 'Владелец' WHERE phone = ? AND telegram_id = ? AND role = 'manager'", [schema.OWNER_PHONE, id]);
    }
    log.info(`web login ok: employee ${emp.id}`);
    res.json({ ok: true, token: signSession(sessionSecret, id) });
  });

  /* маршруты мини-приложения */
  app.all("/_api/*", async (req, res) => {
    const method = req.method;
    if (method !== "GET" && method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
    const route = req.path.slice("/_api".length);
    const handler = routes[method].get(route);
    if (!handler) return res.status(404).json({ error: "not_found" });

    const header = String(req.headers.authorization || "");
    let user = null;
    let viaWeb = false;
    if (header.startsWith("tma ")) user = verifyInitData(header.slice(4), botToken);
    else if (header.startsWith("web ")) { user = verifySession(sessionSecret, header.slice(4)); viaWeb = true; }
    if (!user) {
      if (header.startsWith("tma ") && header.length > 4) return res.status(401).json({ error: "unauthorized" });
      user = { id: 0, username: "" };
    }

    // Выход из веб-сессии не должен отвязывать Telegram-аккаунт сотрудника.
    if (viaWeb && route === "/auth/logout") return res.json({ ok: true });

    try {
      const data = await handler({ user, query: req.query || {}, body: req.body || {} });
      res.json(data === undefined ? { ok: true } : data);
    } catch (error) {
      log.error(`${method} ${route}: ${error.stack || error.message}`);
      res.status(500).json({ error: "server_error" });
    }
  });

  app.post("/_client-error", express.text({ type: "*/*", limit: "20kb" }), (req, res) => {
    log.warn(`client error: ${String(req.body || "").slice(0, 500)}`);
    res.status(204).end();
  });

  /* статические файлы (исходники .ts не отдаём) */
  app.use((req, res, next) => {
    if (/\.ts$/i.test(req.path)) return res.status(404).end();
    next();
  });
  app.use(express.static(WEB_DIR, {
    setHeaders(res, file) {
      if (/\.(html|js|css)$/.test(file)) res.setHeader("Cache-Control", "no-cache");
    },
  }));
  app.get("*", (req, res) => res.sendFile(path.join(WEB_DIR, "index.html")));

  return { app, sdk, routes };
}

/* --------------------------------------------------------------- запуск */

async function main() {
  const botToken = process.env.BOT_TOKEN || "";
  const dbFile = path.resolve(process.env.DATABASE_PATH || "./data/database.db");
  const sessionSecret = process.env.SESSION_SECRET || crypto.createHash("sha256").update("session|" + (botToken || "dev-secret")).digest("hex");

  const seed = path.join(__dirname, "seed", "database.db");
  if (!fs.existsSync(dbFile) && fs.existsSync(seed)) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.copyFileSync(seed, dbFile);
    log.info("база создана из seed/database.db");
  }
  const db = dbAdapter.open(dbFile);

  let bot;
  let webhookHandler = null;
  const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
  if (botToken) {
    const { Bot, webhookCallback } = require("grammy");
    bot = new Bot(botToken);
    bot.catch((err) => log.error(`bot error: ${err.message}`));
    if (publicUrl) {
      const secret = crypto.createHash("sha256").update("hook|" + botToken).digest("hex").slice(0, 32);
      webhookHandler = { path: `/telegram/${secret}`, secret, handle: webhookCallback(bot, "express", { secretToken: secret }) };
    }
  } else {
    log.warn("BOT_TOKEN не задан: запущена только веб-часть, Telegram-бот отключён");
    bot = { command() {}, on() {}, callbackQuery() {}, api: { sendMessage: async () => {}, setChatMenuButton: async () => {} } };
  }

  const { app } = createServer({ db, bot, botToken, sessionSecret });
  if (webhookHandler) app.post(webhookHandler.path, webhookHandler.handle);

  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => log.info(`сервер запущен на порту ${port}`));

  if (botToken) {
    await bot.init();
    if (webhookHandler) {
      await bot.api.setWebhook(publicUrl + webhookHandler.path, { secret_token: webhookHandler.secret, drop_pending_updates: false });
      log.info(`webhook установлен: ${publicUrl}/telegram/***`);
    } else {
      await bot.api.deleteWebhook();
      bot.start({ onStart: () => log.info("бот запущен (long polling)") });
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    log.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { createServer, verifyInitData, signSession, verifySession };
