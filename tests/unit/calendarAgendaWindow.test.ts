import { describe, expect, it } from 'vitest';

import { calendarAgendaWindow } from '../../src/utils/calendarAgenda';

describe('calendarAgendaWindow', () => {
  it('covers today and the next thirteen local dates', () => {
    const { start, end } = calendarAgendaWindow(new Date(2026, 8, 25, 11, 21));
    const startDate = new Date(start);
    const endDate = new Date(end);

    expect([
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
      startDate.getHours(),
    ]).toEqual([2026, 8, 25, 0]);
    expect([
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate(),
      endDate.getHours(),
    ]).toEqual([2026, 9, 9, 0]);
  });
});
