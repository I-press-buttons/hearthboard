# Connecting Apple iCloud Calendar

Hearthboard talks to iCloud over CalDAV, the same way Thunderbird or a
Windows calendar app would. Events you create, drag, resize or edit on the
board are written to iCloud, and changes made on your iPhone, iPad or Mac show
up on the board within a minute (change how often under Settings → General).

## 1. Make an app-specific password

Apple doesn't let other apps sign in with your normal password.

1. Go to [account.apple.com](https://account.apple.com) and sign in.
2. **Sign-In and Security → App-Specific Passwords → +**.
3. Name it `Hearthboard` and copy the password (`xxxx-xxxx-xxxx-xxxx`).

Two-factor authentication must be on for your Apple ID, which it is for almost
everyone.

## 2. Add it to Hearthboard

**Settings → Calendars → Add iCloud**, then enter:

- **Apple ID:** the email address you sign in to iCloud with
- **App-specific password:** the one you just made

Hearthboard lists your iCloud calendars straight away. Untick any you don't
want on the board, and pick colours with the colour swatches.

To add another family member's iCloud calendars, repeat with their Apple ID
and their own app-specific password. Calendars they have _shared with you_ in
iCloud already appear under your account.

## Good to know

- **Which calendars can be edited?** Your own calendars, and shared calendars
  where you have edit rights. _Subscribed_ calendars (holidays, sports
  schedules) aren't served over CalDAV and won't appear.
- **Repeating events:** when you drag one occurrence, the board asks whether
  to move **only this one** or **all events**. "Only this one" creates a normal
  iCloud exception, exactly as the Calendar app does. "All events" moves the
  whole series by the same amount and keeps its time zone, so a weekly 9 am
  meeting stays at 9 am across daylight-saving changes.
- **Conflicts:** if an event changed on your phone after the board last synced,
  saving on the board is refused rather than overwriting it. The board
  refreshes and you can try again.
- **Time range:** the board keeps events from about 3 months back to about 13
  months ahead.
- **Other CalDAV calendars** (Synology Calendar, Nextcloud, Fastmail) work the
  same way through **Add other CalDAV**. Synology Calendar shows its CalDAV
  address under Synology Calendar → Settings → CalDAV Account. Use its
  `https://` address when it has one, so your password is encrypted.
- **If the password stops working:** Hearthboard stops syncing that account
  instead of trying the wrong password over and over, which could get your
  Apple ID locked. The account shows **paused** under Settings → Calendars. If
  the password changed, remove the account and add it again with a new
  app-specific password; otherwise press **Sync now** to try once more. Other
  problems (for example the server being down) are retried automatically, a
  little less often each time, and the account shows when the next try is.

To disconnect, remove the account in Settings and revoke the app-specific
password at account.apple.com.
