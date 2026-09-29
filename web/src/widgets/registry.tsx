import {
  parseWidgetConfig,
  textScale,
  type Board,
  type WidgetInstance,
  type WidgetType,
} from '@hearthboard/shared';
import type { WidgetSize } from '../board/BoardCanvas';
import { CalendarWidget } from './Calendar';
import { ChecklistWidget } from './Checklist';
import { ClockWidget } from './Clock';
import { CountdownWidget } from './Countdown';
import { MealsWidget } from './Meals';
import { NotesWidget } from './Notes';
import { PhotoWidget } from './Photo';
import { QuoteWidget } from './Quote';
import { RemindersWidget } from './Reminders';
import { WeatherWidget } from './Weather';
import type { WidgetDef, WidgetProps } from './types';

export const WIDGETS: { [K in WidgetType]: WidgetDef<K> } = {
  calendar: {
    type: 'calendar',
    label: 'Calendar',
    icon: '📅',
    Component: CalendarWidget,
    fields: [
      {
        key: 'view',
        label: 'View',
        type: 'select',
        options: [
          ['dayGridMonth', 'Month'],
          ['timeGridWeek', 'Week'],
          ['timeGridDay', 'Day'],
          ['listWeek', 'List (week)'],
          ['agenda', 'Agenda (next days, large text)'],
        ],
      },
      { key: 'agendaDays', label: 'Days in agenda', type: 'number', min: 1, max: 60 },
      { key: 'title', label: 'Title (agenda)', type: 'text', placeholder: 'e.g. Coming up' },
      { key: 'showWeekends', label: 'Show weekends', type: 'bool' },
      { key: 'calendarIds', label: 'Calendars (none selected = all)', type: 'calendars' },
    ],
    showField: (key, c) =>
      key === 'agendaDays' || key === 'title'
        ? c.view === 'agenda'
        : key === 'showWeekends'
          ? c.view !== 'agenda'
          : true,
  },
  clock: {
    type: 'clock',
    label: 'Clock',
    icon: '🕰️',
    Component: ClockWidget,
    fields: [
      { key: 'hour24', label: '24-hour time', type: 'bool' },
      { key: 'showSeconds', label: 'Show seconds', type: 'bool' },
      { key: 'showDate', label: 'Show date', type: 'bool' },
    ],
  },
  reminders: {
    type: 'reminders',
    label: 'Apple Reminders',
    icon: '🔔',
    Component: RemindersWidget,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'lists', label: 'Lists (none selected = all)', type: 'reminderLists' },
      { key: 'maxItems', label: 'Max items', type: 'number', min: 1, max: 100 },
      { key: 'showDue', label: 'Show due dates', type: 'bool' },
    ],
  },
  photo: {
    type: 'photo',
    label: 'Photos',
    icon: '🖼️',
    bare: true,
    Component: PhotoWidget,
    fields: [
      {
        key: 'source',
        label: 'Source',
        type: 'select',
        options: [
          ['folder', 'Photo folder on the NAS'],
          ['synology', 'Synology Photos album'],
        ],
      },
      { key: 'folder', label: 'Folder', type: 'photoFolder' },
      { key: 'albumId', label: 'Album', type: 'album' },
      {
        key: 'intervalSec',
        label: 'Change every',
        type: 'number',
        min: 5,
        max: 86400,
        suffix: 'seconds',
      },
      {
        key: 'fit',
        label: 'Fit',
        type: 'select',
        options: [
          ['cover', 'Fill (crop edges)'],
          ['contain', 'Fit (whole photo)'],
        ],
      },
      { key: 'kenBurns', label: 'Slow zoom (Ken Burns)', type: 'bool' },
      { key: 'showCaption', label: 'Show album/folder caption', type: 'bool' },
    ],
    showField: (key, c) =>
      key === 'folder' ? c.source === 'folder' : key === 'albumId' ? c.source === 'synology' : true,
  },
  quote: {
    type: 'quote',
    label: 'Verse / Quote',
    icon: '📖',
    Component: QuoteWidget,
    fields: [
      {
        key: 'mode',
        label: 'Show',
        type: 'select',
        options: [
          ['verse', 'Bible verse (ESV)'],
          ['quote', 'Quote'],
          ['both', 'Alternate verse and quote'],
          ['custom', 'My own entries (Settings)'],
        ],
      },
      {
        key: 'rotate',
        label: 'Change',
        type: 'select',
        options: [
          ['daily', 'Daily'],
          ['hourly', 'Hourly'],
        ],
      },
      {
        key: 'fontScale',
        label: 'Text size',
        type: 'number',
        min: 0.5,
        max: 3,
        step: 0.1,
        suffix: '×',
      },
    ],
  },
  checklist: {
    type: 'checklist',
    label: 'Checklist',
    icon: '✅',
    Component: ChecklistWidget,
    fields: [
      { key: 'checklistId', label: 'Checklist', type: 'checklist' },
      { key: 'hideDone', label: 'Hide finished items', type: 'bool' },
    ],
  },
  weather: {
    type: 'weather',
    label: 'Weather',
    icon: '⛅',
    Component: WeatherWidget,
    fields: [
      { key: 'place', label: 'Place', type: 'place' },
      {
        key: 'units',
        label: 'Units',
        type: 'select',
        options: [
          ['auto', 'Automatic'],
          ['f', '°F and mph'],
          ['c', '°C and km/h'],
        ],
      },
      { key: 'days', label: 'Days of forecast', type: 'number', min: 0, max: 7 },
    ],
  },
  countdown: {
    type: 'countdown',
    label: 'Countdown',
    icon: '⏳',
    Component: CountdownWidget,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'entries', label: 'Dates', type: 'countdowns' },
      {
        key: 'keyword',
        label: 'Also count down to calendar events whose title contains',
        type: 'text',
        placeholder: 'e.g. 🎉 or #countdown (leave empty for none)',
      },
      {
        key: 'unit',
        label: 'Count in',
        type: 'select',
        options: [
          ['days', 'Days'],
          ['sleeps', 'Sleeps (for the kids)'],
        ],
      },
      { key: 'maxItems', label: 'Show at most', type: 'number', min: 1, max: 30 },
    ],
  },
  meals: {
    type: 'meals',
    label: 'Meal plan',
    icon: '🍽️',
    Component: MealsWidget,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      {
        key: 'slots',
        label: 'Meals',
        type: 'multi',
        options: [
          ['breakfast', 'Breakfast'],
          ['lunch', 'Lunch'],
          ['dinner', 'Dinner'],
        ],
      },
      { key: 'days', label: 'Days', type: 'number', min: 1, max: 14 },
      {
        key: 'startOn',
        label: 'Start from',
        type: 'select',
        options: [
          ['today', 'Today'],
          ['week', 'The start of the week (Sunday)'],
        ],
      },
    ],
  },
  notes: {
    type: 'notes',
    label: 'Family notes',
    icon: '📝',
    Component: NotesWidget,
    fields: [
      { key: 'title', label: 'Title', type: 'text' },
      {
        key: 'style',
        label: 'Look',
        type: 'select',
        options: [
          ['sticky', 'Sticky notes'],
          ['list', 'A simple list'],
        ],
      },
      { key: 'maxItems', label: 'Show at most', type: 'number', min: 1, max: 30 },
    ],
  },
};

export function WidgetView({
  widget,
  size,
  mode,
  board,
  selected,
}: {
  widget: WidgetInstance;
  size: WidgetSize;
  mode: 'display' | 'edit';
  board: Board;
  selected?: boolean;
}) {
  const def = WIDGETS[widget.type] as unknown as WidgetDef;
  const config = parseWidgetConfig(widget.type, widget.config);
  const Component = def.Component as React.ComponentType<WidgetProps<WidgetType>>;
  const scale = textScale(board, widget);
  return (
    <div
      className={`widget ${def.bare ? 'bare' : ''} ${selected ? 'selected' : ''}`}
      style={{ fontSize: `${scale}em`, ['--text-scale' as string]: scale }}
    >
      {mode === 'edit' && (
        <div className="drag-handle" title={`Drag to move (${def.label})`}>
          ⠿{(selected || size.width > 220) && ` ${def.icon} ${def.label}`}
        </div>
      )}
      <Component config={config} size={size} mode={mode} widget={widget} board={board} />
    </div>
  );
}
