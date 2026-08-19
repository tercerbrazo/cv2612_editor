/*
 * Pure parsers for the CV2612 firmware debug-serial stream (38400 baud).
 * One line per '\n', prefix = millis timestamp. Lines can arrive truncated
 * or garbled (serial glitches): every parser returns null on mismatch and
 * parseLine() falls back to a 'raw' entry so nothing is ever lost.
 *
 * Inline test harness (full suite: `node scripts/test-monitor-parser.mjs`):
 *   parseLine('12345 heartbeat loop:1127/s')
 *     → { type: 'heartbeat', t: 12345, loopRate: 1127 }
 *   parseLine('PATCH TL0/TL3: 28/15 58/45 88/75 118/105')
 *     → { type: 'patch', pairs: [[28,15],[58,45],[88,75],[118,105]] }
 *   parseLine('12345 [MONO] N:45 P:') → { type: 'raw', text: '...' }
 *   parseLine('') → null
 */

export type CvLine = {
  type: 'cv'
  t: number
  mode: string
  note: number
  pitchRaw: number // pitch ADC raw 0..1023
  pitchVolts: number
  pitchDev: number
  transpose: number
  tuning: number
  c: number
  cv: number // final cv
  pb: number // pitch bend
  f: number // raw firmware VF (Q6); for Hz use freqHz(cv), not this field
  x: number // mod CV inputs 0..255
  y: number
  z: number
  xConn: boolean // '*' = jack connected, '.' = disconnected
  yConn: boolean
  zConn: boolean
  k: number // main knob -128..127
  ax: number // attenuverters -128..127
  ay: number
  az: number
  modW: number // effective mod values
  modX: number
  modY: number
  modZ: number
  ccMask: number | null // per-axis CC hold mask (hex, optional)
  rgb: [number, number, number]
}

export type ModLine = {
  type: 'mod'
  t: number
  w: number
  x: number
  ax: number
  ay: number
  az: number
  k: number
  raw: number // X jack ADC 0..1023
  rawConn: boolean
  mm: number // modulation mode
  tl0: number // live morphed TL of ch0 op0
  tl3: number // live morphed TL of ch0 op3
}

export type PatchLine = {
  type: 'patch'
  pairs: [number, number][] // the 4 patches' raw TL0/TL3
}

export type HeartbeatLine = {
  type: 'heartbeat'
  t: number
  loopRate: number // main loop iterations per second
}

export type RawLine = {
  type: 'raw'
  text: string
}

export type ParsedLine = CvLine | ModLine | PatchLine | HeartbeatLine | RawLine

// No F->Hz helper on purpose: the Monitor derives Hz from cv via freqHz()
// (monitor-frames.ts), which needs no K. A local K copy here once drifted and
// hid a firmware octave bug — the single source is tools/pitch_constants.py.

const CV_RE =
  /^(\d+)\s+\[(\w+)\]\s+N:(-?\d+)\s+P:(\d+)\((-?[\d.]+)V\s+d:(-?\d+)\)\s+T:(-?\d+)\s+tu:(-?\d+)\s+C:(-?\d+)\s+CV:(-?\d+)\s+PB:(-?\d+)\s+F:(\d+)\s+\|\s+X:(\d+)([*.])\s+Y:(\d+)([*.])\s+Z:(\d+)([*.])\s+\|\s+K:(-?\d+)\s+aX:(-?\d+)\s+aY:(-?\d+)\s+aZ:(-?\d+)\s+\|\s+mod:(-?\d+),(-?\d+),(-?\d+),(-?\d+)(?:\s+CC:([0-9a-fA-F]+))?\s+\|\s+RGB:(\d+),(\d+),(\d+)\s*$/

const MOD_RE =
  /^(\d+)\s+MOD\s+w:(-?\d+)\s+x:(-?\d+)\s+ax:(-?\d+)\s+ay:(-?\d+)\s+az:(-?\d+)\s+K:(-?\d+)\s+raw:(\d+)([*.])\s+mm:(\d+)\s+TL0:(\d+)\s+TL3:(\d+)\s*$/

const PATCH_RE = /^PATCH TL0\/TL3:\s*((?:\d+\/\d+\s*)+)$/

const HEARTBEAT_RE = /^(\d+)\s+heartbeat\s+loop:(\d+)\/s\s*$/

export const parseCvLine = (line: string): CvLine | null => {
  const m = CV_RE.exec(line)
  if (!m) return null
  return {
    type: 'cv',
    t: Number(m[1]),
    mode: m[2],
    note: Number(m[3]),
    pitchRaw: Number(m[4]),
    pitchVolts: Number(m[5]),
    pitchDev: Number(m[6]),
    transpose: Number(m[7]),
    tuning: Number(m[8]),
    c: Number(m[9]),
    cv: Number(m[10]),
    pb: Number(m[11]),
    f: Number(m[12]),
    x: Number(m[13]),
    xConn: m[14] === '*',
    y: Number(m[15]),
    yConn: m[16] === '*',
    z: Number(m[17]),
    zConn: m[18] === '*',
    k: Number(m[19]),
    ax: Number(m[20]),
    ay: Number(m[21]),
    az: Number(m[22]),
    modW: Number(m[23]),
    modX: Number(m[24]),
    modY: Number(m[25]),
    modZ: Number(m[26]),
    ccMask: m[27] !== undefined ? Number.parseInt(m[27], 16) : null,
    rgb: [Number(m[28]), Number(m[29]), Number(m[30])],
  }
}

export const parseModLine = (line: string): ModLine | null => {
  const m = MOD_RE.exec(line)
  if (!m) return null
  return {
    type: 'mod',
    t: Number(m[1]),
    w: Number(m[2]),
    x: Number(m[3]),
    ax: Number(m[4]),
    ay: Number(m[5]),
    az: Number(m[6]),
    k: Number(m[7]),
    raw: Number(m[8]),
    rawConn: m[9] === '*',
    mm: Number(m[10]),
    tl0: Number(m[11]),
    tl3: Number(m[12]),
  }
}

export const parsePatchLine = (line: string): PatchLine | null => {
  const m = PATCH_RE.exec(line.trim())
  if (!m) return null
  const pairs = m[1]
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [a, b] = p.split('/')
      return [Number(a), Number(b)] as [number, number]
    })
  return { type: 'patch', pairs }
}

export const parseHeartbeatLine = (line: string): HeartbeatLine | null => {
  const m = HEARTBEAT_RE.exec(line)
  if (!m) return null
  return { type: 'heartbeat', t: Number(m[1]), loopRate: Number(m[2]) }
}

/*
 * Parse a single serial line. Returns null for empty lines,
 * a typed record when one of the known formats matches,
 * or a 'raw' record for anything else (shown verbatim in the event log).
 */
export const parseLine = (line: string): ParsedLine | null => {
  const text = line.replace(/\r/g, '').trim()
  if (text.length === 0) return null
  return (
    parseCvLine(text) ??
    parseModLine(text) ??
    parsePatchLine(text) ??
    parseHeartbeatLine(text) ?? { type: 'raw', text }
  )
}
