export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const rem = safe - minutes * 60;
  const whole = Math.floor(rem);
  const tenth = Math.min(9, Math.floor((rem - whole) * 10 + 1e-6));
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${tenth}`;
}
