// Local UI test server: serves src/Index.html with a fake google.script.run
// backend, so the page can be tried in a normal browser without deploying.
//   node dev/mock-server.js   →  http://127.0.0.1:5198
const http = require('http');
const fs = require('fs');
const path = require('path');

const MOCK = `<script>
  window.confirm = () => true;
  const box = {};
  let nightlyPlan = [{ label: 'Temu', query: 'from:(Temu) -is:starred' }];
  let nightly = false, history = [];
  const q = (s) => [...s.lines.map(l => ({ label: l, query: 'from:(' + l + ')' + (s.olderThanDays ? ' older_than:' + s.olderThanDays + 'd' : '') + ' -is:starred' })),
                    ...s.presets.map(p => ({ label: p, query: 'category:' + p + ' -is:starred' }))];
  const count = rows => rows.map(r => { if (!(r.query in box)) box[r.query] = 50 + Math.floor(Math.random() * 300); return { ...r, count: box[r.query], capped: false }; });
  const addRules = rows => { for (const r of rows) if (!nightlyPlan.some(x => x.query === r.query)) nightlyPlan.push({ label: r.label, query: r.query }); return nightlyPlan.slice(); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.__mock = async (fn, arg) => {
    await wait(fn === 'trashBatch' ? 900 : fn === 'analyse' ? 1500 : 250);
    if (fn === 'getAccount') return { email: 'test@gmail.com', saved: null, nightly, nightlyPlan: nightlyPlan.slice(), nightlyHour: 3, timeZone: 'America/Toronto', history };
    if (fn === 'preview') return count(q(arg));
    if (fn === 'previewRules') return count(arg);
    if (fn === 'analyse') return { scanned: 2000, seconds: 41, senders: [
      { email: 'noreply@indeed.com', name: 'Indeed', count: 412, unread: 400, lastDate: new Date().toISOString(), bulk: true, careful: false, suggestion: 'all' },
      { email: 'noreply@glassdoor.com', name: 'Glassdoor Jobs', count: 188, unread: 150, lastDate: new Date().toISOString(), bulk: true, careful: false, suggestion: 'all' },
      { email: 'alerts@bmo.com', name: 'BMO Alerts', count: 96, unread: 60, lastDate: new Date().toISOString(), bulk: true, careful: true, suggestion: '90' },
      { email: 'hello@etsy.com', name: 'Etsy', count: 71, unread: 30, lastDate: new Date().toISOString(), bulk: true, careful: false, suggestion: '30' },
      { email: 'friend@gmail.com', name: 'A Friend', count: 22, unread: 2, lastDate: new Date().toISOString(), bulk: false, careful: false, suggestion: 'keep' } ] };
    if (fn === 'trashBatch') { const n = Math.min(100, box[arg] || 0); box[arg] -= n; return { moved: n, done: box[arg] === 0 }; }
    if (fn === 'addNightlyRules') return addRules(arg);
    if (fn === 'addNightlyFromSettings') return addRules(q(arg));
    if (fn === 'removeNightlyRule') { nightlyPlan = nightlyPlan.filter(x => x.query !== arg); return nightlyPlan.slice(); }
    if (fn === 'setNightly') { nightly = arg; return arg; }
    if (fn === 'logRun') { history = [{ type: 'manual', at: new Date().toISOString(), ...arg }, ...history].slice(0, 15); return history; }
    return true;
  };
</script>`;

http.createServer((req, res) => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Index.html'), 'utf8')
    .replace(/<\?!=[\s\S]*?\?>/g, JSON.stringify('https://script.google.com/macros/s/TEST/exec'))
    .replace('</head>', MOCK + '</head>');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}).listen(5198, '127.0.0.1', () => console.log('Mock UI on http://127.0.0.1:5198'));
