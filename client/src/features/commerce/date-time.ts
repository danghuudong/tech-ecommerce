// datetime-local has no time zone. These forms always collect Vietnam time.
// Keep seconds and milliseconds so editing evidence never rounds it down.
export function vietnamDateInput(value: string | Date = new Date()) {
  return new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, -1)
}

export function inputToIso(value: string) {
  return new Date(`${value}+07:00`).toISOString()
}

export function serverClockNow(serverTime: string, clockReceivedAt: number) {
  return new Date(
    Date.parse(serverTime) + Math.max(0, performance.now() - clockReceivedAt),
  )
}
