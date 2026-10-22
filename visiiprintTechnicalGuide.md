# Visii Print Hub: Technical Guide

A plain-language explanation of how the 3D printer sign-up site works, plus the technical reference a future Claude session needs to safely change or extend it.

- **Live site:** https://visiiprint.onrender.com
- **Files:** `index.html` (the website), `Code.gs` (the backend), and a Google Sheet (the database)
- **Sibling project:** the Runic System (`visiirunes`), built the same way

---

## Read this first if you are Claude

Paste this whole document at the start of a new conversation, along with the current `index.html` and `Code.gs`. Then:

1. **The backend is the source of truth.** The webpage only displays things. Every rule (who may sign up, how many spots, PIN checks) is enforced in `Code.gs`. Never move a rule into the frontend only.
2. **Keep the backend URL in `index.html`.** The constant `DEFAULT_API_URL` holds the live Apps Script `/exec` URL (see Section 8). Whenever you hand back a new `index.html`, it must still contain that URL. An earlier revision shipped with a placeholder and broke the live site.
3. **Editing `Code.gs` does nothing until it is redeployed** as a new version (Section 7). Always remind the teacher of this.
4. **Do not publish the real `index.html` with Claude's Artifact tool.** Artifact previews block calls to `script.google.com`, so the backend connection will silently fail there. Open it as a real file, or deploy through GitHub and Render.
5. **Sheet columns are looked up by header name, not position.** Do not rename headers. Adding a new column is safe.
6. Read Section 10 (design decisions) before changing the look, and Section 11 (known limits) before promising a feature.

---

## 1. What the site does (plain language)

The school has two 3D printers, named **Gooper** and **Squirt**. Students sign up for time on one of them.

- There are 20 students. Each has a **username** and a **4-digit PIN**.
- Each student may hold **one slot per week**. A slot is a weekday afternoon (Mon, Tue, Wed, Thu or Fri) on one printer.
- Several students may share a printer on the same afternoon. The number of spots per printer per day is set by the teacher and is currently 1, so only one student per printer per afternoon.
- The schedule for the current week is on the main page, and everyone can see who has which slot.
- Older/Newer buttons let anyone browse past weeks' schedules, each labelled with its date. These are read-only.
- A password-protected **teacher portal** at the bottom of the page lets the teacher change spot counts, move students between slots, see PINs and total sign-up counts, reset PINs, and add new usernames.

On Saturday and Sunday the schedule automatically shows **next** week, so students can sign up for the coming Monday onward.

---

## 2. How the pieces fit together

There is no traditional server. Three ordinary things work together:

| Piece | What it is | Where it lives |
|---|---|---|
| **Frontend** | One self-contained file, `index.html`, with all its HTML, CSS and JavaScript inline. This is what a student's browser displays. | A GitHub repo, hosted as a **Static Site on Render** at `visiiprint.onrender.com`. Pushing to GitHub auto-redeploys. |
| **Backend** | A small program, `Code.gs`, in Google Apps Script. It receives requests, applies the rules, and reads/writes the sheet. | Google's servers, attached to the Google Sheet. |
| **Database** | A Google Sheet with three tabs: Students, Signups, Config. | The teacher's Google Drive. |

Example: a student claims a spot.

```
Student's browser                 Google Apps Script               Google Sheet
-----------------                 ------------------               ------------
1. Click "Claim"
2. fetch() POST  ------------->   3. doPost() receives it
                                  4. Checks name + PIN  ---------> reads Students
                                  5. Checks the slot is open -----> reads Signups, Config
                                  6. Writes the sign-up ----------> writes Signups, Students
7. Redraws schedule  <---------   8. Returns the updated schedule (JSON)
```

The browser never edits the sheet directly and never decides whether something is allowed. It just displays what the backend returns.

### Why it is built this way
- No server to pay for or maintain. Google Sheets, Apps Script and Render's static hosting are free.
- The teacher can open the Sheet at any time to inspect or hand-fix data.
- A short lock inside the backend (Section 6) stops two people clicking at the same instant from corrupting each other's data.

---

## 3. Glossary for non-technical readers

| Term | Plain meaning |
|---|---|
| Frontend | The webpage students see and click. |
| Backend | The hidden program that enforces the rules and stores data. |
| Google Apps Script | A free Google tool for running small programs attached to a Sheet. |
| Deployment | A published, numbered version of the backend with its own web address. Editing code does nothing to the live site until you deploy a new version. |
| `/exec` URL | The web address of the deployed backend. The website talks to it. |
| API / action | One kind of request the backend understands, like `signup` or `teacherResetPin`. |
| Lock | A brief "wait your turn" the backend uses so simultaneous clicks do not collide. |
| Static site | A website that is just files, with no server code. |
| Canvas | A drawing area in a webpage. The floating wireframe shapes are drawn on canvases. |

---

## 4. The Google Sheet (database)

Three tabs. The `setup()` function in `Code.gs` creates them and the 20 starting students.

### Students tab: one row per student
| Column | Contains |
|---|---|
| Name | Username, exactly as displayed. Matching is case-insensitive. |
| PIN | The 4-digit PIN, stored as **plain text** (the column is formatted as text so leading zeros survive, e.g. `0427`). |
| Total | How many times this student has signed up, ever. Goes up when they claim a slot in a week they had none, and down if they leave. Moving between slots does not change it. |
| FailCount | Consecutive wrong PIN attempts. Resets on a correct PIN. |
| LockUntil | If set, the time before which PIN entry is locked (after 5 wrong attempts, a 5-minute lockout). |

Starting usernames: Avi, Rana, Aidan, Seren, David, Elin, Amelia, Nova, Anaya, Daniel, Taya, Jacxson, Darien, Mae-Lou, Benny, Leith, Ronan, Sol, Elliott, Charlie.

### Signups tab: one row per sign-up, kept forever (this is the history)
| Column | Contains |
|---|---|
| Week | Text like `W2026-10-19`: a `W` plus the date of that week's Monday. The `W` stops Google Sheets from converting it into a date. |
| Day | `Mon`, `Tue`, `Wed`, `Thu` or `Fri`. |
| Printer | `Gooper` or `Squirt`. |
| Name | The student's username. |
| At | Timestamp of the claim (or last move). |

A student leaving the schedule deletes their row for that week. Past weeks' rows are never touched by normal use, which is how the "Older" history works.

### Config tab: key/value settings
| Key | Value |
|---|---|
| `TeacherPass` | The teacher passphrase, set the first time someone unlocks the teacher portal. |
| `PolicyText` | The text of the 3D Printer Policy box. If empty or missing, the default text in `DEFAULT_POLICY` (top of `Code.gs`) is shown. |
| `Cap_Mon_Gooper`, `Cap_Mon_Squirt`, `Cap_Tue_Gooper`, ... (10 keys) | Spots for that printer on that day. `0` means closed. A key is created the first time the teacher changes it. |

**Important:** the spot counts live in the Config tab, **not** in the code. Replacing `index.html` never changes them. The only number in code is `DEFAULT_CAP = 2` in `Code.gs`, used only for day/printer combinations that have no Config row yet. Changing `DEFAULT_CAP` does not override rows that already exist.

---

## 5. Credentials

| Credential | Who has it | What it unlocks | Where checked |
|---|---|---|---|
| Student PIN (4 digits) | Each student, for their own username | Claiming, moving, or leaving a slot | Students tab |
| Teacher passphrase (3+ characters) | The teacher | The teacher portal | Config tab (`TeacherPass`) |

- Viewing the schedule needs no login. The student name list is public.
- There is no session or token. The student's name and PIN, or the teacher passphrase, are re-sent with each action and checked every time. The frontend only remembers them in memory for the current page visit; refreshing the page logs out.
- Wrong PIN handling: 5 wrong attempts in a row locks that username for 5 minutes.

---

## 6. How the backend works (`Code.gs`)

### Structure
- `doPost(e)`: the single entry point. It takes the lock, parses the JSON body, looks the `action` up in the `ACTIONS` table, and returns `{"ok":true,"data":...}` or `{"ok":false,"error":"..."}`.
- Everything is wrapped in a `LockService` script lock that waits up to 10 seconds, so two simultaneous requests are processed one at a time.
- `setup()`: run by hand once. It creates the tabs and seeds the 20 students with random PINs, only if the Students tab is empty. It is safe to re-run: it also upgrades an older Signups tab by adding the Printer column, and never overwrites existing data.

### Constants at the top of `Code.gs`
`DAYS`, `PRINTERS`, `DEFAULT_CAP`, `DEFAULT_POLICY`, `START_NAMES`. Printer names are validated against `PRINTERS`.

### Week logic
`weekKey_()` returns the current week as `W` + the Monday's date (script timezone). On Saturday and Sunday it returns the **next** Monday, so weekends show next week's sheet.

The timezone is the Apps Script project's timezone (Project Settings in the Apps Script editor). If weeks ever roll over at the wrong time, check that setting.

### API actions

All requests are HTTP POST with a JSON body containing `action` plus the parameters below.

| action | Parameters | What it does | Auth |
|---|---|---|---|
| `getSchedule` | `week` (optional, `yyyy-MM-dd` of a Monday) | Returns that week's schedule, the list of all weeks with data, the student names, and which week is current. | None |
| `login` | `name`, `pin` | Verifies the PIN and returns the current schedule. | PIN |
| `signup` | `name`, `pin`, `day`, `printer` | Claims a slot, or moves the student if they already have one this week. Fails if closed, full, or already theirs. | PIN |
| `cancel` | `name`, `pin` | Removes the student's slot for the current week. | PIN |
| `teacherStatus` | none | Says whether a teacher passphrase has been set yet. | None |
| `teacherSetup` | `pass` | Sets the passphrase (only works once). | None (first time only) |
| `teacherLogin` | `pass` | Returns the teacher data (schedule plus roster). | Passphrase |
| `teacherSetPolicy` | `pass`, `text` | Saves the 3D Printer Policy text (3000 characters max). Blank restores the default. | Passphrase |
| `teacherSetCap` | `pass`, `day`, `printer`, `cap` | Sets spots (0-20) for a printer on a day. | Passphrase |
| `teacherAssign` | `pass`, `name`, `day`, `printer` | Puts a student in a slot, or removes them if `day` is empty. **Ignores spot limits.** | Passphrase |
| `teacherAddStudent` | `pass`, `name`, `pin` (optional) | Adds a username. A blank PIN gets a random one. | Passphrase |
| `teacherResetPin` | `pass`, `name`, `newPin` | Sets a new PIN and clears any lockout. | Passphrase |

Schedule shape returned by `getSchedule`:

```json
{
  "week": "2026-10-19", "current": "2026-10-19",
  "policy": "1. Be mindful of waste...",
  "weeks": ["2026-10-12", "2026-10-19"],
  "students": ["Avi", "Rana", "..."],
  "days": [
    { "day": "Mon", "printers": [
      { "printer": "Gooper", "cap": 1, "names": ["Nova"] },
      { "printer": "Squirt", "cap": 1, "names": [] } ] }
  ]
}
```

Teacher calls return the same shape plus a `roster` array: `{name, pin, total, slot}` where `slot` is text like `"Wed / Gooper"` or empty.

### Rules enforced by the backend
- One slot per student per week (a second claim becomes a **move**).
- A slot cannot be claimed if it is closed (cap 0) or full, unless the teacher assigns it.
- Day and printer values must be valid. PINs must be exactly 4 digits.
- Usernames are unique, case-insensitively.

---

## 7. How to deploy changes

### Changing the website (`index.html`)
1. Edit the file. **Confirm `DEFAULT_API_URL` still holds the real URL.**
2. Commit and push to the GitHub repo (root of the repo, file named `index.html`).
3. Render redeploys automatically within about a minute.

Render settings: Static Site, branch `main`, build command blank, publish directory `.`.

### Changing the backend (`Code.gs`)
1. Edit the code in the Apps Script editor (Extensions > Apps Script from the Sheet).
2. If the change adds or alters tabs/columns, run `setup()` once from the editor.
3. **Deploy > Manage deployments > pencil icon > Version: New version > Deploy.**
   This keeps the same `/exec` URL. Do **not** create a brand-new deployment, since that makes a new URL that would need to be pasted into `index.html`.
4. Editing alone does nothing to the live site.

Deployment settings: Execute as **Me**, Who has access **Anyone**.

### Troubleshooting
| Symptom | Likely cause |
|---|---|
| Dropdown stuck on "Loading..." / "Backend URL is not set" | `DEFAULT_API_URL` is still the placeholder or was overwritten. |
| "The backend did not answer correctly" | Wrong URL, URL ends in `/dev`, or access is not set to Anyone. |
| Backend edit has no effect | A new deployment version was not created. |
| Weeks roll over at the wrong time | Apps Script project timezone. |
| Spots show a different number than expected | Check the Config tab's `Cap_...` rows, which override `DEFAULT_CAP`. |

---

## 8. Reference values

- **Backend URL (`DEFAULT_API_URL`):**
  `https://script.google.com/macros/s/AKfycbyZtA9QOUuw0F0DcnJnODREDv48Q4sonn9e_3wl2zpi8YtvNLEo7DZAfxI72hcaMC1h/exec`
  (If the deployment is ever replaced, this value changes and must be updated in `index.html`.)
- **Printers:** Gooper, Squirt
- **Days:** Mon-Fri (afternoons; there are no individual time windows)
- **Fonts:** Orbitron (headings) and IBM Plex Mono (everything else), both from Google Fonts
- **Colours:** soft light yellow `#ffe9a0` (main theme), coral pink `#ff9aa8` (floating shapes and claimed tiles), red `#ff3b30` (Leave button and errors), light grey at 22% opacity for section borders

---

## 9. How the frontend works (`index.html`)

One file with three parts: `<style>`, the HTML body, and two `<script>` blocks.

### Page layout (top to bottom)
1. Floating wireframe shapes (four `<canvas class="shape">` elements) and a still grid-floor background.
2. Header: the title "VISII PRINT HUB" and the subheader.
3. **3D Printer Policy panel** (`#policy`): plain text set by the teacher (line breaks are kept). Filled from the `policy` field returned with every schedule.
3b. **User login panel** (`#loginPanel`): username dropdown plus PIN. After login it is replaced by a "Hi, name" bar (`#me`) with a Log out button.
4. **Printer schedule panel**: Older/Newer navigation (`#prev`, `#next`, `#weekLbl`) and the 5-day grid (`#week`). Each day box contains a block per printer with its spot squares (a claimed printer block is tinted translucent coral pink, with the student's name readable inside), student names, and a **Claim** / **Move here** / **Leave** / **Full** / **Closed** button.
5. **Teacher portal panel**: a passphrase lock (`#tLock`) and, once unlocked, the teacher body (`#tBody`).

### Key JavaScript
| Function | Role |
|---|---|
| `api(action, params)` | Sends the POST (as `text/plain` to avoid a browser preflight check), parses the reply, and throws a readable error on failure. Also refuses to run if the URL is not a Google Apps Script URL. |
| `run(fn)` | Wraps an action and shows any error as a toast message. |
| `setSched(s)` | Stores a schedule, refreshes the username dropdown, and calls `renderWeek()`. |
| `renderWeek()` | Draws the whole schedule grid and the login/"Hi" bar. Buttons appear only for a logged-in student on the **current** week. Past weeks are read-only. |
| `mySlot()` | Finds the logged-in student's slot in the displayed schedule. |
| `goWeek(w)` | Loads and displays another week (Older/Newer). |
| `tInit()`, `renderT()`, `tCall()` | Teacher portal: checks if a passphrase exists, draws the teacher panels (policy text editor, spot grid, schedule editor, students table with PINs and reset, add-username form), and wraps teacher actions. |

Click handling is done by event delegation: one handler on `#week` and one on `#tBody`, reading `data-` attributes from the buttons. When adding a new button, give it a `data-` attribute and extend the relevant handler.

The student-facing state (`me`, `sched`) lives only in JavaScript variables. Nothing is saved in the browser; refreshing logs the student out.

### The floating shapes
Four wireframe shapes (an **icosahedron**, a **sphere**, a **tetrahedron** and an **octahedron**) are drawn on `<canvas>` elements by a small script at the bottom of the file. It lists each shape's points and edges, rotates them slowly in 3D, projects them to 2D, and draws the lines in coral pink at about 30% opacity. They are decorative only. If a visitor's device has "reduce motion" turned on, they are drawn once and held still. They were originally CSS-built cubes, which glitched, so they were rebuilt on canvas. Avoid going back to CSS 3D panels.

---

## 10. Design decisions to preserve

- **Look:** dark Tron-style theme with soft light yellow text/accents. The user found bright green too harsh. The floor grid is static and there are no scrolling animations, since motion was tiring. Only the shapes rotate, slowly.
- **Section borders** are clean rectangles in faint light grey, deliberately low-contrast. Buttons, inputs and the highlight on the student's own claimed slot keep the yellow outline.
- **Wording:** the sign-up button says **Claim** (not "Join"). The subheader reads "VISII 3D printer sign-up hub. Let's build something great." The theme is inclusion and sharing.
- **Fonts:** large headings (title, panel headings, day names) are Orbitron. All smaller text, including fields, buttons, names and descriptions, is IBM Plex Mono, sized generously (about 13-17px) for legibility. Body text is `1.1rem` and individual small-text sizes are set in `rem` in the stylesheet.
- **Claimed tiles:** a printer block with at least one name gets the CSS class `taken` (translucent coral pink, the same colour as the floating shapes) as a quick visual cue. The student's own slot also gets class `mine`, which adds a yellow border.
- **Policy box:** the 3D Printer Policy sits under the title. The teacher edits it in the Teacher Portal; it is stored in Config as `PolicyText`.
- **History is data, not images.** Past weeks are redrawn from the Signups tab rather than stored as pictures. This keeps them accurate and searchable in the Sheet.
- **Theme colours** are CSS variables at the top of the stylesheet (`--g` main yellow, `--bd` border grey, `--panel` panel background, `--warn` red). Change colours there rather than hunting through the file. The coral shape colour is set in the canvas script.

---

## 11. Known limitations and caveats

| Limitation | Notes |
|---|---|
| PINs are stored and displayed in **plain text**. | Deliberate, so the teacher can see and reset them. Anyone with access to the Sheet can read them. Fine for a classroom tool; do not reuse real passwords. |
| The teacher passphrase is also plain text in the Config tab and is re-sent with every teacher action. | It travels over HTTPS. There is no teacher session. |
| The teacher portal is on the public page. | It is locked by the passphrase, but the lock screen is visible to everyone. |
| The student name list is public. | Anyone can see names, but needs the PIN to act. |
| Teacher moves ignore the spot limit. | Intentional, so the teacher can override. |
| Past weeks use **today's** spot counts for the empty squares. | The names shown are accurate; only the number of empty squares for an old week can differ if limits were later changed. |
| Spots are per day and printer, but there are no time windows within the afternoon. | A future feature if needed. |
| There is no "delete student" action. | To retire a student, delete their row in the Students tab by hand (their old Signups rows may remain). |
| There is no "reset total" or "clear a week" action. | Edit the Sheet by hand. |
| Google Sheets/Apps Script are not built for heavy traffic. | Fine for dozens of students acting occasionally. |
| Weeks begin on Monday in the script's timezone. | |

---

## 12. Ideas the teacher may want later

- A "share your spot" / "bring a buddy" feature, in keeping with the inclusion theme.
- Teacher actions to delete a student or clear a week.
- Time windows within the afternoon, or a printer-notes field (for example, what is being printed).
- Printer status flags (for example, Squirt out of filament) the teacher can toggle.
- Hashing PINs (this would remove the teacher's ability to read them).
- A waitlist when a slot is full.
- Exporting the history to a CSV from the Sheet.

---

## 13. Questions to ask the teacher before changing something

1. Does the change need to keep the existing students, PINs and history? (Almost always yes.)
2. Is it a **frontend-only** change (look, wording)? Then just push `index.html`. Is it a **rule** change (limits, who can do what)? Then `Code.gs` must change and be redeployed.
3. Will a new column or tab be needed? If so, run `setup()` (and update it if it needs to create or migrate that column).
4. Does the teacher remember how to redeploy the Apps Script (Section 7)?
5. If the backend URL has changed, has the new one been put in `DEFAULT_API_URL`?

---

## 14. One-paragraph mental model

The webpage is just a display. Every rule (who can sign up, how many spots there are, whether a PIN is right) lives in `Code.gs`, which is the only thing allowed to read or write the Google Sheet. The Sheet is the whole database: students and PINs, a permanent log of every sign-up by week, and a few settings such as the teacher passphrase and spots per printer. Nothing is real until `Code.gs` says it is real, and nothing the teacher sets (such as spot counts) is stored in the website file, so updating the site never resets it.
