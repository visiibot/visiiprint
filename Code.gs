/**
 * Visii Print — 3D printer sign-up backend (Google Apps Script, bound to a Google Sheet)
 * Tabs: Students (Name, PIN, Total, FailCount, LockUntil) | Signups (Week, Day, Printer, Name, At) | Config (Key, Value)
 * FIRST TIME (or after updating this file): run setup() once. Then Deploy > Manage deployments > pencil > New version.
 */
var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
var PRINTERS = ['Gooper', 'Squirt'];
var DEFAULT_CAP = 2; // students who can share one printer on one afternoon
var START_NAMES = ['Avi','Rana','Aidan','Seren','David','Elin','Amelia','Nova','Anaya','Daniel',
  'Taya','Jacxson','Darien','Mae-Lou','Benny','Leith','Ronan','Sol','Elliott','Charlie'];

function setup() {
  var st = tab_('Students', ['Name', 'PIN', 'Total', 'FailCount', 'LockUntil']);
  st.getRange('B:B').setNumberFormat('@');
  var su = tab_('Signups', ['Week', 'Day', 'Printer', 'Name', 'At']);
  su.getRange('A:A').setNumberFormat('@');
  var h = su.getRange(1, 1, 1, su.getLastColumn()).getValues()[0];
  if (h.indexOf('Printer') < 0) { // upgrade from the one-printer version
    su.insertColumnAfter(2);
    su.getRange(1, 3).setValue('Printer');
    if (su.getLastRow() > 1) su.getRange(2, 3, su.getLastRow() - 1, 1).setValue(PRINTERS[0]);
  }
  tab_('Config', ['Key', 'Value']);
  if (st.getLastRow() < 2) START_NAMES.forEach(function (n) { st.appendRow([n, randPin_(), 0, 0, '']); });
}

function doPost(e) {
  var out, lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var req = JSON.parse(e.postData.contents);
    var fn = ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action');
    out = { ok: true, data: fn(req) };
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

var ACTIONS = {
  getSchedule: function (r) { return schedule_(r.week); },
  login: function (r) { student_(r.name, r.pin); return schedule_(); },
  signup: function (r) {
    var s = student_(r.name, r.pin), day = day_(r.day), pr = printer_(r.printer);
    var slot = schedule_().days.filter(function (x) { return x.day === day; })[0].printers
      .filter(function (p) { return p.printer === pr; })[0];
    var mine = mySignup_(s.Name);
    if (mine && mine.Day === day && mine.Printer === pr) throw new Error('You are already signed up for ' + pr + ' on ' + day + '.');
    if (slot.cap <= 0) throw new Error(pr + ' is closed on ' + day + '.');
    if (slot.names.length >= slot.cap) throw new Error(pr + ' is full on ' + day + '. Try another slot!');
    place_(s, day, pr, mine);
    return schedule_();
  },
  cancel: function (r) { remove_(student_(r.name, r.pin)); return schedule_(); },

  // ---- teacher ----
  teacherStatus: function () { return { hasPass: !!cfg_('TeacherPass') }; },
  teacherSetup: function (r) {
    if (cfg_('TeacherPass')) throw new Error('Passphrase already set.');
    if (!r.pass || String(r.pass).length < 3) throw new Error('Passphrase needs 3+ characters.');
    setCfg_('TeacherPass', r.pass);
    return teacherData_();
  },
  teacherLogin: function (r) { teacher_(r); return teacherData_(); },
  teacherSetCap: function (r) {
    teacher_(r);
    var n = Number(r.cap);
    if (!(n >= 0 && n <= 20)) throw new Error('Spots must be 0-20 (0 = closed).');
    setCfg_('Cap_' + day_(r.day) + '_' + printer_(r.printer), n);
    return teacherData_();
  },
  teacherAssign: function (r) { // r.day '' = remove from the schedule
    teacher_(r);
    var s = findStudent_(r.name);
    if (!s) throw new Error('No such student.');
    if (!r.day) remove_(s); else place_(s, day_(r.day), printer_(r.printer), mySignup_(s.Name));
    return teacherData_();
  },
  teacherAddStudent: function (r) {
    teacher_(r);
    var name = String(r.name || '').trim();
    if (!name) throw new Error('Enter a username.');
    if (findStudent_(name)) throw new Error('That username already exists.');
    sh_('Students').appendRow([name, r.pin ? pin_(r.pin) : randPin_(), 0, 0, '']);
    return teacherData_();
  },
  teacherResetPin: function (r) {
    teacher_(r);
    var s = findStudent_(r.name);
    if (!s) throw new Error('No such student.');
    var sheet = sh_('Students');
    set_(sheet, s._row, 'PIN', pin_(r.newPin));
    set_(sheet, s._row, 'FailCount', 0);
    set_(sheet, s._row, 'LockUntil', '');
    return teacherData_();
  }
};

// ---------- helpers ----------
function sh_(n) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); }
function tab_(n, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s = ss.getSheetByName(n);
  if (!s) { s = ss.insertSheet(n); s.appendRow(headers); }
  return s;
}
function rows_(s) {
  var v = s.getDataRange().getValues(), h = v.shift();
  return v.map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) { o[k] = r[j]; });
    return o;
  });
}
function set_(s, row, header, val) {
  var h = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  s.getRange(row, h.indexOf(header) + 1).setValue(val);
}
function cfg_(k) {
  var f = rows_(sh_('Config')).filter(function (r) { return r.Key === k; })[0];
  return f ? f.Value : '';
}
function setCfg_(k, v) {
  var s = sh_('Config'), f = rows_(s).filter(function (r) { return r.Key === k; })[0];
  if (f) s.getRange(f._row, 2).setValue(v); else s.appendRow([k, v]);
}
function randPin_() { return ('000' + Math.floor(Math.random() * 10000)).slice(-4); }
function pin_(p) {
  p = String(p || '').trim();
  if (!/^\d{4}$/.test(p)) throw new Error('PIN must be exactly 4 digits.');
  return p;
}
function day_(d) { if (DAYS.indexOf(d) < 0) throw new Error('Pick Mon, Tue, Wed, Thu or Fri.'); return d; }
function printer_(p) { if (PRINTERS.indexOf(p) < 0) throw new Error('Pick Gooper or Squirt.'); return p; }
function teacher_(r) {
  var p = cfg_('TeacherPass');
  if (!p || String(r.pass) !== String(p)) throw new Error('Wrong teacher passphrase.');
}
function findStudent_(name) {
  var n = String(name || '').trim().toLowerCase();
  return rows_(sh_('Students')).filter(function (s) { return String(s.Name).toLowerCase() === n; })[0];
}
function student_(name, pin) { // verifies PIN; 5 wrong tries = 5 minute lockout
  var s = findStudent_(name);
  if (!s) throw new Error('Pick your username from the list.');
  var sheet = sh_('Students');
  if (s.LockUntil && new Date(s.LockUntil) > new Date()) throw new Error('Too many wrong PINs. Try again in a few minutes.');
  if (String(pin).trim() !== String(s.PIN)) {
    var f = Number(s.FailCount || 0) + 1;
    set_(sheet, s._row, 'FailCount', f >= 5 ? 0 : f);
    if (f >= 5) set_(sheet, s._row, 'LockUntil', new Date(Date.now() + 5 * 60000));
    throw new Error('Wrong PIN.');
  }
  set_(sheet, s._row, 'FailCount', 0);
  return s;
}
// Monday of the current week (Sat/Sun roll to next week), prefixed with W so Sheets keeps it as text.
function weekKey_() {
  var tz = Session.getScriptTimeZone();
  var dow = Number(Utilities.formatDate(new Date(), tz, 'u')); // 1=Mon..7=Sun
  var add = dow >= 6 ? 8 - dow : 1 - dow;
  return 'W' + Utilities.formatDate(new Date(Date.now() + add * 864e5), tz, 'yyyy-MM-dd');
}
function weekSignups_(wk) {
  wk = wk || weekKey_();
  return rows_(sh_('Signups')).filter(function (r) { return r.Week === wk; });
}
function mySignup_(name) {
  return weekSignups_().filter(function (r) { return String(r.Name).toLowerCase() === String(name).toLowerCase(); })[0];
}
function place_(s, day, pr, existing) {
  var su = sh_('Signups');
  if (existing) {
    set_(su, existing._row, 'Day', day); set_(su, existing._row, 'Printer', pr); set_(su, existing._row, 'At', new Date());
    return;
  }
  su.appendRow([weekKey_(), day, pr, s.Name, new Date()]);
  set_(sh_('Students'), s._row, 'Total', Number(s.Total || 0) + 1);
}
function remove_(s) {
  var mine = mySignup_(s.Name);
  if (!mine) throw new Error('Not signed up this week.');
  sh_('Signups').deleteRow(mine._row);
  set_(sh_('Students'), s._row, 'Total', Math.max(0, Number(s.Total || 0) - 1));
}
// week = 'yyyy-MM-dd' of a Monday (omit for current week). weeks = every week with data, plus current, oldest first.
function schedule_(week) {
  var cur = weekKey_(), wk = week ? 'W' + week : cur;
  var su = weekSignups_(wk);
  var seen = {}; seen[cur] = 1;
  rows_(sh_('Signups')).forEach(function (r) { if (r.Week) seen[r.Week] = 1; });
  return {
    week: wk.slice(1),
    current: cur.slice(1),
    weeks: Object.keys(seen).sort().map(function (w) { return w.slice(1); }),
    students: rows_(sh_('Students')).map(function (s) { return s.Name; }),
    days: DAYS.map(function (d) {
      return {
        day: d,
        printers: PRINTERS.map(function (p) {
          var c = cfg_('Cap_' + d + '_' + p);
          return {
            printer: p,
            cap: c === '' ? DEFAULT_CAP : Number(c),
            names: su.filter(function (r) { return r.Day === d && r.Printer === p; }).map(function (r) { return r.Name; })
          };
        })
      };
    })
  };
}
function teacherData_() {
  var sched = schedule_(), mine = {};
  weekSignups_().forEach(function (r) { mine[String(r.Name).toLowerCase()] = r.Day + ' / ' + r.Printer; });
  sched.roster = rows_(sh_('Students')).map(function (s) {
    return { name: s.Name, pin: String(s.PIN), total: Number(s.Total || 0), slot: mine[String(s.Name).toLowerCase()] || '' };
  });
  return sched;
}
