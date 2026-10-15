export const shanghaiDay = (at: Date) =>
  new Date(at.getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function dayBounds(at: Date) {
  const start = new Date(`${shanghaiDay(at)}T00:00:00+08:00`);
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}
export function scheduledSlot(now: Date, times: string[]) {
  return times
    .map((time) => {
      let at = new Date(`${shanghaiDay(now)}T${time}:00+08:00`);
      if (at > now) at = new Date(at.getTime() - 86400000);
      return { day: shanghaiDay(at), time, at };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
}
export function nextScheduledRun(times: string[], now = new Date()) {
  return new Date(
    Math.min(
      ...times.map((time) => {
        const at = new Date(`${shanghaiDay(now)}T${time}:00+08:00`);
        return at > now ? at.getTime() : at.getTime() + 86400000;
      }),
    ),
  );
}
