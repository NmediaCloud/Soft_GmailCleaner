/**
 * Gmail Cleanup: fast bulk clean-up that runs on Google's servers.
 * Single-account version (kept for reference; the web app in src/ replaces it).
 *
 * HOW TO USE (details in README.md):
 *   1. Run `preview`  → shows how many conversations each rule would move to Trash. Changes nothing.
 *   2. Run `clean`    → moves them to Trash (recoverable for 30 days). Never deletes forever.
 *   3. Optional: run `installNightly` so `clean` runs by itself every night around 3 AM.
 *      Run `removeNightly` to stop it.
 *
 * Safety: starred emails are never touched. Edit RULES below to add or remove senders.
 */

// ---------------------------------------------------------------------------
// Rules: each one is a normal Gmail search. Test any query in Gmail's search box first.
// ---------------------------------------------------------------------------
const RULES = [
  { name: 'Temu (all)',                    query: 'from:temu' },
  { name: 'Etsy (all)',                    query: 'from:etsy' },
  { name: 'Indeed alerts > 30 days',       query: 'from:indeed older_than:30d' },
  { name: 'Glassdoor alerts > 30 days',    query: 'from:glassdoor older_than:30d' },
  { name: 'Job Bank alerts > 30 days',     query: 'from:jobbank older_than:30d' },
  { name: 'Promotions > 30 days',          query: 'category:promotions older_than:30d' },
  { name: 'Social > 30 days',              query: 'category:social older_than:30d' },
];

// Added to every rule: never touch starred mail.
const ALWAYS_EXCLUDE = '-is:starred';

// Apps Script stops a run after 6 minutes; we stop at 5 to finish cleanly.
// Anything left over is picked up by the next run (or the nightly trigger).
const TIME_BUDGET_MS = 5 * 60 * 1000;

// Counting very large results is slow; preview stops counting at this number per rule.
const PREVIEW_COUNT_CAP = 5000;

// ---------------------------------------------------------------------------

function preview() {
  const started = Date.now();
  const lines = ['PREVIEW: nothing is changed. Conversations each rule would move to Trash:', ''];
  let total = 0;
  for (const rule of RULES) {
    const q = fullQuery_(rule);
    let count = 0;
    while (count < PREVIEW_COUNT_CAP && Date.now() - started < TIME_BUDGET_MS) {
      const page = GmailApp.search(q, count, 500);
      count += page.length;
      if (page.length < 500) break;
    }
    const capped = count >= PREVIEW_COUNT_CAP ? '+' : '';
    lines.push(`${pad_(rule.name)} ${count}${capped}     [${q}]`);
    total += count;
  }
  lines.push('', `TOTAL (approx.): ${total}`, '', 'Next: run "clean" to move these to Trash.');
  Logger.log(lines.join('\n'));
}

function clean() {
  const started = Date.now();
  const lines = [`CLEAN run ${new Date().toLocaleString()}: moved to Trash (recoverable 30 days):`, ''];
  let total = 0, outOfTime = false;
  for (const rule of RULES) {
    const q = fullQuery_(rule);
    let moved = 0;
    while (true) {
      if (Date.now() - started > TIME_BUDGET_MS) { outOfTime = true; break; }
      const threads = GmailApp.search(q, 0, 100); // moveThreadsToTrash accepts max 100
      if (!threads.length) break;
      GmailApp.moveThreadsToTrash(threads);
      moved += threads.length;
    }
    lines.push(`${pad_(rule.name)} ${moved}`);
    total += moved;
    if (outOfTime) break;
  }
  lines.push('', `TOTAL moved: ${total}`);
  if (outOfTime) lines.push('Stopped at the 5-minute limit. Run "clean" again (or let the nightly run finish it).');
  saveLastReport_(lines.join('\n'));
  Logger.log(lines.join('\n'));
}

function installNightly() {
  removeNightly();
  ScriptApp.newTrigger('clean').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Nightly clean installed: runs every day around 3 AM. Run "removeNightly" to stop it.');
}

function removeNightly() {
  let removed = 0;
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'clean') { ScriptApp.deleteTrigger(t); removed++; }
  }
  Logger.log(removed ? `Removed ${removed} nightly trigger(s).` : 'No nightly trigger was installed.');
}

function showLastReport() {
  Logger.log(PropertiesService.getUserProperties().getProperty('lastReport') || 'No clean run yet.');
}

// --- helpers ----------------------------------------------------------------

function fullQuery_(rule) {
  return `${rule.query} ${ALWAYS_EXCLUDE}`.trim();
}

function pad_(s) {
  return (s + ':').padEnd(32, ' ');
}

function saveLastReport_(text) {
  PropertiesService.getUserProperties().setProperty('lastReport', text.slice(0, 8000));
}
