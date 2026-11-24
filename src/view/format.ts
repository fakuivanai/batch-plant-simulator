// Number and time formats shared by the views.

/** Simulated time as hours, minutes and seconds since the simulation started. */
export function formatClock(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}
