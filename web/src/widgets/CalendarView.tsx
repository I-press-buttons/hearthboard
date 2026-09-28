import { useEffect, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import type {
  DateSelectArg,
  EventChangeArg,
  EventClickArg,
  EventInput as FcEvent,
  EventSourceFuncArg,
  ToolbarInput,
} from '@fullcalendar/core';
import type { EventDTO } from '@hearthboard/shared';
import { api, qs } from '../api';
import { useLive } from '../live';

export function fetchEvents(start: Date | string, end: Date | string, calendarIds: string[] = []) {
  const iso = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString());
  return api.get<EventDTO[]>(
    `/api/events${qs({ start: iso(start), end: iso(end), calendars: calendarIds.join(',') })}`,
  );
}

export function toFullCalendar(e: EventDTO, editable: boolean): FcEvent {
  return {
    id: e.id,
    title: e.title,
    start: e.start,
    end: e.end,
    allDay: e.allDay,
    backgroundColor: e.color,
    borderColor: e.color,
    textColor: '#15110b',
    editable: editable && e.editable,
    extendedProps: { dto: e },
  };
}

interface Props {
  view: 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';
  calendarIds?: string[];
  editable?: boolean;
  showWeekends?: boolean;
  toolbar?: ToolbarInput | false;
  onSelect?: (arg: DateSelectArg) => void;
  onEventClick?: (dto: EventDTO) => void;
  onEventChange?: (arg: EventChangeArg, dto: EventDTO) => void;
}

/** FullCalendar wired to /api/events, live-refreshing when calendars sync. */
export function CalendarView({
  view,
  calendarIds = [],
  editable,
  showWeekends = true,
  toolbar,
  onSelect,
  onEventClick,
  onEventChange,
}: Props) {
  const ref = useRef<FullCalendar>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const idsKey = calendarIds.join(',');

  useLive(['events', 'calendars'], () => ref.current?.getApi().refetchEvents());

  useEffect(() => {
    ref.current?.getApi().refetchEvents();
  }, [idsKey]);

  useEffect(() => {
    ref.current?.getApi().changeView(view);
  }, [view]);

  // FullCalendar only watches window resizes; widgets resize (and animate) on their own.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => ref.current?.getApi().updateSize());
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Roll over to the new day at midnight on an always-on display.
  useEffect(() => {
    let day = new Date().toDateString();
    const t = setInterval(() => {
      const now = new Date().toDateString();
      if (now !== day) {
        day = now;
        ref.current?.getApi().today();
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fc-wrap" ref={wrap}>
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView={view}
        height="100%"
        headerToolbar={toolbar ?? { left: 'title', center: '', right: '' }}
        weekends={showWeekends}
        nowIndicator
        dayMaxEvents
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        scrollTime="07:00:00"
        eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        editable={!!editable}
        selectable={!!editable}
        selectMirror
        longPressDelay={350}
        eventDurationEditable={!!editable}
        events={(info: EventSourceFuncArg, success, failure) => {
          fetchEvents(info.start, info.end, idsKey ? idsKey.split(',') : []).then(
            (evts) => success(evts.map((e) => toFullCalendar(e, !!editable))),
            failure,
          );
        }}
        select={onSelect}
        eventClick={(arg: EventClickArg) => {
          arg.jsEvent.preventDefault();
          onEventClick?.(arg.event.extendedProps.dto as EventDTO);
        }}
        eventChange={(arg: EventChangeArg) =>
          onEventChange?.(arg, arg.event.extendedProps.dto as EventDTO)
        }
      />
    </div>
  );
}
