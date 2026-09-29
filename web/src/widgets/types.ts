import type { ComponentType } from 'react';
import type { Board, WidgetConfigs, WidgetInstance, WidgetType } from '@hearthboard/shared';
import type { WidgetSize } from '../board/BoardCanvas';

export interface WidgetProps<T extends WidgetType> {
  config: WidgetConfigs[T];
  size: WidgetSize;
  mode: 'display' | 'edit';
  widget: WidgetInstance;
  board: Board;
}

export type FieldSpec =
  | { key: string; label: string; type: 'bool' }
  | { key: string; label: string; type: 'text'; placeholder?: string }
  | {
      key: string;
      label: string;
      type: 'number';
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | { key: string; label: string; type: 'select'; options: [string, string][] }
  /** Several of a fixed set, shown as chips. */
  | { key: string; label: string; type: 'multi'; options: [string, string][] }
  /** `place` sets place, latitude and longitude together; `countdowns` edits a list of dates. */
  | { key: string; label: string; type: 'place' | 'countdowns' }
  | {
      key: string;
      label: string;
      type: 'calendars' | 'reminderLists' | 'checklist' | 'photoFolder' | 'album';
    };

export interface WidgetDef<T extends WidgetType = WidgetType> {
  type: T;
  label: string;
  icon: string;
  /** Draw without the panel background (photos). */
  bare?: boolean;
  Component: ComponentType<WidgetProps<T>>;
  fields: FieldSpec[];
  /** Hide a field depending on the current config. */
  showField?: (key: string, config: WidgetConfigs[T]) => boolean;
}
