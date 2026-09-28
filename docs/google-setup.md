# Connecting Google Calendar

Google only lets apps it knows about read your calendar, so Hearthboard uses
your own free Google Cloud "OAuth client". It takes about 10 minutes, once.
Nothing is published and it costs nothing.

## 1. Create the OAuth client

1. Open the [Google Cloud console](https://console.cloud.google.com/) and
   create a project (top bar → project picker → **New project**, e.g.
   `Hearthboard`).
2. **APIs & Services → Library**, search **Google Calendar API**, click
   **Enable**.
3. **APIs & Services → OAuth consent screen** (called _Google Auth Platform_
   in newer consoles):
   - User type **External**, app name `Hearthboard`, your email as support and
     developer contact.
   - Scopes: you can skip this page.
   - Test users: add the Google account(s) whose calendars you want on the
     board.
   - Afterwards, under **Audience** / **Publishing status**, click **Publish
     app** to move it to **In production**. This matters: while the app is in
     _Testing_, Google signs the board out every 7 days. You don't need to
     submit it for verification.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**
   - Name: `Hearthboard`
   - Copy the **Client ID** and **Client secret**.

## 2. Connect in Hearthboard

1. **Settings → Calendars → Add Google**, paste the client ID and secret,
   and click **Next**.
2. Click **Open Google sign-in**, choose your account and allow calendar
   access. Google warns that it _hasn't verified this app_: that's your own
   client, so click **Advanced → Go to Hearthboard**.
3. Google then sends your browser to an address starting with
   `http://127.0.0.1:53682/` that **fails to load**. That's expected (it's
   your own computer, not the NAS). Copy the **whole address** from the
   address bar, paste it into Hearthboard, and click **Finish**.

Your Google calendars appear. Untick the ones you don't want on the board.

Repeat for each Google account. You can reuse the same client ID and secret;
just add each account as a test user in step 1.3 first.

### Skipping the copy-and-paste

If you reach Hearthboard over HTTPS with a real domain name (for example DSM's
reverse proxy with a Let's Encrypt certificate for `board.you.synology.me`):

1. Set `HEARTHBOARD_PUBLIC_URL: "https://board.you.synology.me"` in the compose
   file.
2. Make the OAuth client a **Web application** instead of a Desktop app, and
   add `https://board.you.synology.me/api/google/callback` as an authorized
   redirect URI.

Google then sends you straight back to Settings.

## Good to know

- Editing works on calendars where your Google account is an _owner_ or has
  _make changes_ access. Others appear as read-only.
- Moving one occurrence of a repeating event changes just that occurrence.
  **All events** shifts the whole series and keeps its time zone.
- If Google access expires or is revoked, the account shows an error in
  Settings. Remove it and connect again.
- To disconnect completely, remove the account in Settings and revoke access
  at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
