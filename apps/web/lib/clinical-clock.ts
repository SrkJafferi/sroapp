export function localParts(value: string | Date, timezone = 'Asia/Karachi') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (key: string) => parts.find((p) => p.type === key)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
}
export const CLINIC_TODAY = localParts(new Date()).date;
export function displayName(value: string) {
  return value.replace(/\bdemo\b\s*/gi, '').trim();
}
