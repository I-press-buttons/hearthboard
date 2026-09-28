import { useState } from 'react';
import type { DateSelectArg, EventChangeArg } from '@fullcalendar/core';
import type { CalendarDTO, EventDTO } from '@hearthboard/shared';
import { api } from '../api';
import { Modal, TopBar } from '../components/TopBar';
import { useLiveQuery } from '../live';
import { CalendarView } from '../widgets/CalendarView';

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO / Date -> value for <input type="datetime-local"> in local time. */
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(date: string, n: number) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateInput(d);
}

interface Draft {
  resourceId?: string;
  recurrenceId?: string | null;
  recurring?: boolean;
  calendarId: string;
  title: string;
  allDay: boolean;
  /** datetime-local or date strings; all-day end is inclusive here. */
  start: string;
  end: string;
  location: string;
  description: string;
}

function draftFromEvent(e: EventDTO): Draft {
  return {
    resourceId: e.resourceId,
    recurrenceId: e.recurrenceId,
    recurring: e.recurring,
    calendarId: e.calendarId,
    title: e.title,
    allDay: e.allDay,
    start: e.allDay ? e.start : toLocalInput(new Date(e.start)),
    end: e.allDay ? addDays(e.end, -1) : toLocalInput(new Date(e.end)),
    location: e.location ?? '',
    description: e.description ?? '',
  };
}

function draftTimes(d: Draft) {
  return d.allDay
    ? {
        start: d.start.slice(0, 10),
        end: addDays((d.end || d.start).slice(0, 10), 1),
        allDay: true,
      }
    : { start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), allDay: false };
}

function EventDialog({
  draft: initial,
  calendars,
  onClose,
}: {
  draft: Draft;
  calendars: CalendarDTO[];
  onClose: () => void;
}) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmScope, setConfirmScope] = useState<null | 'save' | 'delete'>(null);
  const isNew = !d.resourceId;
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const writable = calendars.filter((c) => c.writable && c.enabled);
  const readOnly = !isNew && !calendars.find((c) => c.id === d.calendarId)?.writable;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (scope: 'instance' | 'series' = 'instance') =>
    run(async () => {
      if (!d.title.trim()) throw new Error('Give the event a title.');
      const times = draftTimes(d);
      if (Date.parse(times.end) < Date.parse(times.start))
        throw new Error('The event ends before it starts.');
      if (isNew) {
        await api.post('/api/events', {
          calendarId: d.calendarId,
          title: d.title.trim(),
          location: d.location || null,
          description: d.description || null,
          ...times,
        });
      } else {
        const timeChanged =
          JSON.stringify(times) !== JSON.stringify(draftTimes(initial)) ||
          d.allDay !== initial.allDay;
        await api.patch(`/api/events/${d.resourceId}`, {
          recurrenceId: d.recurrenceId,
          scope,
          title: d.title.trim(),
          location: d.location || null,
          description: d.description || null,
          ...(timeChanged ? times : {}),
        });
      }
    });

  const remove = (scope: 'instance' | 'series' = 'instance') =>
    run(() => api.del(`/api/events/${d.resourceId}`, { recurrenceId: d.recurrenceId, scope }));

  if (confirmScope) {
    const act = confirmScope === 'save' ? save : remove;
    return (
      <Modal title="This is a repeating event" onClose={() => setConfirmScope(null)}>
        <p className="hint">
          {confirmScope === 'save' ? 'Change' : 'Delete'} only this one, or every occurrence?
        </p>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={() => setConfirmScope(null)}>
            Cancel
          </button>
          <button className="btn" disabled={busy} onClick={() => void act('series')}>
            All events
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void act('instance')}>
            Only this one
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isNew ? 'New event' : readOnly ? 'Event' : 'Edit event'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isNew && d.recurring) setConfirmScope('save');
          else void save();
        }}
      >
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            autoFocus
            value={d.title}
            disabled={readOnly}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Calendar</span>
          <select
            value={d.calendarId}
            disabled={!isNew}
            onChange={(e) => set({ calendarId: e.target.value })}
          >
            {(isNew ? writable : calendars).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{' '}
                {c.provider === 'google'
                  ? '(Google)'
                  : c.provider === 'caldav'
                    ? '(iCloud/CalDAV)'
                    : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>All day</span>
          <input
            type="checkbox"
            checked={d.allDay}
            disabled={readOnly}
            onChange={(e) => {
              const allDay = e.target.checked;
              const s = new Date(d.start.length === 10 ? d.start + 'T09:00' : d.start);
              const en = new Date(d.end.length === 10 ? d.end + 'T10:00' : d.end);
              set(
                allDay
                  ? { allDay, start: toDateInput(s), end: toDateInput(en) }
                  : {
                      allDay,
                      start: toLocalInput(s),
                      end: toLocalInput(new Date(Math.max(en.getTime(), s.getTime() + 3600_000))),
                    },
              );
            }}
          />
        </label>
        <div className="row">
          <label className="field grow">
            <span>Starts</span>
            <input
              type={d.allDay ? 'date' : 'datetime-local'}
              value={d.start}
              disabled={readOnly}
              onChange={(e) => set({ start: e.target.value })}
            />
          </label>
          <label className="field grow">
            <span>Ends</span>
            <input
              type={d.allDay ? 'date' : 'datetime-local'}
              value={d.end}
              disabled={readOnly}
              onChange={(e) => set({ end: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>Location</span>
          <input
            type="text"
            value={d.location}
            disabled={readOnly}
            onChange={(e) => set({ location: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea
            rows={3}
            value={d.description}
            disabled={readOnly}
            onChange={(e) => set({ description: e.target.value })}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          {!isNew && !readOnly && (
            <button
              type="button"
              className="btn danger"
              disabled={busy}
              onClick={() =>
                d.recurring
                  ? setConfirmScope('delete')
                  : confirm('Delete this event?') && void remove()
              }
            >
              Delete
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? 'Close' : 'Cancel'}
          </button>
          {!readOnly && (
            <button className="btn primary" disabled={busy || (isNew && !writable.length)}>
              {isNew ? 'Add' : 'Save'}
            </button>
          )}
        </div>
        {isNew && !writable.length && <p className="hint">Connect a calendar in Settings first.</p>}
      </form>
    </Modal>
  );
}

type View = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

/** Full-screen interactive calendar: drag to move, stretch to resize, select to create. */
export function CalendarPage() {
  const { data: calendars } = useLiveQuery(
    ['calendars'],
    () => api.get<CalendarDTO[]>('/api/calendars'),
    [],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingMove, setPendingMove] = useState<{ arg: EventChangeArg; dto: EventDTO } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [lastCal, setLastCal] = useState<string>(
    () => localStorage.getItem('hb:lastCalendar') ?? '',
  );
  const narrow = window.innerWidth < 700;
  const initialView: View = narrow ? 'listWeek' : 'timeGridWeek';

  const defaultCalendar = () => {
    const w = (calendars ?? []).filter((c) => c.writable && c.enabled);
    return (w.find((c) => c.id === lastCal) ?? w[0])?.id ?? '';
  };

  const newDraft = (start: Date, end: Date, allDay: boolean): Draft => ({
    calendarId: defaultCalendar(),
    title: '',
    allDay,
    start: allDay ? toDateInput(start) : toLocalInput(start),
    end: allDay ? addDays(toDateInput(end), -1) : toLocalInput(end),
    location: '',
    description: '',
  });

  const onSelect = (arg: DateSelectArg) => {
    arg.view.calendar.unselect();
    setDraft(newDraft(arg.start, arg.end, arg.allDay));
  };

  const applyMove = async (arg: EventChangeArg, dto: EventDTO, scope: 'instance' | 'series') => {
    const e = arg.event;
    const allDay = e.allDay;
    const start = allDay ? e.startStr.slice(0, 10) : e.start!.toISOString();
    const end = e.end
      ? allDay
        ? e.endStr.slice(0, 10)
        : e.end.toISOString()
      : allDay
        ? addDays(start, 1)
        : new Date(e.start!.getTime() + 3600_000).toISOString();
    try {
      await api.patch(`/api/events/${dto.resourceId}`, {
        recurrenceId: dto.recurrenceId,
        scope,
        start,
        end,
        allDay,
      });
      setError(null);
    } catch (err) {
      arg.revert();
      setError((err as Error).message);
    }
  };

  return (
    <div className="app">
      <TopBar active="calendar">
        <span className="spacer" />
        <button
          className="btn primary"
          onClick={() => {
            const s = new Date();
            s.setMinutes(0, 0, 0);
            s.setHours(s.getHours() + 1);
            setDraft(newDraft(s, new Date(s.getTime() + 3600_000), false));
          }}
        >
          + Event
        </button>
      </TopBar>
      {error && (
        <div className="error-text" style={{ padding: '6px 14px' }} onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="calendar-page">
        <div className="cal">
          <CalendarView
            view={initialView}
            editable
            toolbar={{
              left: 'prev,next today',
              center: 'title',
              right: narrow
                ? 'listWeek,timeGridDay,dayGridMonth'
                : 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
            }}
            onSelect={onSelect}
            onEventClick={(dto) => setDraft(draftFromEvent(dto))}
            onEventChange={(arg, dto) =>
              dto.recurring ? setPendingMove({ arg, dto }) : void applyMove(arg, dto, 'instance')
            }
          />
        </div>
      </div>
      {draft && calendars && (
        <EventDialog
          draft={draft}
          calendars={calendars}
          onClose={() => {
            if (draft.calendarId) {
              localStorage.setItem('hb:lastCalendar', draft.calendarId);
              setLastCal(draft.calendarId);
            }
            setDraft(null);
          }}
        />
      )}
      {pendingMove && (
        <Modal
          title="Move a repeating event"
          onClose={() => {
            pendingMove.arg.revert();
            setPendingMove(null);
          }}
        >
          <p className="hint">
            Move only this occurrence, or shift every occurrence by the same amount?
          </p>
          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                pendingMove.arg.revert();
                setPendingMove(null);
              }}
            >
              Cancel
            </button>
            <button
              className="btn"
              onClick={() => {
                void applyMove(pendingMove.arg, pendingMove.dto, 'series');
                setPendingMove(null);
              }}
            >
              All events
            </button>
            <button
              className="btn primary"
              onClick={() => {
                void applyMove(pendingMove.arg, pendingMove.dto, 'instance');
                setPendingMove(null);
              }}
            >
              Only this one
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
