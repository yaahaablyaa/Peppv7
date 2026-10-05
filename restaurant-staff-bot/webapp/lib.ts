/** Shared types, API client, formatting and icons. */

type Theme = "auto" | "light" | "dark";

interface Employee {
  id: number;
  name: string;
  role: string;
  phone: string;
  position: string;
  rate: number;
  theme: Theme;
  notifications_on: boolean;
  qr_code: string | null;
  branch_id?: number;
  role_title?: string;
  perms?: { manage: boolean; schedule: boolean; analytics: boolean; money: boolean; branches: boolean };
}

interface TodayInfo {
  date: string;
  is_day_off: boolean;
  has_shift: boolean;
  start_time: string | null;
  end_time: string | null;
  note: string;
  check_in: string | null;
  check_out: string | null;
  late_minutes: number;
}

interface Post {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
}

interface NotificationRow {
  id: number;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

interface HomeData {
  employee: Employee;
  today: TodayInfo;
  salary: {
    period_start: string;
    period_end: string;
    payout: string;
    hours: number;
    amount: number;
  };
  news: Post[];
  notifications: NotificationRow[];
  counts: { trainings: number; checklists: number; unread: number };
  progress?: {
    trainings: { done: number; total: number };
    checklists: { done: number; total: number; items_done: number; items_total: number };
  };
  manager_summary: {
    total: number;
    scheduled: number;
    on_shift: number;
    late: number;
    missing: number;
    day_off: number;
  } | null;
  error?: string;
}

interface AnnouncementsData {
  can_publish: boolean;
  announcements: Post[];
  error?: string;
}

interface AnnouncementResult {
  ok: boolean;
  reason?: string;
}

interface Checklist {
  id: number;
  title: string;
  items: string[];
  positions?: string[];
  done: number[];
  times?: Record<string, string>;
}

interface ChecklistsData {
  can_manage: boolean;
  date?: string;
  checklists: Checklist[];
  positions_available?: string[];
  error?: string;
}

interface ChecklistResult {
  ok: boolean;
  reason?: string;
  done?: number[];
}

interface Training {
  id: number;
  title: string;
  body: string;
  url: string;
  created_at: string;
  done?: boolean;
  completed_at?: string | null;
  completed?: number;
  total?: number;
}

interface TrainingsData {
  can_manage: boolean;
  trainings: Training[];
  progress?: { done: number; total: number };
  error?: string;
}

interface TrainingResult {
  ok: boolean;
  reason?: string;
}

interface ShiftRow {
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_day_off: number;
  note: string;
}

interface AttendanceRow {
  date: string;
  check_in: string | null;
  check_out: string | null;
  worked_minutes: number;
  late_minutes: number;
}

interface ScheduleData {
  month: string;
  shifts: ShiftRow[];
  attendance: AttendanceRow[];
  error?: string;
}

interface SalaryPeriod {
  start: string;
  end: string;
  payout: string | null;
  half: number;
  hours: number;
  amount: number;
  paid?: boolean;
}

interface SalaryData {
  rate: number;
  month: string;
  view: "p1" | "p2" | "full";
  current_month: string;
  current_half: "p1" | "p2";
  period: SalaryPeriod;
  periods: { p1: SalaryPeriod; p2: SalaryPeriod; full: { start: string; end: string; hours: number; amount: number } };
  shifts: AttendanceRow[];
  pending: {
    start: string;
    end: string;
    payout: string;
    hours: number;
    amount: number;
  } | null;
  error?: string;
}

interface StaffMember {
  id: number;
  name: string;
  phone: string;
  position: string;
  role: string;
  rate: number;
  active: boolean;
  qr_code: string | null;
  branch_id?: number;
  salary?: {
    period_start: string;
    period_end: string;
    payout: string;
    hours: number;
    amount: number;
  };
}

interface StaffMemberData {
  employee?: StaffMember;
  error?: string;
}

interface StaffUpdateResult {
  ok: boolean;
  reason?: string;
  employee?: StaffMember;
}

interface StaffData {
  manager_id: number;
  employees: StaffMember[];
  branches?: { id: number; name: string }[];
  positions?: string[];
  error?: string;
}

interface StaffCreateResult {
  ok: boolean;
  reason?: string;
  employee?: StaffMember;
  password?: string;
}

interface TeamScheduleData {
  start: string;
  end: string;
  scope?: "all" | "department";
  employees: Array<StaffMember & { can_edit?: boolean }>;
  shifts: Array<ShiftRow & { employee_id: number }>;
  error?: string;
}

interface TeamScheduleResult {
  ok: boolean;
  reason?: string;
  employees?: number;
}

const tg = window.Telegram.WebApp;

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Вне Telegram (обычный браузер) вход держится на подписанной сессии. */
const WEB_TOKEN_KEY = "staff_web_token";
function webToken(): string {
  try { return window.localStorage.getItem(WEB_TOKEN_KEY) || ""; } catch (e) { return ""; }
}
function setWebToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(WEB_TOKEN_KEY, token);
    else window.localStorage.removeItem(WEB_TOKEN_KEY);
  } catch (e) { /* ignore */ }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch("_api" + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: tg.initData ? "tma " + tg.initData : "web " + webToken(),
      ...(init && init.headers ? init.headers : {}),
    },
  });
  const json = (await res.json()) as { data?: T; error?: string };
  if (init && init.method && init.method.toUpperCase() !== "GET" && typeof invalidateTabs === "function") invalidateTabs();
  if (json && json.data !== undefined) return json.data;
  return json as unknown as T;
}

function money(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(n || 0)) + " сум";
}

function hoursText(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole} ч ${mins} мин` : `${whole} ч`;
}

function uzbekistanToday(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "2026-08-30" -> "30 августа" */
function humanDate(iso: string): string {
  const parts = iso.split("-");
  const d = parseInt(parts[2], 10);
  const m = parseInt(parts[1], 10) - 1;
  return `${d} ${MONTHS_GEN[m] || ""}`;
}

function shortTime(value: string | null): string {
  if (!value) return "—";
  const m = value.match(/(\d{2}:\d{2})/);
  return m ? m[1] : value;
}

function esc(s: string): string {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function haptic(style: "light" | "medium" | "success"): void {
  try {
    if (style === "success") {
      tg.HapticFeedback.notificationOccurred("success");
      return;
    }
    tg.HapticFeedback.impactOccurred(style);
  } catch (e) {
    /* older clients */
  }
}

const POSITION_LIST: string[] = ["Официант", "Хостес", "Кассир", "Повар", "Бариста", "Бармен", "Тех персонал", "Шеф-повар", "Бар-менеджер", "Финансовый директор", "Менеджер"];

const ICONS: Record<string, string> = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 4l9 6.5"/><path d="M5.5 9.5V20h13V9.5"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M13.5 13.5h3v3m4 0v4h-7v-3"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="3.5"/><path d="M3 10h18M16.5 14.5h1.5"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V11m5 9V5m5 15v-7m5 7V9M2 20h20"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15z"/><path d="M10 20.5h4"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5V20"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 9 17l10.5-10"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="3"/><path d="M7 9h7M7 13h10M7 16h6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.7 4-5.5 7.5-5.5s6.3 1.8 7.5 5.5"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h7l5 5V20.5H6z"/><path d="M13 3.5V9h5M9 13h6M9 16.5h4"/></svg>',
  exit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5H6.5v15H14"/><path d="M11 12h9m0 0-3-3m3 3-3 3"/></svg>',
  branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6M2.5 20h19"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
};

function icon(name: string): string {
  return ICONS[name] || "";
}

function cell(opts: {
  icon?: string;
  title: string;
  subtitle?: string;
  value?: string;
  tappable?: boolean;
  action?: string;
}): string {
  const cls = "cell" + (opts.tappable ? " cell--tappable" : "") + (opts.icon ? "" : " cell--plain");
  const attr = opts.action ? ` data-action="${opts.action}"` : "";
  return (
    `<div class="${cls}"${attr}>` +
    (opts.icon ? `<div class="cell-icon" data-i="${opts.icon}">${icon(opts.icon)}</div>` : "") +
    `<div class="cell-body"><div class="cell-title">${esc(opts.title)}</div>` +
    (opts.subtitle ? `<div class="cell-subtitle">${esc(opts.subtitle)}</div>` : "") +
    `</div>` +
    (opts.value ? `<div class="cell-value">${esc(opts.value)}</div>` : "") +
    (opts.tappable ? `<span class="chevron">${icon("chevron")}</span>` : "") +
    `</div>`
  );
}

function skeleton(blocks: number): string {
  let out = "";
  for (let i = 0; i < blocks; i++) out += '<div class="skeleton skeleton--block"></div>';
  return `<div class="screen">${out}</div>`;
}

function errorState(message: string): string {
  return (
    `<div class="screen"><div class="section"><div class="empty">${esc(message)}</div></div>` +
    `<button class="button button--secondary" data-action="retry">Повторить</button></div>`
  );
}
