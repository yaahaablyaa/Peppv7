/**
 * Staff management bot — waiters & managers.
 * Entry point: wires the database schema, the mini app API and the handlers.
 */

const schema = require("./lib/schema");
const registerApi = require("./lib/api");
const registerStart = require("./handlers/start");
const registerStaff = require("./handlers/staff");
const registerShifts = require("./handlers/shifts");

module.exports = function setup(bot, sdk) {
  const { db, log } = sdk;

  schema.init(db, log);

  registerStart(bot, sdk);
  registerStaff(bot, sdk);
  registerShifts(bot, sdk);
  registerApi(bot, sdk);

  sdk.miniapp.setMenuButton(bot, "Приложение");

  log.info("Staff bot ready");
};
