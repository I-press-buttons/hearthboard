/**
 * Quick add: turn a line like "Soccer Sat 9-10:30am @ Riverside Park" into an event.
 *
 * Understands, in any order:
 *  - days: today, tonight, tomorrow, day after tomorrow, weekdays ("fri", "this friday",
 *    "next friday"), "in 3 days", "in 2 weeks", "Oct 3", "3rd of October", "10/3", "2026-10-03",
 *    and day ranges like "Jul 14-18" (an all-day event over those days);
 *  - times: "7pm", "7:30 pm", "19:00", "at 7", "noon", "midnight", ranges like "3-4pm",
 *    "9am to 11:30", "from 3 to 5";
 *  - lengths: "for 2 hours", "for 30 min", "for an hour", "for 3 days";
 *  - "all day";
 *  - a place: "@ the park", or "at Grandma's" (after "at", a capitalized word or "the").
 *
 * Whatever is left becomes the title. No time means an all-day event. A time without a day means
 * today, or tomorrow if that time has already passed. Hours written without am/pm from 1 to 7
 * ("at 6", "6:30") are read as afternoon/evening; write "06:30" or "6:30am" for the morning.
 */

export interface QuickAddResult {
  title: string;
  location: string | null;
  allDay: boolean;
  /** Local time; midnight for all-day events. */
  start: Date;
  /** Exclusive end; for all-day events, midnight after the last day. */
  end: Date;
}

export interface QuickAddOptions {
  /** Read "3/10" as 3 October (day first) instead of March 10. */
  dayFirst?: boolean;
}

const MONTHS = [
  'jan(?:uary)?',
  'feb(?:ruary)?',
  'mar(?:ch)?',
  'apr(?:il)?',
  'may',
  'june?',
  'july?',
  'aug(?:ust)?',
  'sep(?:t(?:ember)?)?',
  'oct(?:ober)?',
  'nov(?:ember)?',
  'dec(?:ember)?',
];
const MONTH = `(${MONTHS.join('|')})\\.?`;
const WEEKDAYS = [
  'sun(?:day)?',
  'mon(?:day)?',
  'tue(?:s(?:day)?)?',
  'wed(?:nesday)?',
  'thu(?:r(?:s(?:day)?)?)?',
  'fri(?:day)?',
  'sat(?:urday)?',
];
const ORD = '(?:st|nd|rd|th)?';
const MER = '(a\\.?m\\.?|p\\.?m\\.?)';
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace('.', '');
  return MONTHS.findIndex((m) => new RegExp(`^(?:${m})$`).test(w));
}

function weekdayIndex(word: string): number {
  const w = word.toLowerCase();
  return WEEKDAYS.findIndex((d) => new RegExp(`^(?:${d})$`).test(w));
}

/** A real calendar date, or null for things like Feb 30. */
function makeDate(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function atMinutes(d: Date, mins: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, mins);
}

interface Clock {
  mins: number;
  /** Written with am/pm. */
  meridiem: 'am' | 'pm' | null;
}

/**
 * Parse one clock time. `loose` means no am/pm and no colon ("at 7", "from 3"); those and
 * colon times without a leading zero get the afternoon rule for hours 1–7.
 */
function clock(hStr: string, mStr: string | undefined, mer: string | undefined): Clock | null {
  const word = hStr.toLowerCase();
  if (word === 'noon') return { mins: 12 * 60, meridiem: 'pm' };
  if (word === 'midnight') return { mins: 0, meridiem: 'am' };
  let h = Number(hStr);
  const m = mStr ? Number(mStr) : 0;
  if (!Number.isInteger(h) || m > 59) return null;
  const meridiem = mer ? (mer.toLowerCase().startsWith('p') ? 'pm' : 'am') : null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridiem === 'pm' ? 12 : 0);
  } else {
    if (h > 23) return null;
    if (h >= 1 && h <= 7 && !hStr.startsWith('0')) h += 12;
  }
  return { mins: h * 60 + m, meridiem };
}

export function parseQuickAdd(
  input: string,
  now = new Date(),
  opts: QuickAddOptions = {},
): QuickAddResult | null {
  let rest = ` ${input.replace(/\s+/g, ' ').trim()} `;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  /** Run `re` over the remaining text; if `fn` accepts a match, cut it out. First accepted match wins. */
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    const g = new RegExp(re.source, 'gi');
    for (let m = g.exec(rest); m; m = g.exec(rest)) {
      if (fn(m)) {
        rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
        return true;
      }
      if (m[0] === '') g.lastIndex++;
    }
    return false;
  };

  // Set from inside the match callbacks below, hence the explicit types.
  let allDay = false as boolean;
  let date = null as Date | null;
  let lastDay = null as Date | null; // inclusive, for day ranges
  let startMins = null as number | null;
  let endMins = null as number | null;
  let durationMins = null as number | null;
  let durationDays = null as number | null;
  let tonight = false as boolean;

  take(/\sall[\s-]day(?=\s)/, () => (allDay = true));

  // Lengths: "for 2 hours", "for half an hour", "for 3 days".
  take(
    /\sfor\s+(half an|an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|days?|d)(?=[\s,.])/,
    (m) => {
      const n =
        m[1].toLowerCase() === 'half an' ? 0.5 : (NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]));
      if (!Number.isFinite(n) || n <= 0) return false;
      const unit = m[2].toLowerCase();
      if (unit.startsWith('d')) durationDays = Math.round(n);
      else if (unit.startsWith('h')) durationMins = Math.round(n * 60);
      else durationMins = Math.round(n);
      return true;
    },
  );

  // ---- days ----

  const setDate = (d: Date | null) => {
    if (!d) return false;
    date = d;
    return true;
  };
  /** Month/day without a year: this year, or next year if it has passed. */
  const upcoming = (month: number, day: number, year?: number) => {
    if (year) return makeDate(year, month, day);
    const d = makeDate(today.getFullYear(), month, day);
    if (d && d < today) return makeDate(today.getFullYear() + 1, month, day);
    return d;
  };

  const dayRules: (() => boolean)[] = [
    () =>
      take(/\s(?:on\s+)?(\d{4})-(\d{1,2})-(\d{1,2})(?=[\s,.])/, (m) =>
        setDate(makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))),
      ),
    // "Jul 14-18": several whole days.
    () =>
      take(
        new RegExp(
          `\\s(?:on\\s+|from\\s+)?${MONTH}\\s+(\\d{1,2})${ORD}\\s*(?:-|–|to|through|thru|until)\\s*(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?(?=[\\s,.])`,
        ),
        (m) => {
          const month = monthIndex(m[1]);
          const first = upcoming(month, Number(m[2]), m[4] ? Number(m[4]) : undefined);
          const last = first && makeDate(first.getFullYear(), month, Number(m[3]));
          if (!first || !last || last < first) return false;
          lastDay = last;
          return setDate(first);
        },
      ),
    () =>
      take(
        new RegExp(`\\s(?:on\\s+)?${MONTH}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?(?=[\\s,.])`),
        (m) => setDate(upcoming(monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)),
      ),
    () =>
      take(
        new RegExp(
          `\\s(?:on\\s+)?(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH}(?:,?\\s+(\\d{4}))?(?=[\\s,.])`,
        ),
        (m) => setDate(upcoming(monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined)),
      ),
    () =>
      take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?=[\s,.])/, (m) => {
        const [a, b] = [Number(m[1]), Number(m[2])];
        const [month, day] = opts.dayFirst ? [b, a] : [a, b];
        const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
        return setDate(upcoming(month - 1, day, year));
      }),
    () => take(/\s(?:the\s+)?day after tomorrow(?=[\s,.])/, () => setDate(addDays(today, 2))),
    () =>
      take(/\s(today|tonight|tomorrow|tomorow|tmrw|tmr)(?=[\s,.])/, (m) => {
        const w = m[1].toLowerCase();
        tonight = w === 'tonight';
        return setDate(w === 'today' || w === 'tonight' ? today : addDays(today, 1));
      }),
    () =>
      take(
        /\sin\s+(an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(days?|weeks?)(?=[\s,.])/,
        (m) => {
          const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
          return setDate(addDays(today, m[2].toLowerCase().startsWith('w') ? n * 7 : n));
        },
      ),
    () =>
      take(
        new RegExp(`\\s(?:(next|this|on|coming)\\s+)?(${WEEKDAYS.join('|')})(?=[\\s,.])`),
        (m) => {
          const dow = weekdayIndex(m[2]);
          let diff = (dow - today.getDay() + 7) % 7;
          if (m[1]?.toLowerCase() === 'next') diff = diff === 0 ? 7 : diff + 7;
          return setDate(addDays(today, diff));
        },
      ),
  ];
  dayRules.some((rule) => rule());

  // ---- times ----

  const T = `(\\d{1,2}|noon|midnight)(?::(\\d{2}))?\\s*${MER}?`;
  const timeRules: (() => boolean)[] = [
    () =>
      take(
        new RegExp(
          `\\s(from\\s+|at\\s+|@\\s*)?${T}\\s*(?:-|–|—|to|until|till|til)\\s*${T}(?=[\\s,.])`,
        ),
        (m) => {
          const [, prefix, h1, m1, mer1, h2, m2, mer2] = m;
          // "9-11" alone could be anything; want am/pm, a colon or "from"/"at".
          if (!prefix && !mer1 && !mer2 && !m1 && !m2 && !/[a-z]/i.test(h1 + h2)) return false;
          let start = clock(h1, m1, mer1);
          let end = clock(h2, m2, mer2);
          if (!start || !end) return false;
          if (!mer1 && end.meridiem && /^\d/.test(h1)) {
            // "3-4pm": the first time takes the second one's am/pm, unless that puts it after the end.
            const endAt = end.mins || 24 * 60;
            start = clock(h1, m1, end.meridiem);
            if (start && start.mins >= endAt)
              start = clock(h1, m1, end.meridiem === 'pm' ? 'am' : 'pm');
          } else if (!mer2 && start.meridiem && /^\d/.test(h2)) {
            // "9am-11:30": the end takes the start's am/pm, unless that puts it before the start.
            end = clock(h2, m2, start.meridiem);
            if (end && end.mins <= start.mins)
              end = clock(h2, m2, start.meridiem === 'pm' ? 'am' : 'pm');
          }
          if (!start || !end) return false;
          startMins = start.mins;
          endMins = end.mins;
          return true;
        },
      ),
    () =>
      take(new RegExp(`\\s(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*${MER}(?=[\\s,.])`), (m) => {
        const c = clock(m[1], m[2], m[3]);
        if (c) startMins = c.mins;
        return !!c;
      }),
    () =>
      take(/\s(?:at\s+|@\s*)?(\d{1,2}):(\d{2})(?=[\s,.])/, (m) => {
        const c = clock(m[1], m[2], undefined);
        if (c) startMins = c.mins;
        return !!c;
      }),
    () =>
      take(/\s(?:at\s+)?(noon|midnight)(?=[\s,.])/, (m) => {
        startMins = clock(m[1], undefined, undefined)!.mins;
        return true;
      }),
    () =>
      take(/\s(?:at|@)\s*(\d{1,2})(?=[\s,.])/, (m) => {
        const c = clock(m[1], undefined, undefined);
        if (c) startMins = c.mins;
        return !!c;
      }),
  ];
  timeRules.some((rule) => rule());

  // "Tonight at 8" is 8 in the evening.
  if (tonight && startMins !== null && startMins < 12 * 60) {
    startMins += 12 * 60;
    if (endMins !== null && endMins < 12 * 60) endMins += 12 * 60;
  }

  // ---- place ----

  let location: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    location = rest.slice(at + 1).trim() || null;
    rest = rest.slice(0, at);
  } else {
    // Case-sensitive on purpose: "at Grandma's", "at the park", but not "look at photos".
    const m = /\sat\s+((?:the\s|[A-Z0-9]).*)$/.exec(rest);
    if (m) {
      location = m[1].trim() || null;
      rest = rest.slice(0, m.index);
    }
  }

  // ---- title ----

  let title = rest.replace(/\s+/g, ' ').trim();
  const dangling =
    /^(?:on|at|from|for|by|,|-|–)\s+|\s+(?:on|at|from|for|by|the|,|-|–)$|^[,\-–]+|[,\-–]+$/i;
  for (let prev = ''; prev !== title;) {
    prev = title;
    title = title.replace(dangling, '').trim();
  }
  if (!title) return null;

  // ---- put it together ----

  if (tonight && startMins === null && !allDay) startMins = 19 * 60;
  if (startMins === null && durationMins !== null && !allDay) {
    // "Nap for an hour": from the next full hour.
    startMins = (now.getHours() + 1) * 60;
  }

  if (startMins !== null && !allDay && lastDay === null) {
    let day = date ?? today;
    if (!date && atMinutes(today, startMins) <= now) day = addDays(today, 1);
    const start = atMinutes(day, startMins);
    let end: Date;
    if (endMins !== null) {
      end = atMinutes(day, endMins);
      if (end <= start) end = atMinutes(addDays(day, 1), endMins); // e.g. 10pm-1am
    } else {
      end = new Date(start.getTime() + (durationMins ?? 60) * 60_000);
    }
    return { title, location, allDay: false, start, end };
  }

  const first = date ?? today;
  const days = lastDay
    ? Math.round((lastDay.getTime() - first.getTime()) / 86_400_000) + 1
    : (durationDays ?? 1);
  return { title, location, allDay: true, start: first, end: addDays(first, Math.max(1, days)) };
}
