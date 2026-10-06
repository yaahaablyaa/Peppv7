/**
 * Library (методички): files for the team, e.g. menu manuals.
 * Files live in the database; they are opened through short-lived signed links (/files/:id).
 */

const roles = require("./roles");

const CATEGORIES = ["Меню", "Стандарты", "Инструкции", "Другое"];
const MAX_BYTES = 6 * 1024 * 1024;

const TYPES = {
  pdf: { mime: "application/pdf", inline: true, magic: (b) => b.slice(0, 4).toString() === "%PDF" },
  png: { mime: "image/png", inline: true, magic: (b) => b[0] === 0x89 && b[1] === 0x50 },
  jpg: { mime: "image/jpeg", inline: true, magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  jpeg: { mime: "image/jpeg", inline: true, magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  webp: { mime: "image/webp", inline: true, magic: (b) => b.slice(0, 4).toString() === "RIFF" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false, magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  txt: { mime: "text/plain; charset=utf-8", inline: false, magic: () => true },
  csv: { mime: "text/csv; charset=utf-8", inline: false, magic: () => true },
};

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : "";
}

function registerLibrary(bot, sdk, helpers) {
  const { db } = sdk;
  const { me, isManager, NO_ACCESS } = helpers;

  const visible = (emp, row) => roles.inAudience(emp, roles.parsePositions(row.positions));

  sdk.miniapp.get("/library", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const rows = db.all(
      "SELECT id, title, category, filename, mime, size, positions, created_at FROM library_files ORDER BY id DESC LIMIT 300"
    ).filter((r) => visible(emp, r));
    return {
      can_manage: isManager(emp),
      categories: CATEGORIES,
      positions: isManager(emp) ? roles.ALL_POSITIONS : [],
      max_mb: MAX_BYTES / 1024 / 1024,
      files: rows.map(({ positions, ...r }) => ({ ...r, ext: extOf(r.filename), audience: roles.parsePositions(positions) })),
    };
  });

  sdk.miniapp.post("/library/upload", async (ctx) => {
    const emp = me(ctx);
    if (!isManager(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const title = String(b.title || "").trim().replace(/\s+/g, " ");
    const category = CATEGORIES.includes(String(b.category)) ? String(b.category) : "Другое";
    const filename = String(b.filename || "").trim().replace(/[\\/\0]/g, "_").slice(0, 120);
    const ext = extOf(filename);
    const type = TYPES[ext];
    const match = String(b.data || "").match(/^data:[^;,]*(?:;[^;,]*)*;base64,([A-Za-z0-9+/=\s]+)$/);
    if (title.length < 2 || title.length > 120 || !filename || !type || !match) return { ok: false, reason: "bad_file" };
    const bytes = Buffer.from(match[1], "base64");
    if (!bytes.length) return { ok: false, reason: "bad_file" };
    if (bytes.length > MAX_BYTES) return { ok: false, reason: "too_big" };
    if (!type.magic(bytes)) return { ok: false, reason: "bad_file" };
    const audience = roles.cleanAudience(b.positions);
    db.run(
      "INSERT INTO library_files (title, category, filename, mime, size, data, positions, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [title, category, filename, type.mime, bytes.length, bytes, JSON.stringify(audience), emp.id]
    );

    const staff = db.all("SELECT id, telegram_id, notifications_on, position, role FROM employees WHERE active = 1 AND role NOT IN ('owner')")
      .filter((e) => !audience.length || e.role === "manager" || audience.includes(e.position || ""));
    db.transaction(() => {
      staff.forEach((e) => db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [e.id, "Новая методичка", `${category}: ${title}`]));
    });
    await Promise.all(staff.filter((e) => e.telegram_id && e.notifications_on).map(async (e) => {
      try { await bot.api.sendMessage(e.telegram_id, `📎 <b>Новая методичка</b>\n${sdk.escapeHtml(category)}: ${sdk.escapeHtml(title)}`, { parse_mode: "HTML" }); }
      catch (error) { sdk.log.warn(`library notify failed for ${e.id}: ${error.message}`); }
    }));
    return { ok: true };
  });

  sdk.miniapp.post("/library/delete", async (ctx) => {
    const emp = me(ctx);
    if (!isManager(emp)) return NO_ACCESS;
    const id = Number((ctx.body || {}).id);
    if (!Number.isInteger(id) || !db.get("SELECT id FROM library_files WHERE id = ?", [id])) return { ok: false, reason: "not_found" };
    db.run("DELETE FROM library_files WHERE id = ?", [id]);
    return { ok: true };
  });

  /** Short-lived signed link so the file can be opened by the browser or Telegram. */
  sdk.miniapp.get("/library/link", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const row = db.get("SELECT id, positions FROM library_files WHERE id = ?", [Number((ctx.query || {}).id)]);
    if (!row || !visible(emp, row)) return { error: "not_found" };
    return { url: sdk.signFile ? sdk.signFile(row.id) : `/files/${row.id}` };
  });
}

registerLibrary.TYPES = TYPES;
module.exports = registerLibrary;
