# Hearthboard

A drag-and-drop family wall calendar for your home network. It runs in
Docker on a Synology NAS (or any Docker host). Hang a TV or monitor in the
kitchen and point its browser at the board, then arrange everything from your
phone or PC.

![The wall display](docs/images/display.png)

## What it does

- **Two-way Apple (iCloud) and Google Calendar.** Your calendars appear
  together. Anything you add, drag, resize or edit on the board is saved back
  to the calendar it belongs to, and changes made on your phone show up within
  a minute. Repeating events work the way you'd expect ("only this one" or
  "all events"). Family members can only change the calendars an admin has
  opened up to them ([who can edit what](#who-can-change-which-calendar)).
- **Apple Reminders**, sent by a small iPhone Shortcut (Apple doesn't let
  servers read iCloud Reminders). Tick one off on the board and the Shortcut
  completes it on your phone.
- **Photos from Synology Photos:** a slideshow from your photo library, or
  from one album. iPhone HEIC photos use the previews Synology already made.
- **Bible verse or quote of the day:** a built-in list of ESV verses plus
  quotes, or your own entries.
- **Checklists:** chores, groceries, packing lists. Optionally untick
  everything at midnight.
- **A clock.**
- **Everything moves and resizes.** Drag widgets around a grid, stretch them
  to any size, and make several boards (kitchen, kids' room, portrait tablet).
  The TV updates the moment you let go.
- **A sign-in for each person, with two-step sign-in.** Everyone in the family
  gets their own username, password and boards. Codes from an authenticator app
  can be required on top of the password.
- **Made for a wall:** seven color themes, five text sizes (per board or per widget), optional night dimming, burn-in
  protection, reconnects by itself, and reloads nightly to pick up updates.

### New in this release

Each of these has a full section in the **[feature guide](docs/features.md)**.

1. **Weather widget:** current conditions and up to a 7-day forecast from Open-Meteo. Free,
   no API key, and it keeps showing the last forecast if the internet drops.
2. **Countdown widget:** "12 sleeps until the beach". Type in dates, repeat birthdays every
   year, or count down to any calendar event with a keyword like 🎉 in its title.
3. **Meal plan:** plan the week's meals from your phone on the new **Family** page and show them
   on the board. One tap fills the week from last week.
4. **Family notes:** sticky notes posted from a phone that come down by themselves when they
   expire.
5. **Subscribed calendars:** add any `.ics` / `webcal://` calendar (school, sports, a shared
   Google or iCloud calendar), with one-tap public holidays for the US, UK, Canada, Australia
   and Christian holidays.
6. **Quick add in plain words:** type "Soccer Sat 9-10:30am @ Riverside Park" on the Calendar
   page, check the preview, and press Enter.
7. **Undo, redo and keyboard shortcuts** in the layout editor: ↶ ↷ buttons for phones, and arrow
   keys to nudge and resize widgets (press `?` for the full list).
8. **Touch-screen mode:** on a paired wall tablet, anyone can tick checklists and reminders
   without signing in, and the screen can stay awake. Tap for a full-screen button on any
   display.
9. **Board schedules:** show a morning-routine board on school mornings, or a dinner board at
   6 PM, and switch back by themselves.
10. **Export and import layouts:** save a board as a file to back it up or copy it to another
    Hearthboard.

![Weather, countdown, notes and meal plan widgets](docs/images/new-widgets.png)

| Layout editor (PC)                | Calendar page                         | Editor on a phone                             |
| --------------------------------- | ------------------------------------- | --------------------------------------------- |
| ![Editor](docs/images/editor.png) | ![Calendar](docs/images/calendar.png) | ![Phone editor](docs/images/editor-phone.png) |

## Install on a Synology NAS

The short version: in **Container Manager → Project → Create**, paste
[`docker-compose.yml`](docker-compose.yml), then set your `PUID`/`PGID` and
the path to your photos. Then open `http://<nas-ip>:8080/edit`, create your
sign-in, and set everything else (time zone, accounts, sync interval, people)
under **Settings**.

The step-by-step guide, including how to find your user ID and how to put the
board on a Fire TV, Raspberry Pi or iPad, is in
**[docs/synology-install.md](docs/synology-install.md)**.

Then connect your accounts:

- [Apple iCloud Calendar](docs/icloud-setup.md): an app-specific password,
  2 minutes
- [Google Calendar](docs/google-setup.md): your own free OAuth client,
  about 10 minutes, once
- [Apple Reminders](docs/reminders-shortcut.md): an iPhone Shortcut and an
  automation, about 5 minutes

To try it with sample data first, add `HEARTHBOARD_DEMO: "1"` to the
environment.

## Pages

| URL         | What it's for                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`         | The wall display, read-only: for paired screens and signed-in people. `/?board=<id>` shows another board.                         |
| `/edit`     | Arrange widgets: drag the ⠿ pill to move, drag edges to resize, ⚙︎ for board settings, ↶ ↷ to undo (`?` for shortcuts).            |
| `/calendar` | Full calendar: quick add in plain words, drag to move, stretch to resize, select a time range to create, click to edit or delete. |
| `/family`   | Day-to-day things from your phone: post notes to the board, plan the week's meals.                                                |
| `/settings` | Your account and two-step sign-in, people, time zone and sync, calendars, reminders, photos, checklists, verses.                  |

Boards are private. A screen shows one only after an admin has **paired** it
once, or when someone signed in opens it; a TV never signs in. Changing anything
needs a sign-in, except ticking checklists and reminders on a paired board in
[touch-screen mode](docs/features.md#8-touch-screen-mode-for-a-wall-tablet).
See [Pairing a TV or tablet](#pairing-a-tv-or-tablet).

## People and sign-in

The first visit to `/edit` creates your sign-in, and you become the **admin**.
Add everyone else under **Settings → People**. Each person gets:

- **Their own username and password.** Passwords are at least 8 characters.
- **Their own board**, named after them, which they can rearrange and copy.
  Show it on a screen with `/?board=<id>` (Board settings shows the address).
  Members see and edit only their own boards; admins see everyone's, can help
  arrange them, and can hand a board to someone else ("Belongs to" in Board
  settings).
- **A role.** _Members_ can arrange their boards, add and change events on the
  calendars an admin has opened to the family (see below), tick reminders and
  manage checklists and verses. _Admins_ can also add and remove people, connect
  calendar accounts and Synology Photos, and see the reminders token.

Calendars, reminders, photos, checklists, notes and the meal plan are shared by the household. To
give someone a board with just their calendar, pick it under the calendar
widget's settings.

### Who can change which calendar

Connecting an account brings in all of its calendars, which may include your
personal or work ones. So **family members can look at every calendar you
show, but can't add, move, edit or delete events on any of them until an admin
allows it.** It's off by default for every calendar. To turn it on, go to
**Settings → Calendars** and switch on **Family can add and change events**
next to a calendar (for example a shared "Family" calendar). Admins can always
change any calendar that isn't read-only, and nobody can change a read-only
calendar such as a subscribed feed.

### Two-step sign-in

Under **Settings → My account → Two-step sign-in**, scan the QR code with an
authenticator app: the iPhone's Passwords app, Google Authenticator, Microsoft
Authenticator, 1Password and others all work. From then on, signing in asks for
the app's 6-digit code after the password.

- You get 10 **recovery codes** when you turn it on. Each one signs you in once
  if you lose your phone. Save them somewhere safe.
- An admin can require it for everyone (**Settings → People**). Anyone signed in
  without it is signed out, and sets it up the next time they sign in.
- If someone loses their phone and their recovery codes, an admin can turn their
  two-step sign-in off (**People → Edit**) so they can set it up again.
- **Locked out as the only admin?** Set `HEARTHBOARD_ADMIN_PASSWORD` to a new
  password and `HEARTHBOARD_RESET_ADMIN: "1"` in the container's environment,
  then restart it. The `admin` user gets that password with two-step sign-in
  off. Then remove `HEARTHBOARD_RESET_ADMIN` again.

### Pairing a TV or tablet

A screen that isn't paired shows **Pair this screen** and a short code, such as
`K7QM-4TWX`, instead of the board. To pair it:

1. On the screen, open `http://<nas-ip>:8080/`. It shows the code.
2. On your phone or PC, go to **Settings → Displays**, type the code, give the
   screen a name (_Kitchen TV_) and press **Pair**.
3. The screen loads the board by itself within a few seconds, and stays paired.

Codes are good for 10 minutes; the screen shows a fresh one when one runs out.
If typing is a bother, **Pair with a link instead** makes a link you open once
on the screen. Under **Displays** you can rename a screen or remove it, which
turns it away at once. A paired screen keeps a cookie in its browser, so pair
it in the browser or app that will show the board, and don't run that browser in
private or incognito mode.

Signed-in people always see boards on their own devices, paired or not. If you'd
rather not pair screens, **Settings → Displays → Show boards on any device**
brings back the old behavior, where anyone who can reach Hearthboard can see
your boards. That includes the internet if you've published it, so leave it off
unless the network is yours alone. It's also what a board shown in a frame on
another site needs (`HEARTHBOARD_EMBED_ORIGINS`, for example in Home Assistant):
browsers don't send the pairing cookie to a frame of a different site.

**Upgrading?** Boards used to be visible to any device. After updating, each
screen shows a code until you pair it once. Nothing else changes for people who
sign in.

### Upgrading from the admin PIN

Earlier versions had a single admin PIN. After upgrading, sign in with the
username **`admin`** and your old PIN as the password; that user owns all your
existing boards. Then change the password (**Settings → My account**), rename
yourself if you like (**Settings → People → Edit**), and add the rest of the
family. Every device is signed
out once by the upgrade.

## Configuration

Accounts and settings live in the web app under **Settings**, not in Docker:

- **My account:** your password, two-step sign-in, signing out.
- **People** (admins): add, change and remove people; require two-step
  sign-in.
- **General** (admins): time zone, how often calendars sync, and the public
  HTTPS address used for Google sign-in.
- **Calendars, Apple Reminders, Photos** (admins): every account sign-in,
  calendar subscriptions (holidays, school, sports), and which calendars
  family members can add and change events on.
- **Checklists, Verses & quotes** (everyone).

Notes and the meal plan live on the **Family** page.

They're stored in `/data` and survive container updates. The time zone
starts as the one of the device you created the first account on.

Docker only needs what the container itself requires:

| Variable                     | Default         | Meaning                                                                                                                                              |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUID` / `PGID`              | `1000` / `1000` | User and group the server runs as (Synology: usually `1026` / `100`).                                                                                |
| `PORT`                       | `8080`          | HTTP port.                                                                                                                                           |
| `HEARTHBOARD_DATA`           | `/data`         | Database, encryption key and image cache.                                                                                                            |
| `HEARTHBOARD_PHOTOS`         | `/photos`       | Photo folder (mount it read-only).                                                                                                                   |
| `HEARTHBOARD_SECRET`         | (generated)     | Key for encrypting stored credentials. By default one is generated in `/data/secret.key`.                                                            |
| `HEARTHBOARD_DEMO`           | (off)           | `1` loads sample calendars, reminders and photos.                                                                                                    |
| `HEARTHBOARD_ADMIN_PASSWORD` | (none)          | Optional. On first start, create an `admin` user with this password instead of setting one up on first visit. Ignored once anyone has signed up.     |
| `HEARTHBOARD_RESET_ADMIN`    | (off)           | Recovery only: `1` resets the `admin` user to `HEARTHBOARD_ADMIN_PASSWORD` with two-step sign-in off, on every start. Remove it once you're back in. |
| `HEARTHBOARD_TRUST_PROXY`    | (off)           | Behind a reverse proxy (e.g. DSM's, for HTTPS): the proxy's address or `true`, so sign-in lockouts and pairing limits see each device's own address. |
| `HEARTHBOARD_EMBED_ORIGINS`  | (none)          | Optional. Sites allowed to show the board in a frame, such as a Home Assistant dashboard: `http://homeassistant.local:8123`.                         |
| `HEARTHBOARD_ALLOWED_HOSTS`  | (none)          | Extra names the server answers to, comma-separated (see below). `*.example.com` includes subdomains; `*` turns the check off.                        |

Older compose files that still set `TZ`, `HEARTHBOARD_SYNC_INTERVAL` or
`HEARTHBOARD_PUBLIC_URL` keep working: those values are used only until you
change the setting in the web app, and can be removed. `HEARTHBOARD_PIN` works
like `HEARTHBOARD_ADMIN_PASSWORD`.

Hearthboard only answers to the addresses a home network normally uses: IP
addresses, `localhost`, one-word names like `diskstation`, names ending in
`.local`, `.lan`, `.home.arpa`, `.internal` or `.localdomain`, and the public
HTTPS address saved under **Settings → General**. That stops a web page someone
visits from reading your board through your NAS (a trick called DNS
rebinding). If you reach the board by another name, add it to
`HEARTHBOARD_ALLOWED_HOSTS`. A browser that uses an unknown name is told which
one, and you can always open the board by IP address instead.

## Themes and text sizes

Pick a theme and a text size under **Layout → Board**. Each widget can also
override the text size in its own settings.

Themes: Ember (dark, the default), Linen (light), Midnight, Forest, Sunrise,
Slate and High contrast. Text sizes: Extra small, Small, Medium, Large, Extra
large.

All of them live in [`shared/src/themes.ts`](shared/src/themes.ts). To change a
theme, edit its colors there. To add one, copy an entry and give it a new key;
it shows up in Board settings and is accepted by the API with no other changes.
Text sizes work the same way (`scale: 1` is the original size). Boards that
point at a theme or size you later remove fall back to the defaults.

## How it works

```
 iPhone Shortcut ──POST reminders──┐
                                   ▼
 iCloud (CalDAV) ◀──two-way──▶  ┌──────────────────────────┐ ◀──WebSocket── TV / tablet  (/)
 Google Calendar ◀──two-way──▶  │  Hearthboard (Node.js)   │ ◀──HTTP─────── phone / PC   (/edit, /calendar, /family, /settings)
 .ics / webcal ───read-only──▶  │  SQLite in /data         │
 Open-Meteo ──────read-only──▶  │                          │
 Synology Photos ──read-only──▶ │                          │
 /photos (ro mount) ──────────▶ └──────────────────────────┘
```

- **Server:** Fastify and SQLite (`better-sqlite3`), written in TypeScript.
  Calendars are polled into a local cache, so the board stays fast and keeps
  working if the internet drops. Writes go straight to iCloud or Google with
  ETag checks, so a change made on a phone is never silently overwritten.
  Every change is pushed to open screens over a WebSocket.
- **Calendars:**
  - iCloud and other CalDAV servers use `tsdav` and `ical.js`: recurring
    events, exceptions and time zones are expanded and edited in iCalendar
    itself.
  - Google uses the Calendar API with incremental sync tokens.
  - Subscribed `.ics` feeds are downloaded at most every 15 minutes (with
    `If-None-Match`) and split into one stored event per UID, so they go through
    the same expansion code as CalDAV.
- **Weather:** Open-Meteo, fetched by the server and cached for 15 minutes per
  place, so every screen shares one request.
- **Web:** React, [react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)
  for the board and [FullCalendar](https://fullcalendar.io/) (MIT plugins)
  for the calendar. A board is designed for one resolution (e.g. 1920×1080)
  and scaled to fit whatever screen shows it.
- **Security:**
  - Passwords and tokens are encrypted at rest (AES-256-GCM).
  - Passwords are hashed with scrypt, and sign-in attempts are rate-limited.
  - Two-step sign-in uses standard TOTP (RFC 6238) codes, each accepted once.
    Authenticator secrets are encrypted at rest, and recovery codes are stored
    hashed.
  - Sessions are stored hashed. Changing a password or turning on two-step
    sign-in signs out your other devices.
  - Boards, calendars, photos and the live connection are shown only to signed-in
    people and to screens an admin has paired. A paired screen holds a random
    token in a cookie (stored hashed, like sessions) that an admin can revoke.
  - The reminders endpoint uses its own token.
  - The container runs as your user, and the photo mount is read-only.

Adding a new widget type takes one component in `web/src/widgets/`, one entry
in `web/src/widgets/registry.tsx`, and a config schema in
`shared/src/widgets.ts`.

## Development

Requires Node 22.

```sh
npm install
npm run dev:demo        # server on :8080 with sample data, Vite on :5173
```

Open <http://localhost:5173/edit>. Other scripts:

```sh
npm test                # unit + API tests (pip install radicale to include the CalDAV integration tests)
npm run build           # web + server bundle, then: npm start
npm run test:e2e        # Playwright end-to-end tests (after npm run build)
npm run lint && npm run typecheck && npm run format:check
docker build -t hearthboard .
```

The end-to-end tests share one demo server, so they run one at a time.

Repository layout: `shared/` (types and schemas used by both sides),
`server/` (API, sync, providers), `web/` (the React app), `e2e/`
(Playwright) and `docs/` (setup guides).

## Limitations

- **Apple Reminders:** they only update when the iPhone Shortcut runs, and
  the phone must be on your home network (or a VPN) to reach the NAS.
- **Calendar range:** the board caches from about 3 months back to about 13
  months ahead.
- **Subscribed calendars:** iCloud _subscribed_ calendars (holiday and sports
  feeds) aren't available over CalDAV. Add them by their `webcal://` address
  instead, under **Settings → Calendars → Subscribe to a calendar**. They're
  read-only on the board.
- **Weather** needs the NAS to reach `api.open-meteo.com`. Keeping a tablet
  awake from the browser needs HTTPS.
- **Photos:** HEIC photos show only once Synology Photos has generated their
  previews. The Synology Photos album mode needs a DSM account without 2-factor
  sign-in.

## License

[MIT](LICENSE)

## Scripture copyright

Scripture quotations are from the ESV® Bible (The Holy Bible, English Standard
Version®), © 2001 by Crossway, a publishing ministry of Good News Publishers.
Used by permission. All rights reserved.
