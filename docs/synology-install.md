# Installing Hearthboard on a Synology NAS

Hearthboard runs as one Docker container. You need DSM 7.2 or later with
**Container Manager** installed (Package Center → Container Manager). Any
Synology model that runs Container Manager works: the image is built for
both Intel/AMD (`amd64`) and ARM (`arm64`) models.

## 1. Make a folder for it

In **File Station**, create `docker/hearthboard` (for example on `volume1`).
Hearthboard keeps its settings, layouts and the calendar cache in a `data`
folder inside it.

## 2. Find your user and group IDs

Hearthboard runs as your DSM user so it can read your photos and so the files
it writes belong to you. Enable SSH (Control Panel → Terminal & SNMP), connect
with `ssh you@nas-ip` and run:

```sh
id
# uid=1026(you) gid=100(users) groups=100(users),101(administrators)
```

Use the `uid` as `PUID` and the `gid` as `PGID` (usually `1026` and `100`).
You can turn SSH off again afterwards.

## 3. Create the project

Container Manager → **Project** → **Create**:

- **Project name:** `hearthboard`
- **Path:** the `docker/hearthboard` folder from step 1
- **Source:** _Create docker-compose.yml_, then paste the contents of
  [`docker-compose.yml`](../docker-compose.yml) and edit:
  - `PUID` / `PGID`: from step 2
  - the photos line: replace `YOUR_DSM_USER`. Synology Photos keeps your
    **Personal Space** in `/volume1/homes/<user>/Photos` and the **Shared
    Space** in `/volume1/photo`. The `:ro` at the end mounts it read-only;
    Hearthboard never changes your photos.

Click **Next** and **Done**. Container Manager pulls the image and starts it.

> **Image access.** The image is published to
> `ghcr.io/i-press-buttons/hearthboard`. While the GitHub repository is
> private, the image is private too: either make the package public (GitHub →
> your profile → Packages → hearthboard → Package settings → Change
> visibility), or add `ghcr.io` as a registry in Container Manager with a
> GitHub token that has `read:packages`. Alternatively, build it on the NAS:
> clone the repository into the project folder and replace the `image:` line
> with `build: .`.

## 4. Open it

- **Settings and layout:** `http://<nas-ip>:8080/edit` from a phone or PC. The
  first visit asks you to create your sign-in; you become the admin and can add
  the rest of the family under **Settings → People**. Then check **Settings →
  General**: the time zone starts as your phone's or PC's; change it there if
  needed, along with how often calendars sync.
- **The wall display:** `http://<nas-ip>:8080/` on the screen that hangs on the
  wall. The first time, it shows a code to pair it with (see
  [Pairing a TV](#pairing-a-tv) below).

If the DSM firewall is on, allow TCP port 8080 from your local network
(Control Panel → Security → Firewall).

Want to look around first? Add `HEARTHBOARD_DEMO: "1"` to the environment. It
fills in sample calendars, reminders and photos. Remove it (and delete the
`data` folder) before connecting your real accounts.

## 5. Connect your stuff

In **Settings** (`/settings`):

- **Apple iCloud Calendar:** see [icloud-setup.md](icloud-setup.md)
- **Google Calendar:** see [google-setup.md](google-setup.md)
- **Apple Reminders:** see [reminders-shortcut.md](reminders-shortcut.md)
- **Synology Photos albums (optional):** the mounted folder works without any
  setup. To show one specific album, enter a DSM account in the Photos section.
  Use a separate DSM user without 2-factor sign-in, and share the albums with
  it. Enter DSM's secure address, `https://<nas-ip>:5001`, so the password is
  encrypted on its way to the NAS. If DSM uses its own (self-signed)
  certificate, tick **Allow self-signed HTTPS certificate**. Hearthboard warns
  you if the address starts with `http://` (usually port 5000), which sends the
  password unencrypted across your network.

Then go to **Layout** (`/edit`), drag widgets where you want them, and resize
them from their edges. The wall display updates immediately.

## Putting it on the wall

Any screen with a modern browser works. Open `http://<nas-ip>:8080/`, pair it
(next section), make the browser full-screen, and stop the screen from
sleeping:

- **Fire TV / Android TV:** a kiosk browser such as _Fully Kiosk Browser_, with
  the start URL set to the board and "Keep screen on" enabled.
- **Raspberry Pi + monitor:** `chromium --kiosk --noerrdialogs http://<nas-ip>:8080/`
  (not `--incognito`: it forgets the pairing every time the browser closes)
- **iPad / tablet:** open the page in Safari, _Share → Add to Home Screen_, then
  set Auto-Lock to Never and use Guided Access. Turn on **Touch screen** in the
  board settings so the family can tick off chores and reminders on it without
  signing in ([details](features.md#8-touch-screen-mode-for-a-wall-tablet)).
- **Smart TV browsers** work too, but they often dim or close idle pages.

Tap the screen or move the mouse and a **⛶ Full screen** button appears for a
few seconds, in browsers that allow it. To show different boards at different
times of day on the same screen, see
[board schedules](features.md#9-board-schedules).

Turn on **Dim the screen at night** in the board settings to darken the
display between two times. The display also nudges itself a pixel or two
every few minutes to avoid burn-in, and reloads once a night to pick up
updates.

## Pairing a TV

Boards are private: only signed-in people and screens you've paired can see
them. A screen that isn't paired shows **Pair this screen** and a code such as
`K7QM-4TWX`, big enough to read from the sofa. You pair each screen once:

1. Open `http://<nas-ip>:8080/` on the TV. It shows the code.
2. On your phone or PC, open **Settings → Displays**, enter the code, name the
   screen (_Kitchen TV_) and press **Pair**.
3. Within a few seconds the TV shows the board. It stays paired, even after a
   restart.

Typing on a TV remote is painful, and that's why the code is short and the
letters are unmistakable (no `0`/`O` or `1`/`I`). The code runs out after 10
minutes and a new one appears by itself.

- **Pair it in the browser that will show the board.** The pairing is a cookie
  in that browser. A kiosk browser in private or incognito mode forgets it when
  it closes, and an iPad's Home Screen app keeps its own cookies apart from
  Safari's: open the Home Screen app and pair there.
- **Prefer a link to a code?** In **Displays**, choose **Pair with a link
  instead**, name the screen, and open the link it makes on the screen (paste it
  into the browser's address bar, or send it to the device). The link works
  once and runs out after a day.
- **Taking a screen away:** remove it under **Displays**. It's turned away at
  once and goes back to showing a code.
- **After updating from an earlier version,** each screen shows a code until you
  pair it once.
- **Don't want to pair anything?** Turn on **Show boards on any device** under
  **Displays**. Then anyone who can reach the NAS can see your calendar,
  reminders and photos without signing in, so only do it on a network you trust
  and don't publish the address to the internet.

## Updating

Container Manager → **Project** → hearthboard → **Action → Build** (or
**Stop**, then **Image → Update**, then **Start**). Your settings stay in the
`data` folder. Open displays reload themselves when the server comes back.

## Backups

Everything lives in `docker/hearthboard/data`. Include it in Hyper Backup.
`data/secret.key` encrypts the stored passwords and tokens. Keep it with the
database, or you will need to reconnect your accounts after a restore.
