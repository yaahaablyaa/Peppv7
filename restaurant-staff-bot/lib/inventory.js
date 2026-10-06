/**
 * Inventory (инвентаризация).
 *
 *  - items: stock positions per department (Кухня / Бар / Зал / Хозтовары)
 *  - moves: journal of every change (приход, списание, корректировка по пересчёту)
 *  - counts: a count session: lines snapshot the expected stock, staff enter the actual
 *    quantities, finishing the count applies the differences and stores a report.
 */

const roles = require("./roles");
const time = require("./time");

const UNITS = ["шт", "кг", "л", "уп", "бут", "компл", "рул", "порц"];
const IN_REASONS = ["Закупка", "Возврат", "Перемещение", "Другое"];
const OUT_REASONS = ["Использовано", "Испорчено", "Разбито", "Потеряно", "Перемещение", "Другое"];

/** Quick-add suggestions per department: [name, unit]. */
const PRESETS = {
  Кухня: [["Мука", "кг"], ["Томаты", "кг"], ["Мясо", "кг"], ["Масло", "л"], ["Яйца", "шт"]],
  Бар: [["Кофе в зёрнах", "кг"], ["Молоко", "л"], ["Сироп", "бут"], ["Чай", "уп"], ["Лёд", "кг"]],
  Посуда: [["Тарелка обеденная", "шт"], ["Тарелка десертная", "шт"], ["Бокал", "шт"], ["Стакан", "шт"], ["Чашка", "шт"], ["Вилка", "шт"], ["Нож столовый", "шт"], ["Ложка", "шт"], ["Салатник", "шт"], ["Поднос", "шт"]],
  Хозтовары: [["Салфетки", "уп"], ["Моющее средство", "л"], ["Мешки для мусора", "рул"], ["Перчатки", "уп"], ["Губки", "шт"], ["Туалетная бумага", "рул"]],
};

const round3 = (n) => Math.round(n * 1000) / 1000;
const num = (v) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".").trim()) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

function registerInventory(bot, sdk, helpers) {
  const { db } = sdk;
  const { me, NO_ACCESS } = helpers;

  const branchOf = (emp, requested) => {
    if (roles.isGlobal(emp) && requested !== undefined && requested !== "" && requested !== "all" && requested !== null) {
      const id = Number(requested);
      if (Number.isInteger(id) && db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [id])) return id;
    }
    return emp.branch_id || 1;
  };

  const money = (emp) => roles.canSeeInventoryMoney(emp);

  function publicItem(row, withMoney) {
    const out = {
      id: row.id,
      department: row.department,
      name: row.name,
      unit: row.unit,
      qty: round3(row.qty),
      min_qty: round3(row.min_qty),
      low: row.min_qty > 0 && row.qty <= row.min_qty,
      empty: row.qty <= 0,
    };
    if (withMoney) { out.unit_cost = row.unit_cost; out.value = Math.round(row.qty * row.unit_cost); }
    return out;
  }

  function logMove(item, kind, delta, reason, note, empId) {
    db.run(
      "INSERT INTO inventory_moves (item_id, branch_id, kind, qty, balance, reason, note, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [item.id, item.branch_id, kind, round3(delta), round3(item.qty), reason, note, empId]
    );
  }

  /** SQLite lower() is ASCII-only, so compare names in JS (Cyrillic-safe). */
  const nameTaken = (branchId, department, name, exceptId) => {
    const key = name.toLowerCase();
    return db.all("SELECT id, name FROM inventory_items WHERE branch_id = ? AND department = ? AND active = 1", [branchId, department])
      .some((r) => r.id !== exceptId && r.name.toLowerCase() === key);
  };

  const getItem = (id) => db.get("SELECT * FROM inventory_items WHERE id = ? AND active = 1", [Number(id)]);

  /** Item visible/editable to the person (branch + department checks). */
  function accessibleItem(emp, id, needEdit) {
    const item = getItem(id);
    if (!item || !roles.canAccessBranch(emp, item.branch_id)) return null;
    if (!roles.canViewInventoryDept(emp, item.department)) return null;
    if (needEdit && !roles.canEditInventoryDept(emp, item.department)) return null;
    return item;
  }

  async function notifyLeads(branchId, title, text, tgText) {
    const targets = db.all(
      "SELECT id, telegram_id, notifications_on FROM employees WHERE active = 1 AND (role IN ('manager', 'owner') AND branch_id = ? OR role = 'finance')",
      [branchId]
    );
    db.transaction(() => {
      targets.forEach((t) => db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [t.id, title, text]));
    });
    await Promise.all(targets.filter((t) => t.telegram_id && t.telegram_id > 0 && t.notifications_on).map(async (t) => {
      try { await bot.api.sendMessage(t.telegram_id, tgText, { parse_mode: "HTML" }); }
      catch (error) { sdk.log.warn(`inventory notify failed for ${t.id}: ${error.message}`); }
    }));
  }

  /* ------------------------------------------------------------- Остатки */

  sdk.miniapp.get("/inventory", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const q = ctx.query || {};
    const branchId = branchOf(emp, q.branch);
    const withMoney = money(emp);
    const rows = db.all("SELECT * FROM inventory_items WHERE branch_id = ? AND active = 1 ORDER BY department, name COLLATE NOCASE", [branchId])
      .filter((r) => roles.canViewInventoryDept(emp, r.department));
    const items = rows.map((r) => publicItem(r, withMoney));
    const editable = roles.INVENTORY_DEPARTMENTS.filter((d) => roles.canEditInventoryDept(emp, d));
    const visible = roles.INVENTORY_DEPARTMENTS.filter((d) => roles.canViewInventoryDept(emp, d));
    const open = db.all(
      `SELECT c.id, c.department, c.started_at, u.full_name AS by_name,
              (SELECT COUNT(*) FROM inventory_count_lines l WHERE l.count_id = c.id) AS total,
              (SELECT COUNT(*) FROM inventory_count_lines l WHERE l.count_id = c.id AND l.actual IS NOT NULL) AS counted
         FROM inventory_counts c LEFT JOIN employees u ON u.id = c.started_by
        WHERE c.branch_id = ? AND c.status = 'open' ORDER BY c.id DESC`,
      [branchId]
    ).filter((c) => roles.canViewInventoryDept(emp, c.department));
    return {
      branch: branchId,
      branches: roles.isGlobal(emp) ? db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id") : [],
      money: withMoney,
      departments: visible,
      editable_departments: editable,
      can_edit: editable.length > 0,
      units: UNITS,
      presets: PRESETS,
      in_reasons: IN_REASONS,
      out_reasons: OUT_REASONS,
      items,
      open_counts: open,
      summary: {
        items: items.length,
        low: items.filter((i) => i.low || i.empty && i.min_qty > 0).length,
        ...(withMoney ? { value: items.reduce((s, i) => s + (i.value || 0), 0) } : {}),
      },
    };
  });

  sdk.miniapp.post("/inventory/items", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const department = String(b.department || "");
    if (!roles.INVENTORY_DEPARTMENTS.includes(department) || !roles.canEditInventoryDept(emp, department)) return { ok: false, reason: "forbidden" };
    const name = String(b.name || "").trim().replace(/\s+/g, " ");
    const unit = UNITS.includes(String(b.unit)) ? String(b.unit) : "";
    const qty = b.qty === undefined || b.qty === "" ? 0 : num(b.qty);
    const minQty = b.min_qty === undefined || b.min_qty === "" ? 0 : num(b.min_qty);
    const cost = b.unit_cost === undefined || b.unit_cost === "" || !money(emp) ? 0 : num(b.unit_cost);
    if (name.length < 2 || name.length > 80 || !unit || ![qty, minQty, cost].every((n) => Number.isFinite(n) && n >= 0 && n < 1e9)) return { ok: false, reason: "bad_item" };
    const branchId = branchOf(emp, b.branch_id);
    if (nameTaken(branchId, department, name, 0)) return { ok: false, reason: "duplicate" };
    let id;
    db.transaction(() => {
      db.run("INSERT INTO inventory_items (branch_id, department, name, unit, qty, min_qty, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [branchId, department, name, unit, round3(qty), round3(minQty), cost]);
      id = db.get("SELECT last_insert_rowid() AS id").id;
      if (qty > 0) logMove(getItem(id), "in", qty, "Начальный остаток", "", emp.id);
    });
    return { ok: true, id };
  });

  sdk.miniapp.post("/inventory/items/update", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const item = accessibleItem(emp, b.id, true);
    if (!item) return { ok: false, reason: "not_found" };
    const name = b.name === undefined ? item.name : String(b.name).trim().replace(/\s+/g, " ");
    const unit = b.unit === undefined ? item.unit : String(b.unit);
    const minQty = b.min_qty === undefined ? item.min_qty : num(b.min_qty);
    const cost = b.unit_cost === undefined || !money(emp) ? item.unit_cost : num(b.unit_cost);
    if (name.length < 2 || name.length > 80 || !UNITS.includes(unit) || ![minQty, cost].every((n) => Number.isFinite(n) && n >= 0 && n < 1e9)) return { ok: false, reason: "bad_item" };
    if (nameTaken(item.branch_id, item.department, name, item.id)) return { ok: false, reason: "duplicate" };
    db.run("UPDATE inventory_items SET name = ?, unit = ?, min_qty = ?, unit_cost = ? WHERE id = ?", [name, unit, round3(minQty), cost, item.id]);
    return { ok: true };
  });

  sdk.miniapp.post("/inventory/items/delete", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const item = accessibleItem(emp, (ctx.body || {}).id, true);
    if (!item) return { ok: false, reason: "not_found" };
    if (db.get("SELECT c.id FROM inventory_counts c JOIN inventory_count_lines l ON l.count_id = c.id WHERE c.status = 'open' AND l.item_id = ?", [item.id])) {
      return { ok: false, reason: "in_count" };
    }
    db.run("UPDATE inventory_items SET active = 0 WHERE id = ?", [item.id]);
    return { ok: true };
  });

  /** Приход / списание */
  sdk.miniapp.post("/inventory/move", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const item = accessibleItem(emp, b.item_id, true);
    if (!item) return { ok: false, reason: "not_found" };
    const kind = b.kind === "out" ? "out" : b.kind === "in" ? "in" : "";
    const qty = num(b.qty);
    if (!kind || !Number.isFinite(qty) || qty <= 0 || qty >= 1e9) return { ok: false, reason: "bad_qty" };
    const reasons = kind === "in" ? IN_REASONS : OUT_REASONS;
    const reason = reasons.includes(String(b.reason)) ? String(b.reason) : reasons[reasons.length - 1];
    const note = String(b.note || "").trim().slice(0, 200);
    if (kind === "out" && qty > item.qty + 1e-9) return { ok: false, reason: "not_enough", available: round3(item.qty) };
    const next = round3(item.qty + (kind === "in" ? qty : -qty));
    db.transaction(() => {
      db.run("UPDATE inventory_items SET qty = ? WHERE id = ?", [next, item.id]);
      logMove({ ...item, qty: next }, kind, kind === "in" ? qty : -qty, reason, note, emp.id);
    });
    return { ok: true, qty: next };
  });

  /** Journal: last movements (optionally for one item). */
  sdk.miniapp.get("/inventory/moves", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const q = ctx.query || {};
    const branchId = branchOf(emp, q.branch);
    const itemId = q.item_id ? Number(q.item_id) : null;
    const rows = db.all(
      `SELECT m.id, m.item_id, m.kind, m.qty, m.balance, m.reason, m.note, m.created_at, i.name, i.unit, i.department, u.full_name AS by_name
         FROM inventory_moves m JOIN inventory_items i ON i.id = m.item_id LEFT JOIN employees u ON u.id = m.employee_id
        WHERE m.branch_id = ? ${itemId ? "AND m.item_id = ?" : ""} ORDER BY m.id DESC LIMIT 120`,
      itemId ? [branchId, itemId] : [branchId]
    ).filter((r) => roles.canViewInventoryDept(emp, r.department));
    return { moves: rows };
  });

  /* ------------------------------------------------------- Инвентаризация */

  function countLines(countId) {
    return db.all("SELECT id, item_id, name, unit, expected, actual, unit_cost FROM inventory_count_lines WHERE count_id = ? ORDER BY name COLLATE NOCASE", [countId]);
  }

  function accessibleCount(emp, id, needEdit) {
    const count = db.get("SELECT * FROM inventory_counts WHERE id = ?", [Number(id)]);
    if (!count || !roles.canAccessBranch(emp, count.branch_id) || !roles.canViewInventoryDept(emp, count.department)) return null;
    if (needEdit && !roles.canEditInventoryDept(emp, count.department)) return null;
    return count;
  }

  function publicCount(count, emp) {
    const lines = countLines(count.id);
    const withMoney = money(emp);
    const counted = lines.filter((l) => l.actual !== null);
    const mapped = lines.map((l) => {
      const diff = l.actual === null ? null : round3(l.actual - l.expected);
      const out = { id: l.id, item_id: l.item_id, name: l.name, unit: l.unit, expected: round3(l.expected), actual: l.actual === null ? null : round3(l.actual), diff };
      if (withMoney) out.diff_value = diff === null ? null : Math.round(diff * l.unit_cost);
      return out;
    });
    const live = {
      shortage: mapped.reduce((s, l) => s + (l.diff_value && l.diff_value < 0 ? -l.diff_value : 0), 0),
      surplus: mapped.reduce((s, l) => s + (l.diff_value && l.diff_value > 0 ? l.diff_value : 0), 0),
      diff_items: mapped.filter((l) => l.diff !== null && Math.abs(l.diff) > 1e-9).length,
    };
    const names = db.get(
      `SELECT (SELECT full_name FROM employees WHERE id = ?) AS started, (SELECT full_name FROM employees WHERE id = ?) AS finished`,
      [count.started_by, count.finished_by]
    );
    return {
      id: count.id,
      department: count.department,
      status: count.status,
      started_at: count.started_at,
      finished_at: count.finished_at,
      started_by: names.started,
      finished_by: names.finished,
      total: lines.length,
      counted: counted.length,
      money: withMoney,
      summary: count.status === "done"
        ? { shortage: count.shortage, surplus: count.surplus, diff_items: count.diff_items }
        : live,
      lines: mapped,
      can_edit: roles.canEditInventoryDept(emp, count.department),
    };
  }

  sdk.miniapp.get("/inventory/counts", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const branchId = branchOf(emp, (ctx.query || {}).branch);
    const rows = db.all(
      `SELECT c.id, c.department, c.started_at, c.finished_at, c.shortage, c.surplus, c.diff_items, c.counted_items,
              u.full_name AS by_name
         FROM inventory_counts c LEFT JOIN employees u ON u.id = COALESCE(c.finished_by, c.started_by)
        WHERE c.branch_id = ? AND c.status = 'done' ORDER BY c.id DESC LIMIT 40`,
      [branchId]
    ).filter((c) => roles.canViewInventoryDept(emp, c.department));
    return { money: money(emp), counts: rows };
  });

  sdk.miniapp.get("/inventory/counts/get", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const count = accessibleCount(emp, (ctx.query || {}).id, false);
    if (!count) return { error: "not_found" };
    return publicCount(count, emp);
  });

  sdk.miniapp.post("/inventory/counts/start", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const department = String(b.department || "");
    if (!roles.INVENTORY_DEPARTMENTS.includes(department) || !roles.canEditInventoryDept(emp, department)) return { ok: false, reason: "forbidden" };
    const branchId = branchOf(emp, b.branch_id);
    const existing = db.get("SELECT id FROM inventory_counts WHERE branch_id = ? AND department = ? AND status = 'open'", [branchId, department]);
    if (existing) return { ok: true, id: existing.id, resumed: true };
    const items = db.all("SELECT * FROM inventory_items WHERE branch_id = ? AND department = ? AND active = 1 ORDER BY name COLLATE NOCASE", [branchId, department]);
    if (!items.length) return { ok: false, reason: "no_items" };
    let id;
    db.transaction(() => {
      db.run("INSERT INTO inventory_counts (branch_id, department, started_by) VALUES (?, ?, ?)", [branchId, department, emp.id]);
      id = db.get("SELECT last_insert_rowid() AS id").id;
      items.forEach((it) => db.run(
        "INSERT INTO inventory_count_lines (count_id, item_id, name, unit, expected, unit_cost) VALUES (?, ?, ?, ?, ?, ?)",
        [id, it.id, it.name, it.unit, it.qty, it.unit_cost]
      ));
    });
    return { ok: true, id };
  });

  sdk.miniapp.post("/inventory/counts/set", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const b = ctx.body || {};
    const count = accessibleCount(emp, b.count_id, true);
    if (!count || count.status !== "open") return { ok: false, reason: "not_found" };
    const line = db.get("SELECT id FROM inventory_count_lines WHERE id = ? AND count_id = ?", [Number(b.line_id), count.id]);
    if (!line) return { ok: false, reason: "not_found" };
    let actual = null;
    if (b.actual !== null && b.actual !== undefined && String(b.actual).trim() !== "") {
      actual = num(b.actual);
      if (!Number.isFinite(actual) || actual < 0 || actual >= 1e9) return { ok: false, reason: "bad_qty" };
      actual = round3(actual);
    }
    db.run("UPDATE inventory_count_lines SET actual = ? WHERE id = ?", [actual, line.id]);
    const counted = db.get("SELECT COUNT(*) AS c FROM inventory_count_lines WHERE count_id = ? AND actual IS NOT NULL", [count.id]).c;
    return { ok: true, counted };
  });

  sdk.miniapp.post("/inventory/counts/finish", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const count = accessibleCount(emp, (ctx.body || {}).count_id, true);
    if (!count || count.status !== "open") return { ok: false, reason: "not_found" };
    const lines = countLines(count.id).filter((l) => l.actual !== null);
    if (!lines.length) return { ok: false, reason: "nothing_counted" };

    let shortage = 0;
    let surplus = 0;
    let diffItems = 0;
    db.transaction(() => {
      lines.forEach((l) => {
        const diff = round3(l.actual - l.expected);
        if (Math.abs(diff) > 1e-9) {
          diffItems += 1;
          if (diff < 0) shortage += -diff * l.unit_cost; else surplus += diff * l.unit_cost;
        }
        const item = getItem(l.item_id);
        if (!item) return;
        const delta = round3(l.actual - item.qty);
        db.run("UPDATE inventory_items SET qty = ? WHERE id = ?", [l.actual, item.id]);
        if (Math.abs(delta) > 1e-9) logMove({ ...item, qty: l.actual }, "adjust", delta, "Инвентаризация", `Пересчёт №${count.id}`, emp.id);
      });
      db.run(
        "UPDATE inventory_counts SET status = 'done', finished_by = ?, finished_at = datetime('now'), shortage = ?, surplus = ?, diff_items = ?, counted_items = ? WHERE id = ?",
        [emp.id, Math.round(shortage), Math.round(surplus), diffItems, lines.length, count.id]
      );
    });

    if (diffItems > 0) {
      const title = `Инвентаризация: ${count.department}`;
      const withMoney = shortage > 0 ? ` Недостача ${Math.round(shortage).toLocaleString("ru-RU")} сум.` : "";
      await notifyLeads(count.branch_id, title, `Расхождений: ${diffItems}.${withMoney}`,
        `📦 <b>${sdk.escapeHtml(title)}</b>\nРасхождений: ${diffItems}.${withMoney}`);
    }
    return { ok: true, id: count.id, diff_items: diffItems };
  });

  sdk.miniapp.post("/inventory/counts/cancel", async (ctx) => {
    const emp = me(ctx);
    if (!roles.canUseInventory(emp)) return NO_ACCESS;
    const count = accessibleCount(emp, (ctx.body || {}).count_id, true);
    if (!count || count.status !== "open") return { ok: false, reason: "not_found" };
    db.transaction(() => {
      db.run("DELETE FROM inventory_count_lines WHERE count_id = ?", [count.id]);
      db.run("DELETE FROM inventory_counts WHERE id = ?", [count.id]);
    });
    return { ok: true };
  });
}

/** Number of items at or below the minimum, for the home screen. */
registerInventory.lowStock = function lowStock(db, emp) {
  if (!roles.canUseInventory(emp)) return 0;
  const rows = db.all("SELECT department FROM inventory_items WHERE branch_id = ? AND active = 1 AND min_qty > 0 AND qty <= min_qty", [emp.branch_id || 1]);
  return rows.filter((r) => roles.canViewInventoryDept(emp, r.department)).length;
};

module.exports = registerInventory;
