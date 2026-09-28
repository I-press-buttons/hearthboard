# Showing Apple Reminders on the board

Since iOS 13, Apple keeps Reminders in a format other apps can't read over
iCloud. The workaround is a small **Shortcut** on your iPhone that sends your
open reminders to Hearthboard, plus an **automation** that runs it for you.
Build it once; it takes about 5 minutes.

You'll need two things from **Settings → Apple Reminders** in Hearthboard:

- the **URL**, e.g. `http://192.168.1.10:8080/api/reminders/ingest`
- the **token** (click _Show_)

## 1. Build the Shortcut

Open **Shortcuts → +** and name it `Send Reminders to Hearthboard`. Add these
actions in order:

1. **Find Reminders**
   - Add filter: **Is Completed** is **not** true (shown as _Is Not Completed_)
   - Sort by: **Due Date**, and leave _Limit_ off
2. **Repeat with Each** item in _Reminders_
   1. **Format Date**: _Due Date_ of _Repeat Item_ → Date Format **ISO 8601**,
      _Include Time_ on. (Reminders without a due date simply send nothing
      here.)
   2. **Format Date** again: _Creation Date_ of _Repeat Item_ → **ISO 8601**
   3. **Dictionary** with these keys (all type _Text_ unless noted):

      | Key        | Value                                  |
      | ---------- | -------------------------------------- |
      | `title`    | Repeat Item → **Title**                |
      | `list`     | Repeat Item → **List**                 |
      | `due`      | _Formatted Date_ from step 2.1         |
      | `created`  | _Formatted Date_ from step 2.2         |
      | `notes`    | Repeat Item → **Notes**                |
      | `flagged`  | Repeat Item → **Is Flagged** (Boolean) |
      | `priority` | Repeat Item → **Priority**             |

3. **End Repeat** (added automatically)
4. **Get Contents of URL**
   - URL: the URL from Settings
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <your token>` (the word _Bearer_, a
     space, then the token)
   - Request Body: **JSON**, with one field: key `reminders`, type **Array**,
     value **Repeat Results**

Run it once with ▶. The Reminders widget on the board fills in, and Settings
shows _Last received from the iPhone: just now_.

Only `title` is required. Hearthboard also accepts dates in the phone's own
format and booleans sent as _Yes_/_No_, so small differences in how you build
the dictionary are fine.

## 2. Run it automatically

**Shortcuts → Automation → + → Create Personal Automation**:

- **App** → _Reminders_ → **Is Closed** → Next → **Run Immediately** (turn
  off _Notify When Run_) → pick the Shortcut. This sends changes whenever you
  leave the Reminders app.
- Add a couple of **Time of Day** automations too (e.g. 7:00 and 16:00, Run
  Immediately). They catch reminders added by Siri, your Mac or another family
  member's shared list.

The phone has to be on your home Wi-Fi to reach the NAS (or on a VPN such as
Tailscale). When it isn't, the Shortcut fails quietly and the next run catches
up.

## 3. Optional: tick reminders off from the board

Ticking a reminder on the board doesn't change iCloud directly. The board
marks it _pending_ (faded and ticked), and the response to the next Shortcut
run lists it. To have the Shortcut complete it, add after **Get Contents of
URL**:

5. **Get Dictionary Value** for key `complete` in _Contents of URL_
6. **Repeat with Each** item in _Dictionary Value_
   1. **Get Dictionary Value** `title` from _Repeat Item_, and another for
      `list`
   2. **Find Reminders** where _Title_ is the title, _List_ is the list, and
      _Is Not Completed_, limit 1
   3. Mark the found reminder as completed. The action is called **Set Is
      Completed** / **Edit Reminder** / **Mark as Completed**, depending on
      your iOS version; set _Is Completed_ to on.
7. **End Repeat**

Once the phone stops reporting that reminder as open, the board drops it. If
you change your mind before the Shortcut runs, tap the tick again on the board
to cancel.

## Troubleshooting

- **401 error:** the `Authorization` header is missing or the token is wrong.
  Check for the space after `Bearer`. If you click _New token_ in Settings,
  update the Shortcut.
- **Nothing shows up:** check the board widget's _Lists_ setting (none
  selected = all lists), and that the Shortcut's Find Reminders isn't limited.
- **Wrong due times:** make sure both Format Date actions use ISO 8601 with
  time included.
