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
  { title: "Бармен", role: "waiter" },
  { title: "Тех персонал", role: "waiter" },
  { title: "Шеф-повар", role: "chef" },
  { title: "Бар-менеджер", role: "bar_manager" },
  { title: "Финансовый директор", role: "finance" },
  { title: "Менеджер", role: "manager" },
];

/** Positions a department head may schedule (and see). */
const DEPARTMENT = {
  chef: ["Повар"],
  bar_manager: ["Бариста", "Бармен"],
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
  roleForPosition, isOwner, isManager, isLead, isGlobal, canSeeMoney, canSeeAnalytics,
  editablePositions, visiblePositions, canEditPosition, canViewPosition, branchFilter, canAccessBranch,
};
