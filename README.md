# Gmail Cleaner

A free, open-source **Google Apps Script web app** for fast bulk clean-up of any Gmail account. Type senders or keywords (or let it analyse your inbox), preview the counts, and move everything matching to Trash with a live progress bar.

- ⚡ **Fast:** runs on Google's servers, so thousands of emails take minutes, not hours
- 👥 **Works for any Gmail account:** it always cleans **the account that opens it**, so one deployment serves all your accounts
- 🛟 **Safe by design:**
  - moves to **Trash** only (recoverable for 30 days), never deletes forever
  - ⭐ **starred mail is always protected**; the server refuses any search without that protection
  - **preview first**, then confirm
- 🔒 **Private:** your mail never leaves Google; there's no external server

## Features

| Feature | What it does |
|---|---|
| **Analyse my inbox** | Scans your latest ~2,000 inbox conversations, ranks the senders filling it up, and suggests *Trash all*, *older than 30/90 days* or *Keep*. People (Gmail, Outlook… addresses) are always "Keep"; banks, security, government and school senders are never pre-selected |
| **Keywords / senders** | One per line (`temu`, `etsy`, `news@shop.com`), or any full Gmail search (`subject:(sale) older_than:1y`) |
| **Filters** | Match sender (safest) or anywhere · older than N days · **only unread** · skip mail Gmail marked Important |
| **Whole tabs** | Promotions, Social, Updates, Forums, or **All unread mail** |
| **Queue** | Add more tasks while one runs; they run in order with their own progress bars; remove or stop anytime |
| **Nightly clean-up** | Build a list of rules (from the form, the analysis, or any finished task), see the exact Gmail search each runs, and turn on a daily run around 3 AM |
| **History** | Last 15 runs (manual and nightly), with per-rule counts |
| **Themes** | Auto / Light / Dark |

## Deploy your own copy (about 10 minutes)

You need a Google account and Node.js.

1. Enable the Apps Script API: https://script.google.com/home/usersettings
2. Install and log in to clasp (Google's Apps Script CLI):
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
3. Create the project, push the code and deploy:
   ```bash
   clasp create --type webapp --title "Gmail Cleaner" --rootDir src
   git checkout src/appsscript.json    # clasp create overwrites the manifest; restore ours
   clasp push -f
   clasp create-deployment --description "v1"
   ```
4. Open `https://script.google.com/macros/s/<deploymentId>/exec` (the ID is printed by the last command).
5. The first time, each Gmail account clicks **Allow**. Google shows an "unverified app" warning because it's your own private script: click *Advanced → Go to Gmail Cleaner*.

To update later: `clasp push -f`, then `clasp create-deployment -i <deploymentId> --description "vN"`. The link stays the same.

**No-CLI alternative:** create a project at script.google.com, add files `Code.gs` and `Index.html` with the contents of `src/`, replace `appsscript.json` (Project Settings → show manifest), then **Deploy → New deployment → Web app** (Execute as: *User accessing the web app*; Who has access: *Anyone with a Google account*).

## Project layout

```
src/Code.gs          server: Gmail searches, preview counts, batched Trash, analysis, nightly list, history
src/Index.html       the web page (UI + logic)
src/appsscript.json  manifest: runs AS THE USER OPENING IT; Gmail + triggers permissions
dev/mock-server.js   local UI preview with a fake backend: node dev/mock-server.js → http://127.0.0.1:5198
legacy/Code.gs       earlier single-account script (reference)
```

## Permissions it asks for

- **Gmail** (`https://mail.google.com/`): to search your mail and move it to Trash
- **Triggers** (`script.scriptapp`): only for the optional nightly run
- **Your email address** (`userinfo.email`): to show which account you're cleaning

Your settings, nightly rules and history are stored in your own Apps Script *user properties*. Nothing is sent anywhere else.

## Limits

- Gmail moves at most 100 conversations per call; the app works in ~8-second batches and shows progress.
- Apps Script has daily quotas for consumer accounts. Very large clean-ups may need a second run the next day; the nightly run continues automatically.
- If the page never loads, your browser is probably signed in to several Google accounts. Use the account links on the page, an Incognito window, or a separate Chrome profile.

## License

MIT, see [LICENSE](LICENSE).
