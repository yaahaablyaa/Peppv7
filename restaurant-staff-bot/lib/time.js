/** Uzbekistan business time (UTC+5), independent of the server's clock zone. */

const UZBEKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000;

function shiftedNow() {
  return new Date(Date.now() + UZBEKISTAN_OFFSET_MS);
}

function today() {
  return shiftedNow().toISOString().slice(0, 10);
}

function timestamp() {
  return shiftedNow().toISOString().slice(0, 19).replace("T", " ");
}

function addDays(iso, amount) {
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount));
  return date.toISOString().slice(0, 10);
}

function weekday(iso) {
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

module.exports = { today, timestamp, addDays, weekday };
