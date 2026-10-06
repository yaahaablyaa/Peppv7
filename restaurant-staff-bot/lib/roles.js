/**
 * Roles and permissions.
 *
 *   owner        – everything, all branches, sees money
 *   manager      – whole own branch; schedules everyone (incl. tech staff); staff, applications, content
 *   finance      – sees every schedule; edits cashiers; analytics across branches with money
 *   chef         – sees and edits schedule of cooks
 *   bar_manager  – sees and edits schedule of baristas and bartenders
 *   waiter       – regular staff (any other position)
 */

const LEAD_ROLES = ["owner", "manager", "finance", "chef", "bar_manager"];
const NON_TEAM_ROLES_SQL = "('manager', 'owner', 'chef', 'finance', 'bar_manager')";

/** Positions offered in the UI (no "Администратор"). */
const POSITIONS = [
  { title: "Официант", role: "waiter" },
  { title: "Хостес", role: "waiter" },
  { title: "Кассир", role: "waiter" },
  { title: "Повар", role: "waiter" },
  { title: "Бариста", role: "waiter" },
  { title: "Тех персонал", role: "waiter" },
  { title: "Шеф-повар", role: "chef" },
  { title: "Бар-менеджер", role: "bar_manager" },
  { title: "Финансовый директор", role: "finance" },
  { title: "Менеджер", role: "manager" },
];

/** Positions a department head may schedule (and see). */
const DEPARTMENT = {
  chef: ["Повар"],
  bar_manager: ["Бариста"],
  finance: ["Кассир"],
};

function roleForPosition(title) {
  const t = String(title || "").toLowerCase();
  if (/шеф/.test(t)) return "chef";
  if (/финанс/.test(t)) return "finance";
  if (/бар[\s-]*менеджер/.test(t)) return "bar_manager";
  if (/менеджер|управляющ/.test(t)) return "manager";
  return "waiter";
}

const isOwner = (e) => !!e && e.role === "owner";
const isManager = (e) => !!e && (e.role === "manager" || e.role === "owner");
const isLead = (e) => !!e && LEAD_ROLES.includes(e.role);
/** Sees all branches. */
const isGlobal = (e) => !!e && (e.role === "owner" || e.role === "finance");
const canSeeMoney = (e) => !!e && (e.role === "owner" || e.role === "finance");
const canSeeAnalytics = (e) => !!e && (e.role === "owner" || e.role === "manager" || e.role === "finance");

/** Positions whose schedule the person can edit; null = all. */
function editablePositions(e) {
  if (!e) return [];
  if (isManager(e)) return null;
  return DEPARTMENT[e.role] || [];
}

/** Positions whose schedule the person can see; null = all. */
function visiblePositions(e) {
  if (!e) return [];
  if (isManager(e) || e.role === "finance") return null;
  return DEPARTMENT[e.role] || [];
}

const canEditPosition = (e, position) => {
  const list = editablePositions(e);
  return list === null || list.includes(position || "");
};
const canViewPosition = (e, position) => {
  const list = visiblePositions(e);
  return list === null || list.includes(position || "");
};

/** Branch ids visible to the person; null = all. */
function branchFilter(e) {
  return isGlobal(e) ? null : [e.branch_id || 1];
}

const canAccessBranch = (e, branchId) => isGlobal(e) || (e.branch_id || 1) === branchId;

/** Inventory: departments and who may work with them. */
const INVENTORY_DEPARTMENTS = ["Кухня", "Бар", "Посуда", "Хозтовары"];
const INVENTORY_SCOPE = { chef: ["Кухня"], bar_manager: ["Бар"] };

/** Departments the person can edit / count; null = all. Finance only views. */
function inventoryEditDepartments(e) {
  if (!e) return [];
  if (isManager(e)) return null;
  return INVENTORY_SCOPE[e.role] || [];
}
/** Departments the person can see; null = all. */
function inventoryViewDepartments(e) {
  if (!e) return [];
  if (isManager(e) || e.role === "finance") return null;
  return INVENTORY_SCOPE[e.role] || [];
}
const canUseInventory = (e) => isLead(e);
const canSeeInventoryMoney = (e) => !!e && (e.role === "owner" || e.role === "manager" || e.role === "finance");
const canEditInventoryDept = (e, dept) => {
  const list = inventoryEditDepartments(e);
  return list === null || list.includes(dept);
};
const canViewInventoryDept = (e, dept) => {
  const list = inventoryViewDepartments(e);
  return list === null || list.includes(dept);
};

/** Departments (подразделения) of a branch, used to group people in lists. */
const POSITION_GROUPS = [
  { name: "Администрация", positions: ["Менеджер", "Финансовый директор"] },
  { name: "Кухня", positions: ["Шеф-повар", "Повар"] },
  { name: "Бар", positions: ["Бар-менеджер", "Бариста"] },
  { name: "Зал", positions: ["Официант", "Хостес"] },
  { name: "Касса", positions: ["Кассир"] },
  { name: "Тех персонал", positions: ["Тех персонал"] },
];
function groupOfPosition(position, role) {
  if (role === "owner") return "Администрация";
  const g = POSITION_GROUPS.find((x) => x.positions.includes(position || ""));
  return g ? g.name : "Другое";
}

/** Audience: empty list = everybody; managers and owner see everything. */
const inAudience = (e, positions) => !positions || !positions.length || isManager(e) || positions.includes(e.position || "");
function parsePositions(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch (error) { return []; }
}
const ALL_POSITIONS = POSITIONS.map((p) => p.title);
/** Clean audience coming from the client: only known positions, max 12. */
function cleanAudience(list) {
  return Array.isArray(list) ? [...new Set(list.map((x) => String(x || "").trim()).filter((x) => ALL_POSITIONS.includes(x)))].slice(0, 12) : [];
}

const ROLE_TITLES = {
  owner: "Владелец",
  manager: "Менеджер",
  finance: "Финансовый директор",
  chef: "Шеф-повар",
  bar_manager: "Бар-менеджер",
  waiter: "Сотрудник",
};

module.exports = {
  LEAD_ROLES, NON_TEAM_ROLES_SQL, POSITIONS, DEPARTMENT, ROLE_TITLES,
  POSITION_GROUPS, groupOfPosition, inAudience, parsePositions, cleanAudience, ALL_POSITIONS,
  roleForPosition, isOwner, isManager, isLead, isGlobal, canSeeMoney, canSeeAnalytics,
  INVENTORY_DEPARTMENTS, inventoryEditDepartments, inventoryViewDepartments, canUseInventory, canSeeInventoryMoney,
  canEditInventoryDept, canViewInventoryDept,
  editablePositions, visiblePositions, canEditPosition, canViewPosition, branchFilter, canAccessBranch,
};
