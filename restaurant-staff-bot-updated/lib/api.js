/**
 * Mini app API — employee self-service and manager-only staff actions.
 * Every handler resolves the employee from the platform-verified ctx.user.id,
 * never from the request body.
 */

const attendance = require("./attendance");
const registerAnalytics = require("./analytics");
const registerAnalyticsReport = require("./analytics-report");
const registerLearning = require("./learning");
const registerInventory = require("./inventory");
const { learningProgress } = registerLearning;
const employees = require("./employees");
const salary = require("./salary");
const shifts = require("./shifts");
const staff = require("./staff");
const roles = require("./roles");
const time = require("./time");

const NO_ACCESS = { error: "no_access" };
const { OWNER_TELEGRAM_ID } = require("./schema");

function today() {
  return time.today();
}

function publicEmployee(emp) {
  return {
    id: emp.id,
    name: emp.full_name,
    role: emp.role,
    phone: emp.phone,
    position: emp.position || roles.ROLE_TITLES[emp.role] || "Официант",
    rate: emp.hourly_rate,
    theme: emp.theme || "auto",
    notifications_on: !!emp.notifications_on,
    qr_code: emp.qr_code || null,
    branch_id: emp.branch_id || 1,
    role_title: roles.ROLE_TITLES[emp.role] || "Сотрудник",
    perms: {
      manage: roles.isManager(emp),
      schedule: roles.isLead(emp),
      analytics: roles.canSeeAnalytics(emp),
      money: roles.canSeeMoney(emp),
      branches: roles.isGlobal(emp),
      inventory: roles.canUseInventory(emp),
    },
  };
}

function publicStaffMember(emp) {
  const employee = publicEmployee(emp);
  return {
    id: employee.id,
    name: employee.name,
    phone: employee.phone,
    position: employee.position,
    role: employee.role,
    rate: employee.rate,
    active: !!emp.active,
    qr_code: employee.qr_code,
    branch_id: employee.branch_id || 1,
  };
}

function isManager(emp) {
  return emp && (emp.role === "manager" || emp.role === "owner");
}

function canViewTeamPayroll(emp) {
  return isManager(emp) && emp.telegram_id === OWNER_TELEGRAM_ID;
}

function jsonList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) { return []; }
}

function audienceMatches(emp, row) {
  const branches = jsonList(row.audience_branches).map(Number).filter(Number.isInteger);
  const positions = jsonList(row.audience_positions).map(String);
  const employees = jsonList(row.audience_employees).map(Number).filter(Number.isInteger);
  if (!branches.length && !positions.length && !employees.length) return true;
  if (employees.includes(emp.id)) return true;
  const branchOk = !branches.length || branches.includes(Number(emp.branch_id || 1));
  const positionOk = !positions.length || positions.includes(String(emp.position || ""));
  return branchOk && positionOk;
}

function audiencePayload(body) {
  const clean = (value, mapper, max) => Array.isArray(value) ? [...new Set(value.map(mapper).filter(Boolean))].slice(0, max) : [];
  return {
    branches: clean(body.audience_branches, (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }, 20),
    positions: clean(body.audience_positions, (v) => String(v || "").trim().slice(0, 60), 20),
    employees: clean(body.audience_employees, (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; }, 100),
  };
}

module.exports = function registerApi(bot, sdk) {
  const { db } = sdk;
  registerAnalytics(sdk);
  registerAnalyticsReport(sdk);

  const me = (ctx) => db.get(
    `SELECT employees.*, qr_codes.code AS qr_code
       FROM employees
       LEFT JOIN qr_codes ON qr_codes.employee_id = employees.id
      WHERE employees.telegram_id = ?`,
    [ctx.user.id]
  );

  sdk.miniapp.get("/me", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    return { employee: publicEmployee(emp) };
  });

  sdk.miniapp.post("/auth/login", async (ctx) => {
    const body = ctx.body || {};
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    if (!phone || !password) return { ok: false, reason: "missing" };

    const result = employees.login(sdk, db, ctx.user.id, ctx.user.username, phone, password);
    if (!result.ok) return result;
    sdk.log.info(`mini app login ok: employee ${result.employee.id}`);
    return { ok: true, employee: publicEmployee(result.employee) };
  });

  sdk.miniapp.post("/auth/logout", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    db.run("UPDATE employees SET telegram_id = NULL, username = '' WHERE id = ?", [emp.id]);
    sdk.log.info(`mini app logout: employee ${emp.id}`);
    return { ok: true };
  });

  sdk.miniapp.get("/home", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const date = today();

    const todayShift = db.get(
      "SELECT * FROM shifts WHERE employee_id = ? AND date = ?",
      [emp.id, date]
    );
    const openAttendance = db.get(
      `SELECT * FROM attendance
         WHERE employee_id = ? AND check_in IS NOT NULL AND check_out IS NULL
         ORDER BY id DESC LIMIT 1`,
      [emp.id]
    );
    const attendanceRow = openAttendance || db.get(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [emp.id, date]
    );
    const shift = openAttendance
      ? db.get("SELECT * FROM shifts WHERE employee_id = ? AND date = ?", [emp.id, openAttendance.date])
      : todayShift;
    const period = salary.currentPeriod();
    const earned = salary.earnings(db, emp.id, period.start, period.end, emp.hourly_rate);
    const summaryScope = roles.isLead(emp) ? roles.visiblePositions(emp) : [];
    const scopeBranches = roles.branchFilter(emp);
    const scopeSql =
      (scopeBranches ? ` AND employees.branch_id IN (${scopeBranches.map(() => "?").join(",")})` : "") +
      (summaryScope ? ` AND employees.position IN (${summaryScope.map(() => "?").join(",")})` : "");
    const scopeParams = [...(scopeBranches || []), ...(summaryScope || [])];
    const managerSummary = roles.isLead(emp)
      ? db.get(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN shifts.id IS NOT NULL AND shifts.is_day_off = 0 THEN 1 ELSE 0 END), 0) AS scheduled,
           COALESCE(SUM(CASE WHEN attendance.id IS NOT NULL AND attendance.check_out IS NULL THEN 1 ELSE 0 END), 0) AS on_shift,
           COALESCE(SUM(CASE WHEN attendance.id IS NOT NULL AND attendance.late_minutes > 0 THEN 1 ELSE 0 END), 0) AS late,
           COALESCE(SUM(CASE WHEN shifts.id IS NOT NULL AND shifts.is_day_off = 0 AND attendance.id IS NULL THEN 1 ELSE 0 END), 0) AS missing,
           COALESCE(SUM(CASE WHEN shifts.id IS NULL OR shifts.is_day_off = 1 THEN 1 ELSE 0 END), 0) AS day_off
           FROM employees
           LEFT JOIN shifts ON shifts.employee_id = employees.id AND shifts.date = ?
           LEFT JOIN attendance ON attendance.employee_id = employees.id AND attendance.date = ?
          WHERE employees.active = 1 AND employees.role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager')${scopeSql}`,
        [date, date, ...scopeParams]
      )
      : null;

    return {
      employee: publicEmployee(emp),
      today: {
        date,
        is_day_off: shift ? !!shift.is_day_off : !shift,
        has_shift: (!!shift && !shift.is_day_off) || !!openAttendance,
        start_time: shift ? shift.start_time : null,
        end_time: shift ? shift.end_time : null,
        note: shift ? shift.note : "",
        check_in: attendanceRow ? attendanceRow.check_in : null,
        check_out: attendanceRow ? attendanceRow.check_out : null,
        late_minutes: attendanceRow ? attendanceRow.late_minutes : 0,
      },
      salary: {
        period_start: period.start,
        period_end: period.end,
        payout: period.payout,
        hours: earned.hours,
        amount: earned.amount,
      },
      manager_summary: managerSummary,
      news: db.all(
        "SELECT id, kind, title, body, created_at, audience_branches, audience_positions, audience_employees FROM posts ORDER BY id DESC LIMIT 30"
      ).filter((post) => post.kind !== "announcement" || isManager(emp) || audienceMatches(emp, post)).slice(0, 5),
      notifications: db.all(
        `SELECT id, title, body, created_at, read_at FROM notifications
          WHERE employee_id = ? ORDER BY id DESC LIMIT 10`,
        [emp.id]
      ),
      progress: learningProgress(db, emp, date),
      inventory_low: registerInventory.lowStock(db, emp),
      counts: {
        trainings: db.all("SELECT id, audience_branches, audience_positions, audience_employees FROM trainings").filter((t) => audienceMatches(emp, t)).length,
        checklists: db.get("SELECT COUNT(*) AS c FROM checklists").c,
        unread: db.get(
          "SELECT COUNT(*) AS c FROM notifications WHERE employee_id = ? AND read_at IS NULL",
          [emp.id]
        ).c,
      },
    };
  });

  sdk.miniapp.post("/attendance/check-in", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    return attendance.checkIn(db, sdk, emp.id);
  });

  sdk.miniapp.post("/attendance/check-out", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    return attendance.checkOut(db, sdk, emp.id);
  });

  sdk.miniapp.get("/schedule", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const month = String(ctx.query.month || today().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) return { error: "bad_month" };

    const shifts = db.all(
      `SELECT date, start_time, end_time, is_day_off, note FROM shifts
        WHERE employee_id = ? AND date LIKE ? ORDER BY date ASC`,
      [emp.id, month + "%"]
    );
    const attendanceRows = db.all(
      `SELECT date, check_in, check_out, worked_minutes, late_minutes FROM attendance
        WHERE employee_id = ? AND date LIKE ?`,
      [emp.id, month + "%"]
    );
    return { month, shifts, attendance: attendanceRows };
  });

  sdk.miniapp.get("/salary", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const query = ctx.query || {};
    const now = today();
    const currentHalf = Number(now.slice(8, 10)) <= 15 ? "p1" : "p2";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.month || "")) ? String(query.month) : now.slice(0, 7);
    const view = ["p1", "p2", "full"].includes(query.view) ? query.view : (month === now.slice(0, 7) ? currentHalf : "p1");
    const periods = salary.monthPeriods(month);
    const range = salary.viewRange(month, view);
    const summarize = (r) => {
      const e = salary.earnings(db, emp.id, r.start, r.end, emp.hourly_rate);
      return { start: r.start, end: r.end, payout: r.payout || null, half: r.half, hours: e.hours, amount: e.amount, minutes: e.minutes, shifts: e.shifts };
    };
    const selected = summarize(range);
    const p1 = summarize(periods.p1);
    const p2 = summarize(periods.p2);
    const strip = ({ shifts, ...rest }) => rest;
    const prev = salary.previousPeriod();
    const prevEarned = salary.earnings(db, emp.id, prev.start, prev.end, emp.hourly_rate);
    const awaitingPayout = prevEarned.minutes > 0 && prev.payout > now;

    return {
      rate: emp.hourly_rate,
      month,
      view,
      current_month: now.slice(0, 7),
      current_half: currentHalf,
      period: { start: selected.start, end: selected.end, payout: selected.payout, half: selected.half, hours: selected.hours, amount: selected.amount },
      periods: {
        p1: { ...strip(p1), paid: p1.payout < now },
        p2: { ...strip(p2), paid: p2.payout < now },
        full: { start: periods.full.start, end: periods.full.end, hours: Math.round((p1.hours + p2.hours) * 100) / 100, amount: p1.amount + p2.amount },
      },
      shifts: selected.shifts,
      pending: awaitingPayout
        ? {
            start: prev.start,
            end: prev.end,
            payout: prev.payout,
            hours: prevEarned.hours,
            amount: prevEarned.amount,
          }
        : null,
    };
  });

  sdk.miniapp.get("/staff", async (ctx) => {
    const emp = me(ctx);
    if (!isManager(emp)) return NO_ACCESS;
    const branches = roles.branchFilter(emp);
    const team = db.all(
      `SELECT employees.*, qr_codes.code AS qr_code
         FROM employees
         LEFT JOIN qr_codes ON qr_codes.employee_id = employees.id
        ${branches ? "WHERE employees.branch_id IN (" + branches.map(() => "?").join(",") + ")" : ""}
         ORDER BY employees.active DESC, employees.role DESC, employees.full_name ASC`,
      branches || []
    );
    return {
      manager_id: emp.id,
      employees: team.map((row) => ({ ...publicStaffMember(row), branch_id: row.branch_id })),
      branches: db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id")
        .filter((b) => roles.canAccessBranch(emp, b.id)),
      positions: roles.POSITIONS.map((p) => p.title),
    };
  });

  sdk.miniapp.get("/staff/member", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const employeeId = Number((ctx.query || {}).id);
    if (!Number.isInteger(employeeId)) return { error: "not_found" };
    const employee = db.get(
      `SELECT employees.*, qr_codes.code AS qr_code
         FROM employees
         LEFT JOIN qr_codes ON qr_codes.employee_id = employees.id
        WHERE employees.id = ?`,
      [employeeId]
    );
    if (!employee || !roles.canAccessBranch(manager, employee.branch_id)) return { error: "not_found" };
    const member = publicStaffMember(employee);
    if (canViewTeamPayroll(manager)) {
      const period = salary.currentPeriod();
      const earned = salary.earnings(db, employee.id, period.start, period.end, employee.hourly_rate);
      member.salary = {
        period_start: period.start,
        period_end: period.end,
        payout: period.payout,
        hours: earned.hours,
        amount: earned.amount,
      };
    }
    return {
      employee: member,
      branches: roles.isGlobal(manager) ? db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id") : [],
    };
  });

  sdk.miniapp.post("/staff/update", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;

    const body = ctx.body || {};
    const employeeId = Number(body.employee_id);
    const target = staff.byId(db, employeeId);
    if (!Number.isInteger(employeeId) || !target || target.role === "owner" || !roles.canAccessBranch(manager, target.branch_id)) return { ok: false, reason: "not_found" };
    if (!roles.isOwner(manager) && (target.role === "finance" || roles.roleForPosition(String(body.position || "")) === "finance")) return { ok: false, reason: "owner_only" };

    const fullName = String(body.full_name || "").trim().replace(/\s+/g, " ");
    const position = String(body.position || "").trim().slice(0, 60);
    const active = body.active === true || body.active === 1;
    let branchId = target.branch_id || 1;
    if (roles.isGlobal(manager) && body.branch_id !== undefined) {
      const wanted = Number(body.branch_id);
      if (!db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [wanted])) return { ok: false, reason: "bad_branch" };
      branchId = wanted;
    } else if (!roles.isGlobal(manager) && body.branch_id !== undefined && Number(body.branch_id) !== branchId) {
      return { ok: false, reason: "bad_branch" };
    }
    const nextRole = staff.roleForPosition(position);
    if ((!active && employeeId === manager.id) ||
        (target.role === "manager" && (nextRole !== "manager" || !active) &&
          db.get("SELECT COUNT(*) AS count FROM employees WHERE role = 'manager' AND active = 1").count < 2)) {
      return { ok: false, reason: "last_manager" };
    }

    const qrImage = String(body.qr_image || "");
    if (qrImage && (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(qrImage) || qrImage.length > 2000000)) {
      return { ok: false, reason: "bad_qr" };
    }
    const result = staff.update(sdk, db, employeeId, {
      full_name: fullName,
      phone: String(body.phone || ""),
      position,
      rate: body.rate,
      password: String(body.password || ""),
      active,
      branch_id: branchId,
    });
    if (!result.ok) return result;
    if (qrImage) staff.saveQrCode(db, employeeId, qrImage);
    const updated = db.get(
      `SELECT employees.*, qr_codes.code AS qr_code
         FROM employees
         LEFT JOIN qr_codes ON qr_codes.employee_id = employees.id
        WHERE employees.id = ?`,
      [employeeId]
    );
    return { ok: true, employee: publicStaffMember(updated) };
  });

  sdk.miniapp.post("/staff/qr/remove", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const employeeId = Number((ctx.body || {}).employee_id);
    if (!Number.isInteger(employeeId) || !staff.byId(db, employeeId)) return { ok: false, reason: "not_found" };
    db.run("DELETE FROM qr_codes WHERE employee_id = ?", [employeeId]);
    return { ok: true };
  });

  sdk.miniapp.post("/staff", async (ctx) => {
    const emp = me(ctx);
    if (!isManager(emp)) return NO_ACCESS;

    const body = ctx.body || {};
    const fullName = String(body.full_name || "").trim().replace(/\s+/g, " ");
    const position = String(body.position || "Официант").trim().slice(0, 60);
    if (fullName.length < 2 || fullName.length > 100) return { ok: false, reason: "bad_name" };

    if (!roles.isOwner(emp) && roles.roleForPosition(position) === "finance") return { ok: false, reason: "owner_only" };
    // Role is deliberately derived on the server; a submitted role is never trusted.
    const password = String(body.password || "");
    const rate = body.rate;
    const qrImage = String(body.qr_image || "");
    if (password.length < 4 || password.length > 64) return { ok: false, reason: "bad_password" };
    if (!staff.validRate(rate)) return { ok: false, reason: "bad_pay" };
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(qrImage) || qrImage.length > 2000000) return { ok: false, reason: "bad_qr" };
    let branchId = emp.branch_id || 1;
    if (roles.isGlobal(emp) && body.branch_id !== undefined) {
      const wanted = Number(body.branch_id);
      if (!db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [wanted])) return { ok: false, reason: "bad_branch" };
      branchId = wanted;
    }
    const created = staff.create(sdk, db, { full_name: fullName, phone: String(body.phone || ""), position: position || "Официант", password, rate, branch_id: branchId });
    if (!created.ok) return created;
    staff.saveQrCode(db, created.employee.id, qrImage);
    return { ok: true, employee: publicStaffMember(created.employee) };
  });

  sdk.miniapp.get("/branches", async (ctx) => {
    const emp = me(ctx);
    if (!roles.isLead(emp)) return NO_ACCESS;
    const rows = db.all("SELECT id, name, address FROM branches WHERE is_active = 1 ORDER BY id").filter((b) => roles.canAccessBranch(emp, b.id));
    return {
      can_manage: roles.isGlobal(emp),
      branches: rows.map((b) => ({
        ...b,
        staff: db.get("SELECT COUNT(*) AS c FROM employees WHERE branch_id = ? AND active = 1 AND role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager')", [b.id]).c,
      })),
    };
  });

  sdk.miniapp.get("/branches/detail", async (ctx) => {
    const emp = me(ctx);
    if (!roles.isLead(emp)) return NO_ACCESS;
    const id = Number((ctx.query || {}).id);
    const branch = db.get("SELECT id, name, address FROM branches WHERE id = ? AND is_active = 1", [id]);
    if (!branch || !roles.canAccessBranch(emp, id)) return { error: "not_found" };
    const employees = db.all("SELECT id, full_name, position, role, active, phone FROM employees WHERE branch_id = ? ORDER BY active DESC, position, full_name", [id]);
    return { branch, employees: employees.map((e) => ({ id: e.id, name: e.full_name, position: e.position, role: e.role, active: !!e.active, phone: e.phone })) };
  });

  sdk.miniapp.post("/branches", async (ctx) => {
    const emp = me(ctx);
    if (!roles.isGlobal(emp)) return NO_ACCESS;
    const body = ctx.body || {};
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const address = String(body.address || "").trim().slice(0, 200);
    if (name.length < 2 || name.length > 80) return { ok: false, reason: "bad_name" };
    if (db.get("SELECT id FROM branches WHERE lower(name) = lower(?) AND is_active = 1", [name])) return { ok: false, reason: "duplicate" };
    const next = db.get("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM branches").id;
    db.run("INSERT INTO branches (id, organization_id, name, code, address) VALUES (?, 1, ?, ?, ?)", [next, name, "B" + next, address]);
    return { ok: true, id: next };
  });

  sdk.miniapp.post("/branches/update", async (ctx) => {
    const emp = me(ctx);
    if (!roles.isGlobal(emp)) return NO_ACCESS;
    const body = ctx.body || {};
    const id = Number(body.id);
    const name = String(body.name || "").trim().replace(/\s+/g, " ");
    const address = String(body.address || "").trim().slice(0, 200);
    if (!Number.isInteger(id) || name.length < 2 || name.length > 80) return { ok: false, reason: "bad_data" };
    if (!db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [id])) return { ok: false, reason: "not_found" };
    if (db.get("SELECT id FROM branches WHERE lower(name) = lower(?) AND id != ? AND is_active = 1", [name, id])) return { ok: false, reason: "duplicate" };
    db.run("UPDATE branches SET name = ?, address = ?, updated_at = datetime('now') WHERE id = ?", [name, address, id]);
    return { ok: true };
  });

  sdk.miniapp.post("/staff/dismiss", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const employeeId = Number((ctx.body || {}).employee_id);
    const employee = staff.byId(db, employeeId);
    if (!Number.isInteger(employeeId) || !employee || employee.role === "owner" || !roles.canAccessBranch(manager, employee.branch_id)) return { ok: false, reason: "not_found" };
    if (employee.role === "finance" && !roles.isOwner(manager)) return { ok: false, reason: "owner_only" };
    if (employeeId === manager.id) return { ok: false, reason: "self" };
    if (employee.role === "manager" && db.get("SELECT COUNT(*) AS count FROM employees WHERE role = 'manager' AND active = 1").count < 2) {
      return { ok: false, reason: "last_manager" };
    }
    db.run("UPDATE employees SET active = 0 WHERE id = ?", [employeeId]);
    return { ok: true };
  });

  sdk.miniapp.post("/staff/remove", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;

    const employeeId = Number((ctx.body || {}).employee_id);
    if (!Number.isInteger(employeeId) || employeeId === manager.id) return { ok: false, reason: "self" };

    const employee = db.get("SELECT id, role, branch_id FROM employees WHERE id = ?", [employeeId]);
    if (!employee || employee.role === "owner" || !roles.canAccessBranch(manager, employee.branch_id)) return { ok: false, reason: "not_found" };
    if (employee.role === "finance" && !roles.isOwner(manager)) return { ok: false, reason: "owner_only" };
    if (employee.role === "manager" && db.get("SELECT COUNT(*) AS count FROM employees WHERE role = 'manager'").count < 2) {
      return { ok: false, reason: "last_manager" };
    }

    db.transaction(() => {
      ["applications", "attendance", "checklist_runs", "training_progress", "notifications", "qr_codes", "shifts"].forEach((table) => {
        db.run(`DELETE FROM ${table} WHERE employee_id = ?`, [employeeId]);
      });
      db.run("DELETE FROM employees WHERE id = ?", [employeeId]);
    });

    return { ok: true };
  });

  sdk.miniapp.post("/schedule/team", async (ctx) => {
    const manager = me(ctx);
    if (!roles.isLead(manager)) return NO_ACCESS;

    const body = ctx.body || {};
    const weekStart = String(body.week_start || "");
    const start = String(body.start_time || "");
    const end = String(body.end_time || "");
    const weekdays = Array.isArray(body.weekdays) ? body.weekdays : [];
    const selectedDays = [...new Set(weekdays.map(Number))]
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
      .sort((a, b) => a - b);
    const startDate = new Date(`${weekStart}T00:00:00.000Z`);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) ||
      startDate.toISOString().slice(0, 10) !== weekStart ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
      !selectedDays.length
    ) {
      return { ok: false, reason: "bad_schedule" };
    }

    const dates = selectedDays.map((day) => {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + day);
      return date.toISOString().slice(0, 10);
    });
    const team = staff.list(db).filter((e) => e.id !== manager.id && e.role !== "owner" && roles.canAccessBranch(manager, e.branch_id) && roles.canEditPosition(manager, e.position));
    if (!team.length) return { ok: false, reason: "no_staff" };

    db.transaction(() => {
      team.forEach((employee) => {
        dates.forEach((date) => shifts.setShift(db, employee.id, date, start, end));
        db.run(
          "INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)",
          [
            employee.id,
            "График обновлён",
            `Вам назначены смены ${dates.map((date) => shifts.labelDate(sdk, date)).join(", ")}: ${start}–${end}.`,
          ]
        );
      });
    });

    const message = `Смены ${dates.map((date) => shifts.labelDate(sdk, date)).join(", ")}: ${start}–${end}.`;
    await Promise.all(
      team
        .filter((employee) => employee.telegram_id && employee.notifications_on)
        .map(async (employee) => {
          try {
            await bot.api.sendMessage(
              employee.telegram_id,
              `🗓 <b>График обновлён</b>\n${sdk.escapeHtml(message)}`,
              { parse_mode: "HTML" }
            );
          } catch (error) {
            sdk.log.warn(`team schedule notify failed for employee ${employee.id}: ${error.message}`);
          }
        })
    );

    return { ok: true, employees: team.length, shifts: team.length * dates.length };
  });

  sdk.miniapp.get("/schedule/team", async (ctx) => {
    const manager = me(ctx);
    if (!roles.isLead(manager)) return NO_ACCESS;

    const requestedStart = String(ctx.query.start || today());
    const requestedDate = new Date(`${requestedStart}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStart) || requestedDate.toISOString().slice(0, 10) !== requestedStart) {
      return { error: "bad_date" };
    }

    const year = requestedDate.getUTCFullYear();
    const month = requestedDate.getUTCMonth();
    const startDate = new Date(Date.UTC(year, month, requestedDate.getUTCDate() <= 15 ? 1 : 16));
    const endDate = requestedDate.getUTCDate() <= 15
      ? new Date(Date.UTC(year, month, 15))
      : new Date(Date.UTC(year, month + 1, 0));
    const start = startDate.toISOString().slice(0, 10);
    const end = endDate.toISOString().slice(0, 10);

    const visible = staff.list(db).filter((e) => (e.id === manager.id || roles.canAccessBranch(manager, e.branch_id)) && (e.id === manager.id || roles.canViewPosition(manager, e.position)));
    const ids = new Set(visible.map((e) => e.id));
    return {
      start,
      end,
      scope: roles.visiblePositions(manager) === null ? "all" : "department",
      employees: visible.map((e) => ({ ...publicStaffMember(e), can_edit: e.id !== manager.id && roles.canEditPosition(manager, e.position) && (e.role !== "owner" || roles.isOwner(manager)) })),
      branches: db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id").filter((b) => roles.canAccessBranch(manager, b.id)),
      shifts: db.all(
        `SELECT employee_id, date, start_time, end_time, is_day_off, note FROM shifts
         WHERE date >= ? AND date <= ? ORDER BY employee_id, date`,
        [start, end]
      ).filter((row) => ids.has(row.employee_id)),
    };
  });

  sdk.miniapp.post("/schedule/team/cell", async (ctx) => {
    const manager = me(ctx);
    if (!roles.isLead(manager)) return NO_ACCESS;
    const body = ctx.body || {};
    const employeeId = Number(body.employee_id);
    const date = String(body.date || "");
    const kind = String(body.kind || "");
    const start = String(body.start_time || "");
    const end = String(body.end_time || "");
    const employee = staff.list(db).find((item) => item.id === employeeId);
    if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: "bad_schedule" };
    if (employee.id === manager.id || !roles.canAccessBranch(manager, employee.branch_id) || !roles.canEditPosition(manager, employee.position) || (employee.role === "owner" && !roles.isOwner(manager))) {
      return { ok: false, reason: "forbidden" };
    }
    if (kind === "day_off") shifts.setDayOff(db, employeeId, date);
    else if (kind === "shift" && /^([01]\d|2[0-3]):[0-5]\d$/.test(start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end)) shifts.setShift(db, employeeId, date, start, end);
    else return { ok: false, reason: "bad_schedule" };
    db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [employeeId, "График обновлён", kind === "day_off" ? `На ${date} назначен выходной.` : `На ${date} назначена смена ${start}–${end}.`]);
    if (employee.telegram_id && employee.notifications_on) {
      try { await bot.api.sendMessage(employee.telegram_id, kind === "day_off" ? `🗓 <b>График обновлён</b>\nНа ${date} назначен выходной.` : `🗓 <b>График обновлён</b>\nНа ${date} назначена смена ${start}–${end}.`, { parse_mode: "HTML" }); } catch (error) { sdk.log.warn(`schedule notify failed for employee ${employeeId}: ${error.message}`); }
    }
    return { ok: true };
  });

  sdk.miniapp.get("/announcements", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const rows = db.all("SELECT id, title, body, created_at, audience_branches, audience_positions, audience_employees FROM posts WHERE kind = 'announcement' ORDER BY id DESC LIMIT 100");
    return {
      can_publish: isManager(emp),
      announcements: rows.filter((p) => isManager(emp) || audienceMatches(emp, p)).map((p) => ({
        id: p.id, title: p.title, body: p.body, created_at: p.created_at,
        audience_branches: jsonList(p.audience_branches), audience_positions: jsonList(p.audience_positions), audience_employees: jsonList(p.audience_employees),
      })),
      audience: isManager(emp) ? {
        branches: db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id").filter((b) => roles.canAccessBranch(emp, b.id)),
        positions: roles.POSITIONS.map((p) => p.title),
        employees: db.all("SELECT id, full_name AS name, position, branch_id FROM employees WHERE active = 1 AND role NOT IN ('owner') ORDER BY full_name"),
      } : null,
    };
  });

  sdk.miniapp.post("/announcements", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const body = ctx.body || {};
    const title = String(body.title || "").trim().replace(/\s+/g, " ");
    const text = String(body.body || "").trim();
    if (title.length < 2 || title.length > 120 || text.length < 2 || text.length > 2000) return { ok: false, reason: "bad_announcement" };
    const audience = audiencePayload(body);
    audience.branches = audience.branches.filter((id) => roles.canAccessBranch(manager, id));
    audience.employees = audience.employees.filter((id) => { const e = staff.byId(db, id); return e && e.active && roles.canAccessBranch(manager, e.branch_id); });
    const allStaff = db.all("SELECT id, telegram_id, notifications_on, branch_id, position, active FROM employees WHERE active = 1");
    const recipients = allStaff.filter((e) => roles.isGlobal(manager) ? audienceMatches(e, { audience_branches: JSON.stringify(audience.branches), audience_positions: JSON.stringify(audience.positions), audience_employees: JSON.stringify(audience.employees) }) : roles.canAccessBranch(manager, e.branch_id) && audienceMatches(e, { audience_branches: JSON.stringify(audience.branches), audience_positions: JSON.stringify(audience.positions), audience_employees: JSON.stringify(audience.employees) }));
    db.transaction(() => {
      db.run("INSERT INTO posts (kind, title, body, branch_id, audience_branches, audience_positions, audience_employees) VALUES ('announcement', ?, ?, ?, ?, ?, ?)", [title, text, manager.branch_id || 1, JSON.stringify(audience.branches), JSON.stringify(audience.positions), JSON.stringify(audience.employees)]);
      recipients.forEach((employee) => db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [employee.id, "Новое объявление", title]));
    });
    await Promise.all(recipients.filter((e) => e.telegram_id && e.notifications_on).map(async (employee) => {
      try { await bot.api.sendMessage(employee.telegram_id, `📢 <b>${sdk.escapeHtml(title)}</b>\n${sdk.escapeHtml(text)}`, { parse_mode: "HTML" }); }
      catch (error) { sdk.log.warn(`announcement notify failed for employee ${employee.id}: ${error.message}`); }
    }));
    return { ok: true };
  });

  sdk.miniapp.get("/manuals", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const rows = db.all("SELECT id, branch_id, title, file_name, mime, created_at FROM menu_files ORDER BY id DESC LIMIT 100");
    return {
      can_manage: isManager(emp),
      files: rows.filter((f) => roles.isGlobal(emp) || f.branch_id === (emp.branch_id || 1)).map((f) => ({ ...f })),
      branches: isManager(emp) ? db.all("SELECT id, name FROM branches WHERE is_active = 1 ORDER BY id").filter((b) => roles.canAccessBranch(emp, b.id)) : [],
    };
  });

  sdk.miniapp.get("/manuals/file", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const id = Number((ctx.query || {}).id);
    const row = db.get("SELECT id, branch_id, title, file_name, mime, data FROM menu_files WHERE id = ?", [id]);
    if (!row || (!roles.isGlobal(emp) && row.branch_id !== (emp.branch_id || 1))) return NO_ACCESS;
    return { ok: true, ...row };
  });

  sdk.miniapp.post("/manuals", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const body = ctx.body || {};
    const title = String(body.title || "").trim().slice(0, 120);
    const fileName = String(body.file_name || "").trim().slice(0, 160);
    const mime = String(body.mime || "application/octet-stream").slice(0, 120);
    const data = String(body.data || "");
    const branchId = roles.isGlobal(manager) && body.branch_id !== undefined ? Number(body.branch_id) : (manager.branch_id || 1);
    if (title.length < 2 || fileName.length < 1 || data.length < 1 || data.length > 8500000) return { ok: false, reason: "bad_file" };
    if (!db.get("SELECT id FROM branches WHERE id = ? AND is_active = 1", [branchId]) || !roles.canAccessBranch(manager, branchId)) return { ok: false, reason: "bad_branch" };
    if (!/^data:(application\/pdf|image\/(png|jpeg|webp)|application\/vnd.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword);base64,/.test(data)) return { ok: false, reason: "bad_file" };
    db.run("INSERT INTO menu_files (branch_id, title, file_name, mime, data) VALUES (?, ?, ?, ?, ?)", [branchId, title, fileName, mime, data]);
    return { ok: true };
  });

  sdk.miniapp.post("/manuals/delete", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const id = Number((ctx.body || {}).id);
    const row = db.get("SELECT id, branch_id FROM menu_files WHERE id = ?", [id]);
    if (!row || !roles.canAccessBranch(manager, row.branch_id)) return { ok: false, reason: "not_found" };
    db.run("DELETE FROM menu_files WHERE id = ?", [id]);
    return { ok: true };
  });

  registerLearning(bot, sdk, { me, isManager, today, NO_ACCESS });
  registerInventory(bot, sdk, { me, NO_ACCESS });

  sdk.miniapp.get("/applications", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const select = `SELECT applications.id, applications.kind, applications.body, applications.status, applications.created_at,
                           employees.full_name AS employee_name
                      FROM applications
                      JOIN employees ON employees.id = applications.employee_id`;
    return {
      can_manage: isManager(emp),
      mine: isManager(emp)
        ? []
        : db.all(`${select} WHERE applications.employee_id = ? ORDER BY applications.id DESC LIMIT 50`, [emp.id]),
      team: isManager(emp)
        ? db.all(`${select} WHERE employees.role NOT IN ('manager', 'owner', 'chef', 'finance', 'bar_manager') ORDER BY CASE applications.status WHEN 'pending' THEN 0 ELSE 1 END, applications.id DESC LIMIT 100`)
        : [],
    };
  });

  sdk.miniapp.post("/applications", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    if (isManager(emp)) return { ok: false, reason: "managers_review_only" };
    const body = ctx.body || {};
    const kind = String(body.kind || "other");
    const text = String(body.body || "").trim();
    const kinds = {
      leave: "Отгул или выходной",
      schedule: "Изменение графика",
      payroll: "Вопрос по зарплате",
      other: "Другое",
    };
    if (!Object.prototype.hasOwnProperty.call(kinds, kind) || text.length < 3 || text.length > 2000) {
      return { ok: false, reason: "bad_application" };
    }

    db.transaction(() => {
      db.run("INSERT INTO applications (employee_id, kind, body) VALUES (?, ?, ?)", [emp.id, kind, text]);
      db.all("SELECT id FROM employees WHERE active = 1 AND role IN ('manager', 'owner') AND id != ?", [emp.id]).forEach((manager) => {
        db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [manager.id, "Новое заявление", `${emp.full_name}: ${kinds[kind]}`]);
      });
    });

    await Promise.all(
      db.all("SELECT id, telegram_id FROM employees WHERE active = 1 AND role IN ('manager', 'owner') AND id != ? AND telegram_id IS NOT NULL AND notifications_on = 1", [emp.id])
        .map(async (manager) => {
          try {
            await bot.api.sendMessage(manager.telegram_id, `📄 <b>Новое заявление</b>\n${sdk.escapeHtml(emp.full_name)}: ${kinds[kind]}`, { parse_mode: "HTML" });
          } catch (error) {
            sdk.log.warn(`application notify failed for manager ${manager.id}: ${error.message}`);
          }
        })
    );
    return { ok: true };
  });

  sdk.miniapp.post("/applications/status", async (ctx) => {
    const manager = me(ctx);
    if (!isManager(manager)) return NO_ACCESS;
    const body = ctx.body || {};
    const id = Number(body.id);
    const status = String(body.status || "");
    if (!Number.isInteger(id) || (status !== "approved" && status !== "rejected")) return { ok: false, reason: "bad_status" };

    const application = db.get(
      `SELECT applications.*, employees.full_name, employees.role AS employee_role, employees.telegram_id, employees.notifications_on
         FROM applications JOIN employees ON employees.id = applications.employee_id
        WHERE applications.id = ?`,
      [id]
    );
    if (!application) return { ok: false, reason: "not_found" };
    if (["manager", "owner"].includes(application.employee_role)) return { ok: false, reason: "manager_application" };
    if (application.status !== "pending") return { ok: false, reason: "already_processed" };

    const statusTitle = status === "approved" ? "Заявление одобрено" : "Заявление отклонено";
    db.transaction(() => {
      db.run("UPDATE applications SET status = ? WHERE id = ?", [status, id]);
      db.run("INSERT INTO notifications (employee_id, title, body) VALUES (?, ?, ?)", [application.employee_id, statusTitle, application.body]);
    });
    if (application.telegram_id && application.notifications_on) {
      try {
        await bot.api.sendMessage(application.telegram_id, `📄 <b>${statusTitle}</b>\n${sdk.escapeHtml(application.body)}`, { parse_mode: "HTML" });
      } catch (error) {
        sdk.log.warn(`application status notify failed for employee ${application.employee_id}: ${error.message}`);
      }
    }
    return { ok: true };
  });

  sdk.miniapp.post("/settings/theme", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const theme = String((ctx.body || {}).theme || "");
    if (!["auto", "light", "dark"].includes(theme)) return { ok: false };
    db.run("UPDATE employees SET theme = ? WHERE id = ?", [theme, emp.id]);
    return { ok: true };
  });

  sdk.miniapp.post("/settings/notifications", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    const notificationsOn = !!(ctx.body || {}).notifications_on;
    db.run("UPDATE employees SET notifications_on = ? WHERE id = ?", [notificationsOn ? 1 : 0, emp.id]);
    return { ok: true, notifications_on: notificationsOn };
  });

  sdk.miniapp.post("/notifications/read", async (ctx) => {
    const emp = me(ctx);
    if (!emp) return NO_ACCESS;
    db.run(
      "UPDATE notifications SET read_at = datetime('now') WHERE employee_id = ? AND read_at IS NULL",
      [emp.id]
    );
    return { ok: true };
  });
};
