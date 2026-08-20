// Minimal structured logger: one JSON line per event to stdout/stderr, so
// production logs (Fly's log viewer, or anything that ships them onward) are
// line-delimited JSON instead of free-form strings. No dependency -- this
// app's log volume doesn't warrant pulling in pino.

type Level = 'info' | 'warn' | 'error'

function write(level: Level, event: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
}
