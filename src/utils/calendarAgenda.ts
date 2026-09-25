export const calendarAgendaWindow = (now: Date) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 14);
  return { start: start.toISOString(), end: end.toISOString() };
};
