/**
 * Gmail Cleaner: web app for fast bulk clean-up of any Gmail account.
 *
 * Deployed as a web app that "executes as the user accessing it", so every
 * Gmail account that opens the link cleans ITS OWN mailbox. It runs on
 * Google's servers, so it's fast regardless of the local PC.
 *
 * Safety: only moves mail to Trash (recoverable for 30 days), never deletes
 * forever. Starred mail is always excluded. Preview shows counts first.
 */

const PROTECT_STARRED = '-is:starred';
const PREVIEW_CAP = 5000;        // stop counting a rule after this many conversations
const BATCH_TIME_MS = 8 * 1000;  // each trash call returns within ~8s so the UI can show progress often

function doGet() {
  // Rendered as a template so the page knows this deployment's own URL (no hard-coded link).
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Gmail Cleaner')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const NIGHTLY_HOUR = 3;       // nightly clean runs around this hour (script time zone)
const HISTORY_LIMIT = 15;     // runs kept in the history view

/** Who is signed in, plus saved settings, the nightly plan and run history for that account. */
function getAccount() {
  const props = PropertiesService.getUserProperties();
  const saved = JSON.parse(props.getProperty('rules') || 'null');
  return {
    email: Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(),
    url: ScriptApp.getService().getUrl(),
    saved,
    nightly: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'nightlyClean'),
    nightlyPlan: getNightly_(),
    nightlyHour: NIGHTLY_HOUR,
    timeZone: Session.getScriptTimeZone(),
    history: getHistory_()
  };
}

// ---- Nightly rule list: [{label, query}], added to / removed from one rule at a time ----

function getNightly_() {
  const props = PropertiesService.getUserProperties();
  const raw = props.getProperty('nightlyRules');
  if (raw) return JSON.parse(raw);
  // Migrate the older "saved form" format into a rule list.
  const old = JSON.parse(props.getProperty('rules') || 'null');
  const list = old ? buildQueries(old).map(r => ({ label: r.label, query: r.query })) : [];
  props.setProperty('nightlyRules', JSON.stringify(list));
  return list;
}

function setNightly_(list) {
  PropertiesService.getUserProperties().setProperty('nightlyRules', JSON.stringify(list.slice(0, 50)));
  return list;
}

/** Add rules (skipping duplicates). Every query must keep starred-mail protection. */
function addNightlyRules(rows) {
  const list = getNightly_();
  for (const r of rows || []) {
    const query = String(r.query || '').trim();
    if (!query || !/-is:starred/.test(query)) continue;
    if (list.some(x => x.query === query)) continue;
    list.push({ label: String(r.label || query).slice(0, 80), query });
  }
  return setNightly_(list);
}

/** Add whatever the form currently describes. */
function addNightlyFromSettings(settings) {
  return addNightlyRules(buildQueries(settings));
}

function removeNightlyRule(query) {
  return setNightly_(getNightly_().filter(x => x.query !== query));
}

function getHistory_() {
  return JSON.parse(PropertiesService.getUserProperties().getProperty('history') || '[]');
}

/** entry = { type: 'manual'|'nightly', at: ISO string, total: number, rules: [{label, moved}] } */
function addHistory_(entry) {
  const history = [entry].concat(getHistory_()).slice(0, HISTORY_LIMIT);
  PropertiesService.getUserProperties().setProperty('history', JSON.stringify(history));
  return history;
}

/** Called by the page after a manual run finishes (or is stopped). */
function logRun(entry) {
  return addHistory_({
    type: 'manual',
    at: new Date().toISOString(),
    total: Number(entry && entry.total) || 0,
    stopped: !!(entry && entry.stopped),
    rules: ((entry && entry.rules) || []).slice(0, 30).map(r => ({ label: String(r.label).slice(0, 80), moved: Number(r.moved) || 0 }))
  });
}

/**
 * Turn the form into Gmail searches.
 * settings = { lines: string[], mode: 'from'|'anywhere', olderThanDays: number,
 *              presets: string[], protectImportant: boolean }
 */
function buildQueries(settings) {
  const s = settings || {};
  const age = (Number(s.olderThanDays) > 0 ? ` older_than:${Math.floor(Number(s.olderThanDays))}d` : '')
    + (s.unreadOnly ? ' is:unread' : '');
  const extra = ` ${PROTECT_STARRED}${s.protectImportant ? ' -is:important' : ''}`;
  const out = [];

  for (const raw of s.lines || []) {
    const line = String(raw).trim();
    if (!line) continue;
    let q;
    if (/[:()"]/.test(line)) q = line;                       // already a Gmail search, use as-is
    else if (s.mode === 'anywhere') q = `"${line}"`;           // keyword anywhere in the email
    else q = `from:(${line})`;                                 // sender name or address contains it
    out.push({ label: line, query: (q + age + extra).trim() });
  }

  const PRESETS = {
    promotions: { label: 'Promotions', query: 'category:promotions' },
    social: { label: 'Social', query: 'category:social' },
    updates: { label: 'Updates', query: 'category:updates' },
    forums: { label: 'Forums', query: 'category:forums' },
    allunread: { label: 'All unread mail', query: 'is:unread' }
  };
  const days = Number(s.olderThanDays) > 0 ? ` (older than ${Math.floor(Number(s.olderThanDays))} days)` : '';
  for (const key of s.presets || []) {
    const p = PRESETS[key];
    if (!p) continue;
    const unread = s.unreadOnly && key !== 'allunread' ? ', unread' : '';
    out.push({ label: p.label + unread + days, query: (p.query + age + extra).replace(/(is:unread)(.*)\1/, '$1$2').trim() });
  }
  return out;
}

/** Count matching conversations per rule. Changes nothing. */
function preview(settings) {
  return countRules_(buildQueries(settings));
}

// ---- Analyse: which senders fill the inbox, and what's safe to suggest ----

const ANALYSE_MAX_THREADS = 2000;   // most recent inbox conversations scanned
const ANALYSE_TIME_MS = 90 * 1000;  // stop scanning after this, return what we have

// Senders that look automated / bulk: automated local parts, or marketing subdomains right after "@".
const BULK_HINTS = /(no-?reply|do-?not-?reply|newsletter|news@|info@|marketing|promo|offers|deals|mailer|notifications?@|alerts?@|updates?@|digest|hello@|team@|campaign|@(e|em|email|mail|mailer|news|info|marketing|reply|bounce)\.)/i;
// Personal mailbox providers: senders here are people, never treated as bulk.
const PERSONAL_DOMAINS = /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|aol|proton|protonmail|gmx|zoho)\.[a-z.]+$/i;
// Senders we never suggest trashing wholesale (money, security, government, school).
const CAREFUL_HINTS = /(bank|bmo|td\.com|rbc|scotia|cibc|capitalone|neo\s?financial|paypal|visa|mastercard|amex|interac|cra|canada\.ca|gc\.ca|gov|irs|security|accounts\.google|verify|verification|2fa|otp|password|school|university|college|\.edu|hospital|clinic|insurance)/i;

/**
 * Scan recent inbox conversations and rank senders.
 * Returns [{ email, name, count, unread, lastDate, bulk, careful, suggestion }]
 * suggestion: 'all' | '30' | '90' | 'keep'
 */
function analyse() {
  const started = Date.now();
  const bySender = {};
  let scanned = 0;

  for (let start = 0; start < ANALYSE_MAX_THREADS && Date.now() - started < ANALYSE_TIME_MS; start += 100) {
    const threads = GmailApp.search('in:inbox -is:starred', start, 100);
    if (!threads.length) break;
    const messages = GmailApp.getMessagesForThreads(threads);
    messages.forEach(msgs => {
      const first = msgs[0];
      if (!first) return;
      const from = first.getFrom() || '';
      const m = from.match(/<([^>]+)>/);
      const email = (m ? m[1] : from).trim().toLowerCase();
      const name = (m ? from.slice(0, from.indexOf('<')) : '').replace(/"/g, '').trim() || email;
      const s = bySender[email] || (bySender[email] = { email, name, count: 0, unread: 0, lastDate: 0 });
      s.count++;
      // Use the already-loaded messages (thread getters would cost one Gmail call each).
      if (msgs.some(x => x.isUnread())) s.unread++;
      s.lastDate = Math.max(s.lastDate, msgs[msgs.length - 1].getDate().getTime());
    });
    scanned += threads.length;
    if (threads.length < 100) break;
  }

  const list = Object.values(bySender)
    .filter(s => s.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40)
    .map(s => {
      const hay = s.email + ' ' + s.name;
      const personal = PERSONAL_DOMAINS.test(s.email);
      const bulk = !personal && BULK_HINTS.test(hay);
      const careful = CAREFUL_HINTS.test(hay);
      const unreadPct = s.unread / s.count;
      let suggestion = 'keep';
      if (personal) suggestion = 'keep';
      else if (careful) suggestion = 'keep'; // banks, security, government, school: never pre-selected
      else if (bulk && unreadPct >= 0.6) suggestion = 'all';
      else if (bulk) suggestion = '30';
      else if (unreadPct >= 0.9 && s.count >= 10) suggestion = '30';
      return { ...s, lastDate: new Date(s.lastDate).toISOString(), bulk, careful, suggestion };
    });

  return { scanned, senders: list, seconds: Math.round((Date.now() - started) / 1000) };
}

/** Count an explicit list of {label, query} rules (used for the nightly list). */
function previewRules(rows) {
  return countRules_((rows || []).filter(r => /-is:starred/.test(r.query)));
}

function countRules_(rules) {
  const started = Date.now();
  return rules.map(r => {
    let count = 0;
    while (count < PREVIEW_CAP && Date.now() - started < 4.5 * 60 * 1000) {
      const page = GmailApp.search(r.query, count, 500);
      count += page.length;
      if (page.length < 500) break;
    }
    return { label: r.label, query: r.query, count, capped: count >= PREVIEW_CAP };
  });
}

/**
 * Move up to ~25 seconds' worth of matching conversations to Trash.
 * The page calls this repeatedly until done === true, updating the progress bar.
 */
function trashBatch(query) {
  if (!query || !/-is:starred/.test(query)) throw new Error('Refusing to run a query without starred-mail protection.');
  const started = Date.now();
  let moved = 0;
  while (Date.now() - started < BATCH_TIME_MS) {
    const threads = GmailApp.search(query, 0, 100); // moveThreadsToTrash accepts max 100
    if (!threads.length) return { moved, done: true };
    GmailApp.moveThreadsToTrash(threads);
    moved += threads.length;
  }
  return { moved, done: false };
}

/** Remember this account's rules (used by the nightly run). */
function saveSettings(settings) {
  PropertiesService.getUserProperties().setProperty('rules', JSON.stringify(settings));
  return true;
}

/** Turn the nightly clean (~3 AM, using saved rules) on or off for this account. */
function setNightly(on) {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'nightlyClean') ScriptApp.deleteTrigger(t);
  }
  if (on) ScriptApp.newTrigger('nightlyClean').timeBased().everyDays(1).atHour(NIGHTLY_HOUR).create();
  return on;
}

/** Runs from the nightly trigger with the saved rules. */
function nightlyClean() {
  const plan = getNightly_();
  if (!plan.length) return;
  const started = Date.now();
  const rules = [];
  let total = 0, outOfTime = false;
  for (const r of plan) {
    if (!/-is:starred/.test(r.query)) continue; // safety: never run an unprotected query
    let moved = 0;
    while (true) {
      if (Date.now() - started > 5 * 60 * 1000) { outOfTime = true; break; }
      const threads = GmailApp.search(r.query, 0, 100);
      if (!threads.length) break;
      GmailApp.moveThreadsToTrash(threads);
      moved += threads.length;
    }
    rules.push({ label: r.label, moved });
    total += moved;
    if (outOfTime) break;
  }
  addHistory_({ type: 'nightly', at: new Date().toISOString(), total, stopped: outOfTime, rules });
}
