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
  - `TZ`: your time zone, e.g. `America/New_York` or `Europe/London`
    ([list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones))
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
  first visit asks you to choose an admin PIN.
- **The wall display:** `http://<nas-ip>:8080/` on the screen that hangs on the
  wall.

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
  it.

Then go to **Layout** (`/edit`), drag widgets where you want them, and resize
them from their edges. The wall display updates immediately.

## Putting it on the wall

Any screen with a modern browser works. Open `http://<nas-ip>:8080/`, make the
browser full-screen, and stop the screen from sleeping:

- **Fire TV / Android TV:** a kiosk browser such as _Fully Kiosk Browser_, with
  the start URL set to the board and "Keep screen on" enabled.
- **Raspberry Pi + monitor:** `chromium --kiosk --noerrdialogs --incognito http://<nas-ip>:8080/`
- **iPad / tablet:** open the page in Safari, _Share → Add to Home Screen_, then
  set Auto-Lock to Never and use Guided Access.
- **Smart TV browsers** work too, but they often dim or close idle pages.

Turn on **Dim the screen at night** in the board settings to darken the
display between two times. The display also nudges itself a pixel or two
every few minutes to avoid burn-in, and reloads once a night to pick up
updates.

## Updating

Container Manager → **Project** → hearthboard → **Action → Build** (or
**Stop**, then **Image → Update**, then **Start**). Your settings stay in the
`data` folder. Open displays reload themselves when the server comes back.

## Backups

Everything lives in `docker/hearthboard/data`. Include it in Hyper Backup.
`data/secret.key` encrypts the stored passwords and tokens. Keep it with the
database, or you will need to reconnect your accounts after a restore.
