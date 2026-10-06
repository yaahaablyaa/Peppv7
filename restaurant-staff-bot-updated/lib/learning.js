/**
 * Training progress and checklists.
 *  - trainings: employees mark materials as studied, managers see everyone's progress;
 *  - checklists: daily runs per employee, optional audience by position,
 *    managers see who completed which task and when.
 */

const time = require("./time");

const STAFF_FILTER = "employees.active = 1 AND employees.role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager')";

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function targetsPosition(positions, position, isMgr) {
  return isMgr || !positions.length || positions.includes(position || "");
}

function audienceMatches(emp, row) {
  const branches = parseJson(row.audience_branches, []).map(Number).filter(Number.isInteger);
  const positions = parseJson(row.audience_positions, []).map(String);
  const employees = parseJson(row.audience_employees, []).map(Number).filter(Number.isInteger);
  if (!branches.length && !positions.length && !employees.length) return true;
  if (employees.includes(emp.id)) return true;
  return (!branches.length || branches.includes(Number(emp.branch_id || 1))) && (!positions.length || positions.includes(String(emp.position || "")));
}

function audiencePayload(body) {
  const clean = (value, mapper, max) => Array.isArray(value) ? [...new Set(value.map(mapper).filter(Boolean))].slice(0, max) : [];
  return {
    branches: clean(body.audience_branches, (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }, 20),
    positions: clean(body.audience_positions, (v) => String(v || "").trim().slice(0, 60), 20),
    employees: clean(body.audience_employees, (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }, 100),
  };
}

function itemsOf(row) {
  return parseJson(row.items, []).filter((item) => typeof item === "string");
}

function positionsOf(row) {
  const list = parseJson(row.positions, []);
  return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
}

/** Progress shown on the home screen. */
function learningProgress(db, emp, date) {
  const isMgr = emp.role === "manager" || emp.role === "owner";
  const trainingRows = db.all("SELECT id, audience_branches, audience_positions, audience_employees FROM trainings").filter((row) => audienceMatches(emp, row));
  const trainingIds = trainingRows.map((row) => row.id);
  const trainings = trainingIds.length;
  const trainingsDone = trainingIds.length ? db.get(
    `SELECT COUNT(*) AS c FROM training_progress WHERE employee_id = ? AND training_id IN (${trainingIds.map(() => "?").join(",")})`,
    [emp.id, ...trainingIds]
  ).c : 0;
  const lists = db.all("SELECT id, items, positions FROM checklists")
    .filter((row) => targetsPosition(positionsOf(row), emp.position, isMgr));
  let fullyDone = 0;
  let itemsTotal = 0;
  let itemsDone = 0;
  lists.forEach((row) => {
    const total = itemsOf(row).length;
    const run = db.get("SELECT done FROM checklist_runs WHERE checklist_id = ? AND employee_id = ? AND date = ?", [row.id, emp.id, date]);
    const done = run ? parseJson(run.done, []).filter(Number.isInteger).filter((i) => i < total).length : 0;
    itemsTotal += total;
    itemsDone += done;
    if (total && done >= total) fullyDone += 1;
  });
  return {
    trainings: { done: trainingsDone, total: trainings },
    checklists: { done: fullyDone, total: lists.length, items_done: itemsDone, items_total: itemsTotal },
  };
}

function registerLearning(bot, sdk, helpers) {
  const { db } = sdk;
  const { me, isManager, today, NO_ACCESS } = helpers;

  async function broadcast(employees, title, text, tgText) {
    db.transaction(() => {
      employees.forEach((e) => db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [e.id, title, text]));
    });
    await Promise.all(employees
      .filter((e) => e.telegram_id && e.telegram_id > 0 && e.notifications_on)
      .map(async (e) => {
        try { await bot.api.sendMessage(e.telegram_id, tgText, { parse_mode: "HTML" }); }
        catch (error) { sdk.log.warn(`learning notify failed for employee ${e.id}: ${error.message}`); }
      }));
  }

  /* ----------------------------------------------------------- Обучение */

  sdk.miniapp.get("/trainings", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const manager = isManager(emp);
    const rows = db.all("SELECT id, title, body, url, created_at, audience_branches, audience_positions, audience_employees FROM trainings ORDER BY id DESC LIMIT 100");
    const visibleRows = manager ? rows : rows.filter((row) => audienceMatches(emp, row));
    const mine = new Map(db.all("SELECT training_id, completed_at FROM training_progress WHERE employee_id = ?", [emp.id]).map((r) => [r.training_id, r.completed_at]));
    let counts = new Map();
    let staffTotal = 0;
    if (manager) {
      counts = new Map(db.all(
        `SELECT training_progress.training_id AS id, COUNT(*) AS c FROM training_progress
           JOIN employees ON employees.id = training_progress.employee_id
          WHERE ${STAFF_FILTER} GROUP BY training_progress.training_id`
      ).map((r) => [r.id, r.c]));
      staffTotal = db.get(`SELECT COUNT(*) AS c FROM employees WHERE ${STAFF_FILTER}`).c;
    }
    const trainings = visibleRows.map((t) => ({
      ...t,
      audience_branches: parseJson(t.audience_branches, []),
      audience_positions: parseJson(t.audience_positions, []),
      audience_employees: parseJson(t.audience_employees, []),
      done: mine.has(t.id),
      completed_at: mine.get(t.id) || null,
      ...(manager ? { completed: counts.get(t.id) || 0, total: staffTotal } : {}),
    }));
    return {
      can_manage: manager,
      trainings,
      progress: { done: trainings.filter((t) => t.done).length, total: trainings.length },
      audience: manager ? {
        branches: db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id"),
        positions: require("./roles").POSITIONS.map((p) => p.title),
        employees: db.all("SELECT id, full_name AS name, position, branch_id FROM employees WHERE active = 1 AND role NOT IN ('owner') ORDER BY full_name"),
      } : null,
    };
  });

  sdk.miniapp.post("/trainings", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;

    const body = ctx.body || {};
    const title = String(body.title || "").trim().replace(/\s+/g, " ");
    const text = String(body.body || "").trim();
    const url = String(body.url || "").trim();
    const audience = audiencePayload(body);
    audience.branches = audience.branches.filter((id) => { const b = db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [id]); return b && require("./roles").canAccessBranch(manager, id); });
    audience.employees = audience.employees.filter((id) => { const e = db.get("SELECT id, branch_id, active FROM employees WHERE id = ?", [id]); return e && e.active && require("./roles").canAccessBranch(manager, e.branch_id); });
    let validUrl = "";
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") return { ok: false, reason: "bad_url" };
        validUrl = parsed.toString();
      } catch (error) {
        return { ok: false, reason: "bad_url" };
      }
    }
    if (title.length < 2 || title.length > 120 || text.length < 2 || text.length > 4000 || validUrl.length > 2048) {
      return { ok: false, reason: "bad_training" };
    }

    db.run("INSERT INTO trainings (title, body, url, branch_id, audience_branches, audience_positions, audience_employees) VALUES (?, ?, ?, ?, ?, ?, ?)", [title, text, validUrl, manager.branch_id || 1, JSON.stringify(audience.branches), JSON.stringify(audience.positions), JSON.stringify(audience.employees)]);
    const staff = db.all(`SELECT id, telegram_id, notifications_on, branch_id, position FROM employees WHERE ${STAFF_FILTER}`).filter((e) => require("./roles").canAccessBranch(manager, e.branch_id) && audienceMatches(e, { audience_branches: JSON.stringify(audience.branches), audience_positions: JSON.stringify(audience.positions), audience_employees: JSON.stringify(audience.employees) }));
    await broadcast(staff, "Новый материал для обучения", title,
      `📚 <b>Новый материал для обучения</b>\n${sdk.escapeHtml(title)}`);
    return { ok: true };
  });

  sdk.miniapp.post("/trainings/complete", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const body = ctx.body || {};
    const id = Number(body.training_id);
    if (!Number.isInteger(id) || !db.get("SELECT id FROM trainings WHERE id = ?", [id])) return { ok: false, reason: "not_found" };
    const done = body.done !== false;
    if (done) db.run("INSERT OR IGNORE INTO training_progress (training_id, employee_id) VALUES (?, ?)", [id, emp.id]);
    else db.run("DELETE FROM training_progress WHERE training_id = ? AND employee_id = ?", [id, emp.id]);
    return { ok: true, done };
  });

  sdk.miniapp.post("/trainings/delete", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const id = Number((ctx.body || {}).id);
    if (!Number.isInteger(id) || !db.get("SELECT id FROM trainings WHERE id = ?", [id])) return { ok: false, reason: "not_found" };
    db.transaction(() => {
      db.run("DELETE FROM training_progress WHERE training_id = ?", [id]);
      db.run("DELETE FROM trainings WHERE id = ?", [id]);
    });
    return { ok: true };
  });

  sdk.miniapp.get("/trainings/progress", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const trainings = db.all("SELECT id, title FROM trainings ORDER BY id DESC LIMIT 100");
    const staff = db.all(`SELECT id, full_name AS name, position FROM employees WHERE ${STAFF_FILTER} ORDER BY full_name, id`);
    const rows = db.all(
      `SELECT training_progress.training_id, training_progress.employee_id, training_progress.completed_at
         FROM training_progress JOIN employees ON employees.id = training_progress.employee_id
        WHERE ${STAFF_FILTER}`
    );
    const byEmployee = new Map();
    rows.forEach((r) => {
      if (!byEmployee.has(r.employee_id)) byEmployee.set(r.employee_id, new Map());
      byEmployee.get(r.employee_id).set(r.training_id, r.completed_at);
    });
    const employees = staff.map((e) => {
      const done = byEmployee.get(e.id) || new Map();
      const items = trainings.filter((t) => audienceMatches(e, t)).map((t) => ({ training_id: t.id, title: t.title, done: done.has(t.id), at: done.get(t.id) || null }));
      const doneCount = items.filter((i) => i.done).length;
      return { ...e, done: doneCount, total: items.length, percent: items.length ? Math.round(doneCount / items.length * 100) : 0, items };
    });
    const summary = trainings.length && employees.length
      ? Math.round(employees.reduce((sum, e) => sum + e.percent, 0) / employees.length)
      : 0;
    return {
      trainings: trainings.map((t) => ({
        id: t.id,
        title: t.title,
        done: employees.filter((e) => e.items.find((i) => i.training_id === t.id && i.done)).length,
        total: employees.length,
      })),
      employees,
      summary,
    };
  });

  /* ---------------------------------------------------------- Чек-листы */

  sdk.miniapp.get("/checklists", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const manager = isManager(emp);
    const date = today();
    const rows = db.all(
      `SELECT checklists.id, checklists.title, checklists.items, checklists.positions,
              checklist_runs.done, checklist_runs.log
         FROM checklists
         LEFT JOIN checklist_runs ON checklist_runs.checklist_id = checklists.id
           AND checklist_runs.employee_id = ? AND checklist_runs.date = ?
        ORDER BY checklists.id DESC`,
      [emp.id, date]
    );
    const checklists = rows
      .map((row) => ({ row, positions: positionsOf(row) }))
      .filter(({ positions }) => targetsPosition(positions, emp.position, manager))
      .map(({ row, positions }) => {
        const items = itemsOf(row);
        return {
          id: row.id,
          title: row.title,
          items,
          positions,
          done: parseJson(row.done, []).filter((i) => Number.isInteger(i) && i < items.length),
          times: parseJson(row.log, {}),
        };
      });
    return {
      can_manage: manager,
      date,
      checklists,
      positions_available: manager
        ? [...new Set(db.all(`SELECT position FROM employees WHERE ${STAFF_FILTER}`).map((r) => r.position).filter(Boolean))].sort()
        : [],
    };
  });

  sdk.miniapp.post("/checklists", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const body = ctx.body || {};
    const title = String(body.title || "").trim().replace(/\s+/g, " ");
    const items = Array.isArray(body.items)
      ? body.items.map((item) => String(item || "").trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 30)
      : [];
    const positions = Array.isArray(body.positions)
      ? [...new Set(body.positions.map((p) => String(p || "").trim()).filter(Boolean))].slice(0, 12)
      : [];
    if (title.length < 2 || title.length > 120 || !items.length || items.some((item) => item.length > 240) || positions.some((p) => p.length > 60)) {
      return { ok: false, reason: "bad_checklist" };
    }
    db.run("INSERT INTO checklists (title, items, positions) VALUES (?, ?, ?)", [title, JSON.stringify(items), JSON.stringify(positions)]);
    const staff = db.all(`SELECT id, telegram_id, notifications_on, position FROM employees WHERE ${STAFF_FILTER}`)
      .filter((e) => targetsPosition(positions, e.position, false));
    await broadcast(staff, "Новый чек-лист", title,
      `✅ <b>Новый чек-лист</b>\n${sdk.escapeHtml(title)} · задач: ${items.length}`);
    return { ok: true };
  });

  sdk.miniapp.post("/checklists/toggle", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const body = ctx.body || {};
    const checklistId = Number(body.checklist_id);
    const itemIndex = Number(body.item_index);
    const checklist = db.get("SELECT items, positions FROM checklists WHERE id = ?", [checklistId]);
    if (!Number.isInteger(checklistId) || !Number.isInteger(itemIndex) || !checklist) return { ok: false, reason: "not_found" };
    if (!targetsPosition(positionsOf(checklist), emp.position, isManager(emp))) return { ok: false, reason: "not_found" };

    const items = itemsOf(checklist);
    if (itemIndex < 0 || itemIndex >= items.length) return { ok: false, reason: "not_found" };

    const date = today();
    const run = db.get(
      "SELECT id, done, log FROM checklist_runs WHERE checklist_id = ? AND employee_id = ? AND date = ? ORDER BY id DESC LIMIT 1",
      [checklistId, emp.id, date]
    );
    let done = parseJson(run ? run.done : "[]", []);
    done = [...new Set((Array.isArray(done) ? done : []).filter(Number.isInteger))];
    const log = parseJson(run ? run.log : "{}", {});
    const position = done.indexOf(itemIndex);
    if (position >= 0) { done.splice(position, 1); delete log[itemIndex]; }
    else { done.push(itemIndex); log[itemIndex] = time.timestamp().slice(11, 16); }
    done.sort((a, b) => a - b);

    if (run) db.run("UPDATE checklist_runs SET done = ?, log = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(done), JSON.stringify(log), run.id]);
    else db.run("INSERT INTO checklist_runs (checklist_id, employee_id, date, done, log) VALUES (?, ?, ?, ?, ?)", [checklistId, emp.id, date, JSON.stringify(done), JSON.stringify(log)]);
    return { ok: true, done, times: log };
  });

  sdk.miniapp.post("/checklists/delete", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const id = Number((ctx.body || {}).id);
    if (!Number.isInteger(id) || !db.get("SELECT id FROM checklists WHERE id = ?", [id])) return { ok: false, reason: "not_found" };
    db.transaction(() => {
      db.run("DELETE FROM checklist_runs WHERE checklist_id = ?", [id]);
      db.run("DELETE FROM checklists WHERE id = ?", [id]);
    });
    return { ok: true };
  });

  /** Who did what on a given day. */
  sdk.miniapp.get("/checklists/report", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const now = today();
    const requested = String((ctx.query || {}).date || now);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= now ? requested : now;

    const staff = db.all(`SELECT id, full_name AS name, position FROM employees WHERE ${STAFF_FILTER} ORDER BY full_name, id`);
    const lists = db.all(
      "SELECT id, title, items, positions FROM checklists WHERE substr(datetime(created_at, '+5 hours'), 1, 10) <= ? ORDER BY id DESC",
      [date]
    );
    const runs = db.all("SELECT checklist_id, employee_id, done, log, updated_at FROM checklist_runs WHERE date = ?", [date]);
    const runKey = new Map(runs.map((r) => [`${r.checklist_id}:${r.employee_id}`, r]));

    const checklists = lists.map((row) => {
      const items = itemsOf(row);
      const positions = positionsOf(row);
      const people = staff.filter((e) => targetsPosition(positions, e.position, false)).map((e) => {
        const run = runKey.get(`${row.id}:${e.id}`);
        const done = run ? parseJson(run.done, []).filter((i) => Number.isInteger(i) && i < items.length) : [];
        const times = run ? parseJson(run.log, {}) : {};
        return {
          id: e.id,
          name: e.name,
          position: e.position || "",
          done,
          times,
          complete: items.length > 0 && done.length >= items.length,
          last_at: run && run.updated_at ? String(run.updated_at) : null,
        };
      });
      return {
        id: row.id,
        title: row.title,
        items,
        positions,
        people,
        summary: {
          total: people.length,
          complete: people.filter((p) => p.complete).length,
          started: people.filter((p) => p.done.length > 0).length,
        },
      };
    });
    return { date, today: now, checklists };
  });
}

registerLearning.learningProgress = learningProgress;
module.exports = registerLearning;
