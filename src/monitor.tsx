/*
 * Live hardware monitor for the CV2612 module.
 * Reads the firmware's debug-build serial stream (through the Arduino Uno's
 * USB-serial, 38400 baud) via the WebSerial API and renders scrolling strip
 * charts, a live-values sidebar, an event log, a MIDI stimuli panel and a
 * guided factory checklist. Chrome only, over localhost or https.
 *
 * The stream mixes two encodings: plain ASCII debug lines (DBG_CV / DBG_MOD /
 * heartbeat / PATCH) and the binary DBG_STATE frame protocol (20Hz state
 * keyframes + deltas + events + per-voice snapshots). A FrameDemux splits
 * the raw byte stream into
 * both; frames feed the charts and live values, text lines keep flowing to
 * the line parsers and the event log. Charts prefer DBG_CV lines, then
 * DBG_STATE frames, then DBG_MOD lines; sparse sources render step/hold.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { state as editorState } from './context'
import instrumentBank from './instruments.json'
import MidiIO from './midi-io'
import {
  centsEffectSeen,
  EFFECT_TIMEOUT_MS,
  evalPrecheck,
  type RestSample,
  STABILITY_PP_MAX,
  STABILITY_WINDOW_MS,
} from './monitor-calibration'
import {
  describeQuiet,
  describeSweep,
  evalNoteChange,
  evalQuiet,
  evalSweep,
  formatReport,
  type StepReport,
} from './monitor-checklist'
import {
  centsOffset,
  EVENT_KINDS,
  FIELD_BITS,
  FrameDemux,
  freqHz,
  type MonitorState,
  modeName,
  NUM_VOICES,
  pitchDevCents,
  QUANTIZE_NAMES,
  type ParsedFrame,
  type PatchFrame,
  SLOT_NAMES,
  unpackInstrumentEvent,
  type VoicesFrame,
} from './monitor-frames'
import { type CvLine, type ModLine, parseLine } from './monitor-parsers'
import {
  noteOff,
  noteOn,
  type Runner,
  runBendRamp,
  runNoteSweep,
  sendCaptureRests,
  sendCleanState,
  sendSinePatch,
  sendToggleDebug,
  TEST_NOTE_DEFAULT,
} from './monitor-stimuli'
import './monitor.sass'

// ---------------------------------------------------------------------------
// minimal WebSerial typings (not in the project's TS lib set)
// ---------------------------------------------------------------------------
type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
}
type SerialLike = {
  requestPort: () => Promise<SerialPortLike>
  getPorts: () => Promise<SerialPortLike[]>
}

const getSerial = (): SerialLike | undefined =>
  (navigator as unknown as { serial?: SerialLike }).serial

// ---------------------------------------------------------------------------
// chart configuration
// ---------------------------------------------------------------------------
const WINDOW_MS = 30000 // strip charts show the last ~30s
const MAX_LOG = 200
const FRAME_MS = 33 // ~30fps

// series colors follow the editor's convention: X=red, Y=green, Z=blue
const C_PRIMARY = '#3ed107'
const C_X = '#ff5252'
const C_Y = '#4caf50'
const C_Z = '#42a5f5'
const C_W = '#e8e15a'
const C_P = '#ff9800'
const C_F = '#4dd0e1'

// every sample carries exactly one parsed line or binary frame; accessors
// prefer the richer CV line, then the DBG_STATE frame, then the MOD line
type Sample = {
  rt: number
  cv: CvLine | null
  mod: ModLine | null
  st: MonitorState | null
}

const pick = (
  s: Sample,
  fromCv: (d: CvLine) => number,
  fromMod?: (m: ModLine) => number,
  fromSt?: (st: MonitorState) => number,
): number | null => {
  if (s.cv) return fromCv(s.cv)
  if (s.st && fromSt) return fromSt(s.st)
  if (s.mod && fromMod) return fromMod(s.mod)
  return null
}

type SeriesCfg = {
  label: string
  color: string
  min: number
  max: number
  get: (s: Sample) => number | null
  conn?: (s: Sample) => boolean
  // trimmer wiper-open probe (jackFlags bits 5-7): true = the pot's wiper
  // is physically disconnected — the legend chip turns red while open
  open?: (s: Sample) => boolean
  display?: (s: Sample) => string
}

type ChartCfg = { title: string; series: SeriesCfg[] }

const CHARTS: ChartCfg[] = [
  {
    title: 'K + attenuverters aX/aY/aZ (-128..127)',
    series: [
      {
        label: 'K',
        color: C_PRIMARY,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.k,
            (m) => m.k,
            (st) => st.k,
          ),
      },
      {
        label: 'aX',
        color: C_X,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.ax,
            (m) => m.ax,
            (st) => st.ax,
          ),
        open: (s) => s.st?.axOpen ?? false,
      },
      {
        label: 'aY',
        color: C_Y,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.ay,
            (m) => m.ay,
            (st) => st.ay,
          ),
        open: (s) => s.st?.ayOpen ?? false,
      },
      {
        label: 'aZ',
        color: C_Z,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.az,
            (m) => m.az,
            (st) => st.az,
          ),
        open: (s) => s.st?.azOpen ?? false,
      },
    ],
  },
  {
    title: 'CV inputs X/Y/Z (0..255 — top ticks = jack connected)',
    series: [
      {
        label: 'X',
        color: C_X,
        min: 0,
        max: 255,
        get: (s) =>
          pick(
            s,
            (d) => d.x,
            (m) => m.raw >> 2,
            (st) => st.x,
          ),
        conn: (s) =>
          s.cv ? s.cv.xConn : (s.st?.xConn ?? s.mod?.rawConn ?? false),
      },
      {
        label: 'Y',
        color: C_Y,
        min: 0,
        max: 255,
        get: (s) =>
          pick(
            s,
            (d) => d.y,
            undefined,
            (st) => st.y,
          ),
        conn: (s) => (s.cv ? s.cv.yConn : (s.st?.yConn ?? false)),
      },
      {
        label: 'Z',
        color: C_Z,
        min: 0,
        max: 255,
        get: (s) =>
          pick(
            s,
            (d) => d.z,
            undefined,
            (st) => st.z,
          ),
        conn: (s) => (s.cv ? s.cv.zConn : (s.st?.zConn ?? false)),
      },
    ],
  },
  {
    title: 'Effective mod w/x/y/z (-128..127)',
    series: [
      {
        label: 'w',
        color: C_W,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.modW,
            (m) => m.w,
            (st) => st.modW,
          ),
      },
      {
        label: 'x',
        color: C_X,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.modX,
            (m) => m.x,
            (st) => st.modX,
          ),
      },
      {
        label: 'y',
        color: C_Y,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.modY,
            undefined,
            (st) => st.modY,
          ),
      },
      {
        label: 'z',
        color: C_Z,
        min: -128,
        max: 127,
        get: (s) =>
          pick(
            s,
            (d) => d.modZ,
            undefined,
            (st) => st.modZ,
          ),
      },
    ],
  },
  {
    title:
      'Pitch: P raw (0..1023) / final CV / F as Hz (log scale, DBG_CV only)',
    series: [
      {
        label: 'P',
        color: C_P,
        min: 0,
        max: 1023,
        get: (s) =>
          pick(
            s,
            (d) => d.pitchRaw,
            undefined,
            (st) => st.pitchRaw,
          ),
      },
      {
        label: 'CV',
        color: C_PRIMARY,
        min: 0,
        max: 1536,
        get: (s) =>
          pick(
            s,
            (d) => d.cv,
            undefined,
            (st) => st.cv,
          ),
      },
      {
        label: 'F',
        color: C_F,
        min: Math.log2(8), // ~8 Hz
        max: Math.log2(9000), // ~9 kHz
        get: (s) =>
          pick(
            s,
            (d) => Math.log2(Math.max(1, freqHz(d.cv))),
            undefined,
            // DBG_CV's ASCII line is compiled out under DBG_STATE, so derive
            // the frequency from the binary stream's cv instead.
            (st) => Math.log2(Math.max(1, freqHz(st.cv))),
          ),
        display: (s) =>
          s.cv
            ? `${freqHz(s.cv.cv).toFixed(1)}Hz`
            : s.st
              ? `${freqHz(s.st.cv).toFixed(1)}Hz`
              : '—',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// canvas strip chart, decimated to pixel columns
// ---------------------------------------------------------------------------
const drawChart = (
  canvas: HTMLCanvasElement,
  samples: Sample[],
  now: number,
  cfg: ChartCfg,
) => {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (!w || !h) return
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#161616'
  ctx.fillRect(0, 0, w, h)

  const t0 = now - WINDOW_MS
  const pad = 4
  const yOf = (v: number, s: SeriesCfg) => {
    const n = Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min)))
    return h - pad - n * (h - 2 * pad)
  }

  // grid: horizontal quarters + a vertical line every 5s
  ctx.strokeStyle = '#282828'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 1; i < 4; i++) {
    const y = Math.round((h * i) / 4) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  for (let ts = Math.ceil(t0 / 5000) * 5000; ts <= now; ts += 5000) {
    const x = Math.round(((ts - t0) / WINDOW_MS) * w) + 0.5
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  ctx.stroke()

  // zero line for bipolar charts
  const bipolar = cfg.series.find((s) => s.min < 0 && s.max > 0)
  if (bipolar) {
    ctx.strokeStyle = '#454545'
    ctx.beginPath()
    const y = Math.round(yOf(0, bipolar)) + 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // pass 1: decimate every series to pixel columns (min/max/last) and
  // gather window min/max + latest jack state. Disconnected samples carry
  // no value (the line gaps there) but still feed the top connection ticks.
  const perSeries = cfg.series.map((s) => {
    const colMin = new Float64Array(w).fill(Number.NaN)
    const colMax = new Float64Array(w)
    const colLast = new Float64Array(w)
    const colConn = s.conn ? new Uint8Array(w) : null
    const colDisc = s.conn ? new Uint8Array(w) : null
    let vMin = Number.POSITIVE_INFINITY
    let vMax = Number.NEGATIVE_INFINITY
    let hasData = false
    let lastConn = true
    for (const smp of samples) {
      const x = Math.floor(((smp.rt - t0) / WINDOW_MS) * w)
      if (x < 0 || x >= w) continue
      const v = s.get(smp)
      if (v === null) continue
      const isConn = s.conn ? s.conn(smp) : true
      lastConn = isConn
      if (colConn && isConn) colConn[x] = 1
      if (!isConn) {
        // jack unplugged: mark the column so the line breaks instead of
        // holding across the disconnection
        if (colDisc) colDisc[x] = 1
        continue
      }
      hasData = true
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
      if (Number.isNaN(colMin[x])) {
        colMin[x] = v
        colMax[x] = v
      } else {
        if (v < colMin[x]) colMin[x] = v
        if (v > colMax[x]) colMax[x] = v
      }
      colLast[x] = v
    }
    return {
      colMin,
      colMax,
      colLast,
      colConn,
      colDisc,
      vMin,
      vMax,
      hasData,
      lastConn,
    }
  })

  // min/max watermarks only while the chart stays readable
  const activeCount = perSeries.filter((d) => d.hasData && d.lastConn).length
  const withWatermarks = activeCount <= 3

  cfg.series.forEach((s, si) => {
    const d = perSeries[si]

    // thin dashed lines at the window min/max of this channel
    if (withWatermarks && d.hasData && d.lastConn) {
      ctx.save()
      ctx.strokeStyle = s.color
      ctx.globalAlpha = 0.35
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      const yTop = Math.round(yOf(d.vMax, s)) + 0.5
      const yBot = Math.round(yOf(d.vMin, s)) + 0.5
      ctx.moveTo(0, yTop)
      ctx.lineTo(w, yTop)
      if (yBot !== yTop) {
        ctx.moveTo(0, yBot)
        ctx.lineTo(w, yBot)
      }
      ctx.stroke()
      ctx.restore()
    }

    // step/hold line through column values: MOD-only telemetry is sparse
    // (~2Hz today, maybe 4Hz soon), so hold the last value horizontally
    // across gaps instead of interpolating diagonally
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.25
    ctx.beginPath()
    let started = false
    let prevY = 0
    for (let x = 0; x < w; x++) {
      if (Number.isNaN(d.colMin[x])) {
        // a column with only-disconnected samples breaks the line (gap)
        if (d.colDisc?.[x]) started = false
        continue
      }
      const y = yOf(d.colLast[x], s)
      if (started) {
        ctx.lineTo(x + 0.5, prevY)
        ctx.lineTo(x + 0.5, y)
      } else {
        ctx.moveTo(x + 0.5, y)
        started = true
      }
      prevY = y
    }
    ctx.stroke()

    // faint vertical band where a column holds multiple values
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    for (let x = 0; x < w; x++) {
      if (Number.isNaN(d.colMin[x]) || d.colMax[x] - d.colMin[x] <= 0) continue
      ctx.moveTo(x + 0.5, yOf(d.colMin[x], s))
      ctx.lineTo(x + 0.5, yOf(d.colMax[x], s))
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    // jack-connected ticks along the top edge (one row per series)
    if (d.colConn) {
      ctx.fillStyle = s.color
      for (let x = 0; x < w; x++) {
        if (d.colConn[x]) ctx.fillRect(x, 2 + si * 4, 1, 3)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// per-channel window stats (min/max/pp + σΔ noise estimate), ~2Hz refresh
// ---------------------------------------------------------------------------
type SeriesStats = { min: number; max: number; pp: number; sd: number }

const computeStats = (
  samples: Sample[],
  now: number,
): (SeriesStats | null)[][] => {
  const t0 = now - WINDOW_MS
  return CHARTS.map((cfg) =>
    cfg.series.map((s) => {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      let n = 0
      // σΔ = stddev of successive differences: flags noisy/dying pots even
      // when the absolute range looks sane
      let prev: number | null = null
      let dSum = 0
      let dSum2 = 0
      let dN = 0
      for (const smp of samples) {
        if (smp.rt < t0) continue
        const v = s.get(smp)
        if (v === null) continue
        n++
        if (v < min) min = v
        if (v > max) max = v
        if (prev !== null) {
          const d = v - prev
          dSum += d
          dSum2 += d * d
          dN++
        }
        prev = v
      }
      if (n === 0) return null
      const sd =
        dN > 0 ? Math.sqrt(Math.max(0, dSum2 / dN - (dSum / dN) ** 2)) : 0
      return { min, max, pp: max - min, sd }
    }),
  )
}

const fmtStat = (v: number): string =>
  Number.isInteger(v)
    ? String(v)
    : Math.abs(v) < 10
      ? v.toFixed(1)
      : String(Math.round(v))

const fmtSigma = (v: number): string =>
  v >= 10 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2)

// ---------------------------------------------------------------------------
// stimuli panel: canned MIDI setups + notes/bend, watched live on the charts
// ---------------------------------------------------------------------------
const noteName = (n: number): string => {
  const names = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B',
  ]
  return `${names[n % 12]}${Math.floor(n / 12) - 2}`
}

// config-mode dial position 1..41 → name from the editor's instrument bank
// (1-based: dial 0 is the EEPROM-restore notch, not an instrument)
const instrumentName = (n: number): string | null =>
  n >= 1 && n <= instrumentBank.length ? instrumentBank[n - 1].name : null

// "Live patch" channels dim after this long without a fresh 'P' frame
// (full rotation is ~6s, so >10s means the stream stopped or drifted)
const PATCH_STALE_MS = 10000

// pitch ADC raw (0..1023 over a 0..10V input) → volts
const pitchVolts = (raw: number): string => ((raw * 10) / 1023).toFixed(2)

// mod CV calibrated value (0..255, bipolar ±5V, 128 = 0V) → volts, signed.
// Mirrors the firmware's MOD_ADC_TO_VOLTS ((adc-512)/1023*10) scaled to the
// 8-bit calibrated domain.
const modVolts = (v: number): string => {
  const volts = ((v - 128) * 5) / 128
  return `${volts >= 0 ? '+' : ''}${volts.toFixed(2)}`
}

// voice frequency: 1 decimal below 1kHz, whole Hz above
const fmtHz = (hz: number): string =>
  hz < 1000 ? `${hz.toFixed(1)} Hz` : `${Math.round(hz)} Hz`

// signed cents, "+163c" style
const fmtCents = (c: number): string => `${c >= 0 ? '+' : ''}${Math.round(c)}c`

// raw MIDI pitch bend (-8192..8191) → semitones, using the editor's
// configured bend range (pbu/pbd, semitones); falls back to the raw value
// if the range isn't known
const bendDisplay = (bend: number): string => {
  const { pbu, pbd } = editorState.settings
  if (typeof pbu !== 'number' || typeof pbd !== 'number') return `${bend}`
  const semis = bend > 0 ? (bend * pbu) / 8191 : (bend * pbd) / 8192
  return `${semis >= 0 ? '+' : ''}${semis.toFixed(2)}st`
}

const Stimuli = () => {
  const [, setTick] = useState(0)
  const [note, setNote] = useState(TEST_NOTE_DEFAULT)
  const [held, setHeld] = useState(false)
  const [sweepNote, setSweepNote] = useState<number | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [bending, setBending] = useState(false)
  const heldNoteRef = useRef<number | null>(null)
  const sweepRef = useRef<Runner | null>(null)
  const bendRef = useRef<Runner | null>(null)

  // re-render when MIDI outputs change so the output name stays fresh
  useEffect(
    () => MidiIO.sub('midiStateChanged', () => setTick((v) => v + 1)),
    [],
  )

  // stop everything on unmount
  useEffect(
    () => () => {
      sweepRef.current?.cancel()
      bendRef.current?.cancel()
      if (heldNoteRef.current !== null) noteOff(heldNoteRef.current)
    },
    [],
  )

  const outName = MidiIO.getMidiOutName()
  const noOut = outName === null

  const toggleNote = () => {
    if (heldNoteRef.current !== null) {
      noteOff(heldNoteRef.current)
      heldNoteRef.current = null
      setHeld(false)
    } else {
      noteOn(note)
      heldNoteRef.current = note
      setHeld(true)
    }
  }

  const toggleSweep = () => {
    if (sweepRef.current) {
      sweepRef.current.cancel()
      sweepRef.current = null
      setSweeping(false)
      return
    }
    setSweeping(true)
    sweepRef.current = runNoteSweep((n) => {
      setSweepNote(n)
      if (n === null) {
        sweepRef.current = null
        setSweeping(false)
      }
    })
  }

  const startBend = () => {
    if (bendRef.current) return
    setBending(true)
    bendRef.current = runBendRamp(() => {
      bendRef.current = null
      setBending(false)
    })
  }

  return (
    <div className="stimuli">
      <h5>MIDI stimuli</h5>
      <div className="row-btns">
        <button type="button" disabled={noOut} onClick={sendCleanState}>
          Clean state
        </button>
        <button type="button" disabled={noOut} onClick={sendSinePatch}>
          Sine patch
        </button>
        <label>
          note
          <input
            className="note"
            type="number"
            min={0}
            max={127}
            value={note}
            disabled={held}
            onChange={(ev) => {
              const v = Number(ev.target.value)
              if (Number.isInteger(v) && v >= 0 && v <= 127) setNote(v)
            }}
          />
          <span className="note-name">{noteName(note)}</span>
        </label>
        <button
          type="button"
          className={held ? 'active' : ''}
          disabled={noOut}
          onClick={toggleNote}
        >
          {held ? '◼ Note off' : '▶ Test note'}
        </button>
        <button
          type="button"
          className={sweeping ? 'active' : ''}
          disabled={noOut}
          onClick={toggleSweep}
        >
          {sweeping ? `◼ Sweep (${sweepNote ?? '·'})` : '▶ Note sweep'}
        </button>
        <button type="button" disabled={noOut || bending} onClick={startBend}>
          {bending ? '… bend' : '▶ Bend ramp'}
        </button>
        <span className="out-hint">
          {noOut
            ? 'no MIDI output; pick one in the Editor tab'
            : `→ ${outName}`}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// guided rest calibration ("Rest calibration"), helpers in
// monitor-calibration.ts — pre-checks the module is truly at rest, sends
// SET_CALIBRATION_STEP (CC113 ch15) value 9, then watches the voices-strip
// cents for the firmware applying the new rests
// ---------------------------------------------------------------------------
type CalSubscribe = (fn: (s: RestSample) => void) => () => void

type CaptureState = {
  sentAt: number
  beforePitch: number | null // pitchRaw snapshot at send time
  beforeCents: number | null // voice-0 cents offset at send time
  afterCents: number | null // set once the effect shows up
}

// one pre-check row: green check / red cross + label + live value
const CalCheck = ({
  ok,
  label,
  value,
}: {
  ok: boolean
  label: string
  value: string
}) => (
  <div className={ok ? 'cal-check ok' : 'cal-check bad'}>
    <span className="st">{ok ? '✔' : '✘'}</span>
    <span className="name">{label}</span>
    <span className="val">{value}</span>
  </div>
)

const RestCalibration = ({
  subscribe,
  getCents,
  pushLog,
  serialConnected,
  pitchRest,
}: {
  subscribe: CalSubscribe
  getCents: () => number | null
  pushLog: (t: number | null, text: string) => void
  serialConnected: boolean
  // live calibration.pitch_rest from v2 keyframes (null on legacy firmware)
  pitchRest: number | null
}) => {
  const samplesRef = useRef<RestSample[]>([])
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const [, setTick] = useState(0)

  // keep a rolling buffer slightly longer than the stability window
  useEffect(
    () =>
      subscribe((s) => {
        const arr = samplesRef.current
        arr.push(s)
        const cutoff = s.rt - STABILITY_WINDOW_MS - 1000
        while (arr.length > 0 && arr[0].rt < cutoff) arr.shift()
      }),
    [subscribe],
  )

  // own ~4Hz tick: pre-checks and the effect wait track live telemetry
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 250)
    return () => clearInterval(id)
  }, [])

  // after sending: poll the voices-strip cents until the firmware visibly
  // applies the new rests (the change lands on the next note/CV update)
  useEffect(() => {
    if (capture === null || capture.afterCents !== null) return
    const id = setInterval(() => {
      const cents = getCents()
      if (centsEffectSeen(capture.beforeCents, cents)) {
        setCapture({ ...capture, afterCents: cents })
        pushLog(
          null,
          `calibration applied: rest ${fmtCents(
            capture.beforeCents as number,
          )} → ${fmtCents(cents as number)}`,
        )
      }
    }, 250)
    return () => clearInterval(id)
  }, [capture, getCents, pushLog])

  const now = performance.now()
  const pre = evalPrecheck(samplesRef.current, now)
  const outName = MidiIO.getMidiOutName()
  const noOut = outName === null

  const capturar = () => {
    const beforeCents = getCents()
    const beforePitch = pre.latest?.pitchRaw ?? null
    sendCaptureRests()
    pushLog(
      null,
      'calibration: CC113 val 9 sent; capture rests (P/X/Y/Z + trimmers → EEPROM)',
    )
    setCapture({
      sentAt: performance.now(),
      beforePitch,
      beforeCents,
      afterCents: null,
    })
  }

  const jackBits = pre.latest
    ? `X${pre.latest.xConn ? '*' : '.'} Y${pre.latest.yConn ? '*' : '.'} Z${
        pre.latest.zConn ? '*' : '.'
      }`
    : '—'
  const waiting = capture !== null && capture.afterCents === null
  const timedOut =
    waiting && now - (capture as CaptureState).sentAt > EFFECT_TIMEOUT_MS

  return (
    <details className="rest-cal">
      <summary>Rest calibration</summary>
      <p className="cal-hint">
        Captures the rest levels (pitch, X/Y/Z and trimmer centers) and persists
        them to EEPROM. Leave the module at rest with no CV cables.
        {pitchRest !== null && ` · calibrated rest: ${pitchRest}`}
      </p>
      {!pre.hasData ? (
        <p className="cal-hint">
          waiting for telemetry; connect the serial to see the pre-checks…
        </p>
      ) : (
        <div className="cal-checks">
          <CalCheck
            ok={pre.jacksOk}
            label="jacks disconnected"
            value={
              pre.jacksOk
                ? jackBits
                : `${jackBits}; disconnect all CV cables`
            }
          />
          <CalCheck
            ok={pre.pitchStable}
            label={`pitch stable (pp ≤${STABILITY_PP_MAX} over 2s)`}
            value={
              pre.latest && pre.pp
                ? `P:${pre.latest.pitchRaw} pp:${pre.pp.pitch}`
                : '—'
            }
          />
          <CalCheck
            ok={pre.xStable && pre.yStable && pre.zStable}
            label={`X/Y/Z stable (pp ≤${STABILITY_PP_MAX} over 2s)`}
            value={
              pre.latest && pre.pp
                ? `${pre.latest.x}/${pre.latest.y}/${pre.latest.z} pp:${pre.pp.x}/${pre.pp.y}/${pre.pp.z}`
                : '—'
            }
          />
          {!pre.enough && (
            <p className="cal-hint">
              gathering samples to measure stability…
            </p>
          )}
        </div>
      )}
      <div className="row-btns">
        <button
          type="button"
          disabled={!pre.ready || noOut || !serialConnected}
          onClick={capturar}
        >
          ▶ Capture rests
        </button>
        <span className="out-hint">
          {noOut
            ? 'no MIDI output; pick one in the Editor tab'
            : !serialConnected
              ? 'connect the serial to verify the pre-checks'
              : !pre.ready
                ? 'waiting for pre-checks to go green…'
                : `→ ${outName}`}
        </span>
      </div>
      {capture !== null && (
        <div className="cal-result">
          <span>
            before: P raw {capture.beforePitch ?? '—'} · rest{' '}
            {capture.beforeCents !== null
              ? fmtCents(capture.beforeCents)
              : '— (no voices frames)'}
          </span>
          {capture.afterCents !== null ? (
            <span className="after ok">
              after: rest {fmtCents(capture.afterCents)}
            </span>
          ) : capture.beforeCents === null ? (
            <span className="after">
              no v2 voices frames; cannot verify the effect
            </span>
          ) : timedOut ? (
            <span className="after warn">
              waiting for effect… (firmware supports it?)
            </span>
          ) : (
            <span className="after">
              waiting for effect… (shows on the next note/CV update)
            </span>
          )}
        </div>
      )}
    </details>
  )
}

// ---------------------------------------------------------------------------
// factory checklist ("Unit test"), evaluators in monitor-checklist.ts
// ---------------------------------------------------------------------------

// unified checklist sample: CV lines carry everything, MOD lines have no
// pitch/note info (null) — evaluators degrade gracefully without DBG_CV
type ChkSample = {
  ax: number
  ay: number
  az: number
  k: number
  pitchRaw: number | null
  note: number | null
}

type ChkSubscribe = (fn: (s: ChkSample) => void) => () => void

type StepDef = {
  name: string
  instruction: string
  prepMs: number
  durMs: number
  kind: 'quiet' | 'sweep' | 'note'
  axis?: (s: ChkSample) => number
  collapseCheck?: boolean
}

const STEPS: StepDef[] = [
  {
    name: 'Rest',
    instruction: 'Leave everything at rest (trimmers, knob and cables untouched)',
    prepMs: 2000,
    durMs: 5000,
    kind: 'quiet',
  },
  {
    name: 'Trimmer X',
    instruction: 'Turn trimmer X end to end, back and forth',
    prepMs: 3000,
    durMs: 8000,
    kind: 'sweep',
    axis: (s) => s.ax,
    collapseCheck: true,
  },
  {
    name: 'Trimmer Y',
    instruction: 'Turn trimmer Y end to end, back and forth',
    prepMs: 3000,
    durMs: 8000,
    kind: 'sweep',
    axis: (s) => s.ay,
    collapseCheck: true,
  },
  {
    name: 'Trimmer Z',
    instruction: 'Turn trimmer Z end to end, back and forth',
    prepMs: 3000,
    durMs: 8000,
    kind: 'sweep',
    axis: (s) => s.az,
    collapseCheck: true,
  },
  {
    name: 'Knob K',
    instruction: 'Turn the main knob end to end, back and forth',
    prepMs: 3000,
    durMs: 8000,
    kind: 'sweep',
    axis: (s) => s.k,
    collapseCheck: false,
  },
  {
    name: 'MIDI note',
    instruction: 'Press "Send note" and wait for the echo in the telemetry',
    prepMs: 0,
    durMs: 5000,
    kind: 'note',
  },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const Checklist = ({
  subscribe,
  getLatestNote,
  serialConnected,
}: {
  subscribe: ChkSubscribe
  getLatestNote: () => number | null
  serialConnected: boolean
}) => {
  const [idx, setIdx] = useState(-1) // -1 idle, 0..N-1 running, N report
  const [phase, setPhase] = useState<'prep' | 'collect' | 'wait'>('prep')
  const [remaining, setRemaining] = useState(0)
  const [results, setResults] = useState<StepReport[]>([])
  const [copied, setCopied] = useState(false)
  const runIdRef = useRef(0)
  const noteClickRef = useRef<(() => void) | null>(null)

  // abort any running sequence on unmount
  useEffect(
    () => () => {
      runIdRef.current++
    },
    [],
  )

  const countdown = async (ms: number, alive: () => boolean) => {
    const t0 = performance.now()
    for (;;) {
      const left = ms - (performance.now() - t0)
      if (left <= 0 || !alive()) break
      setRemaining(Math.ceil(left / 1000))
      await sleep(100)
    }
    setRemaining(0)
  }

  const runTimedStep = async (
    step: StepDef,
    alive: () => boolean,
  ): Promise<StepReport> => {
    setPhase('prep')
    await countdown(step.prepMs, alive)
    const collected: ChkSample[] = []
    const unsub = subscribe((s) => collected.push(s))
    setPhase('collect')
    await countdown(step.durMs, alive)
    unsub()
    if (step.kind === 'quiet') {
      const r = evalQuiet(collected)
      return { name: step.name, pass: r.pass, detail: describeQuiet(r) }
    }
    const axis = step.axis as (s: ChkSample) => number
    const r = evalSweep(collected.map(axis), step.collapseCheck)
    return { name: step.name, pass: r.pass, detail: describeSweep(r) }
  }

  const runNoteStep = async (
    step: StepDef,
    alive: () => boolean,
  ): Promise<StepReport> => {
    // wait for the user to fire the note
    setPhase('wait')
    let clicked = false
    noteClickRef.current = () => {
      clicked = true
    }
    while (alive() && !clicked) await sleep(100)
    noteClickRef.current = null
    if (!alive()) return { name: step.name, pass: false, detail: 'cancelled' }

    const base = getLatestNote()
    // pick a test note that differs from whatever N: shows right now
    const testNote = base === TEST_NOTE_DEFAULT ? 69 : TEST_NOTE_DEFAULT
    const notes: number[] = base !== null ? [base] : []
    const unsub = subscribe((s) => {
      if (s.note !== null) notes.push(s.note)
    })
    noteOn(testNote)
    setPhase('collect')
    const t0 = performance.now()
    let r = evalNoteChange(notes)
    while (alive() && !r.pass && performance.now() - t0 < step.durMs) {
      setRemaining(Math.ceil((step.durMs - (performance.now() - t0)) / 1000))
      await sleep(100)
      r = evalNoteChange(notes)
    }
    setRemaining(0)
    noteOff(testNote)
    unsub()
    const detail = r.pass
      ? `N ${r.from} → ${r.to} (test note ${testNote})`
      : r.from === null
        ? 'no note telemetry; requires DBG_CV enabled'
        : `N stayed at ${r.from}; the note did not reach the module`
    return { name: step.name, pass: r.pass, detail }
  }

  const start = async () => {
    const run = ++runIdRef.current
    const alive = () => runIdRef.current === run
    setResults([])
    setCopied(false)
    const acc: StepReport[] = []
    for (let i = 0; i < STEPS.length; i++) {
      if (!alive()) return
      setIdx(i)
      const step = STEPS[i]
      const r =
        step.kind === 'note'
          ? await runNoteStep(step, alive)
          : await runTimedStep(step, alive)
      if (!alive()) return
      acc.push(r)
      setResults([...acc])
    }
    setIdx(STEPS.length)
  }

  const cancel = () => {
    runIdRef.current++
    setIdx(-1)
    setResults([])
  }

  const copyReport = () => {
    navigator.clipboard
      .writeText(formatReport(results))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  const running = idx >= 0 && idx < STEPS.length
  const reportReady = idx === STEPS.length
  const failed = results.filter((r) => !r.pass).length

  return (
    <div className="checklist">
      <h5>Unit test</h5>
      {idx === -1 && (
        <div className="row-btns">
          <button type="button" onClick={start}>
            ▶ Start test
          </button>
          {!serialConnected && (
            <span className="out-hint">
              connect the serial first; without telemetry everything fails
            </span>
          )}
        </div>
      )}
      {(running || reportReady) && (
        <ol className="steps">
          {STEPS.map((st, i) => {
            const r = results[i]
            const isCurrent = running && i === idx
            const cls = r
              ? r.pass
                ? 'done pass'
                : 'done fail'
              : isCurrent
                ? 'current'
                : 'pending'
            return (
              <li key={st.name} className={cls}>
                <span className="st">
                  {r ? (r.pass ? '✅' : '❌') : isCurrent ? '▶' : '·'}
                </span>
                <span className="name">{st.name}</span>
                {isCurrent && (
                  <span className="instruction">{st.instruction}</span>
                )}
                {isCurrent && phase === 'prep' && (
                  <span className="count">get ready… {remaining}s</span>
                )}
                {isCurrent && phase === 'collect' && (
                  <span className="count">measuring… {remaining}s</span>
                )}
                {isCurrent && phase === 'wait' && (
                  <button
                    type="button"
                    onClick={() => noteClickRef.current?.()}
                  >
                    ▶ Send note
                  </button>
                )}
                {r && <span className="detail">{r.detail}</span>}
              </li>
            )
          })}
        </ol>
      )}
      {running && (
        <div className="row-btns">
          <button type="button" onClick={cancel}>
            ✕ Cancel
          </button>
        </div>
      )}
      {reportReady && (
        <div className="row-btns">
          <span className={failed === 0 ? 'verdict pass' : 'verdict fail'}>
            {failed === 0
              ? `PASS: ${results.length}/${results.length} steps OK`
              : `FAIL: ${failed} of ${results.length} steps failed`}
          </span>
          <button type="button" onClick={copyReport}>
            {copied ? '✓ copied' : 'Copy report'}
          </button>
          <button type="button" onClick={start}>
            ↻ Repeat test
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------
type ConnState = 'idle' | 'connecting' | 'connected' | 'error'
type LogEntry = { key: number; t: number | null; text: string }

// act: undefined = no activity dot; true/false = dot lit/dim (lights when
// the row's fields changed within the last 500ms, per delta-frame bitmask)
// min free SRAM (bytes) below which the RAM row turns amber; 0 is always crit
const RAM_WARN_BYTES = 48

const Row = ({
  k,
  v,
  act,
}: {
  k: string
  v: React.ReactNode
  act?: boolean
}) => (
  <div className="row">
    <span className="k">
      {act !== undefined && <i className={act ? 'dot on' : 'dot'} />}
      {k}
    </span>
    <span className="v">{v}</span>
  </div>
)

const Monitor = ({ visible }: { visible: boolean }) => {
  const serialSupported = getSerial() !== undefined
  const [conn, setConn] = useState<ConnState>('idle')
  const [connError, setConnError] = useState('')
  const [log, setLog] = useState<LogEntry[]>([])
  const [, setTick] = useState(0) // throttled re-render of live values
  // flips CC114 (val 1/0); tracks the last command sent (the firmware has no readback)
  const [telemetryEnabled, setTelemetryEnabled] = useState(false)
  // keep the "no MIDI output" state fresh when the user picks an output
  useEffect(() => MidiIO.sub('midiStateChanged', () => setTick((v) => v + 1)), [])

  const samplesRef = useRef<Sample[]>([])
  const latestCvRef = useRef<CvLine | null>(null)
  const latestModRef = useRef<ModLine | null>(null)
  const latestStateRef = useRef<MonitorState | null>(null)
  const latestVoicesRef = useRef<VoicesFrame | null>(null)
  const latestPatchRef = useRef<string | null>(null)
  // latest 'P' frame per channel + arrival time, for the "Live patch" panel
  const patchChRef = useRef<({ f: PatchFrame; rt: number } | null)[]>(
    Array.from({ length: NUM_VOICES }, () => null),
  )
  const heartbeatRef = useRef<{ rt: number; loopRate: number } | null>(null)
  const prevModeRef = useRef<string | null>(null)
  const prevNoteRef = useRef<number | null>(null)
  // last known jack state per axis, for connect/disconnect log entries
  const prevJackRef = useRef<{ x: boolean; y: boolean; z: boolean } | null>(
    null,
  )
  // last known raw button/gate state (jackFlags bits 3/4), for edge log
  // entries — button edges make SCK phantom clicks visible with timestamps
  const prevBtnGateRef = useRef<{ button: boolean; gate: boolean } | null>(null)
  // last known trimmer wiper-open state (jackFlags bits 5-7), for the
  // "trimmer aX disconnected (wiper open)" / "reconnected" log entries
  const prevTrimOpenRef = useRef<{
    ax: boolean
    ay: boolean
    az: boolean
  } | null>(null)
  // per-field timestamp of the last change (from state-frame bitmasks),
  // drives the activity dots in the STATE panel
  const actRef = useRef<Record<string, number>>({})
  // per-chart per-series window stats, recomputed at ~2Hz
  const statsRef = useRef<(SeriesStats | null)[][]>(
    CHARTS.map((c) => c.series.map(() => null)),
  )
  const chkSubsRef = useRef<Set<(s: ChkSample) => void>>(new Set())
  const calSubsRef = useRef<Set<(s: RestSample) => void>>(new Set())
  const logQueueRef = useRef<LogEntry[]>([])
  const logKeyRef = useRef(0)
  const keepReadingRef = useRef(false)
  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const rxBytesRef = useRef(0) // total bytes received over serial
  const rxFramesRef = useRef(0) // total K+D state frames decoded
  // bytes/s + state-frames/s over ~1s windows; lastT/lastBytes/lastFrames
  // are (re)seeded at connect time so the first window isn't diluted by
  // the idle time since page load
  const bwRef = useRef({
    lastBytes: 0,
    lastFrames: 0,
    lastT: 0,
    rate: 0,
    frameRate: 0,
  })
  // firmware dropCount is "drops since last keyframe" — accumulate a session
  // total here and remember when the last non-zero delta arrived (for the
  // red highlight on recent drops)
  const dropsTotalRef = useRef(0)
  const lastDropRtRef = useRef<number | null>(null)
  const canvasEls = useRef<(HTMLCanvasElement | null)[]>([])
  const logBoxRef = useRef<HTMLDivElement | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // stable identity: RestCalibration keeps it in an effect dependency list
  const pushLog = useCallback((t: number | null, text: string) => {
    logQueueRef.current.push({ key: logKeyRef.current++, t, text })
    if (logQueueRef.current.length > MAX_LOG)
      logQueueRef.current = logQueueRef.current.slice(-MAX_LOG)
  }, [])

  const pushSample = (sample: Sample) => {
    const samples = samplesRef.current
    samples.push(sample)
    const cutoff = sample.rt - WINDOW_MS - 2000
    while (samples.length > 0 && samples[0].rt < cutoff) samples.shift()
  }

  const notifyChecklist = (s: ChkSample) => {
    chkSubsRef.current.forEach((fn) => fn(s))
  }

  const notifyCal = (s: RestSample) => {
    calSubsRef.current.forEach((fn) => fn(s))
  }

  // log jack connect/disconnect transitions (from CV lines or state frames)
  // and stamp the axis as active so its dot lights up
  const trackJacks = (x: boolean, y: boolean, z: boolean, rt: number) => {
    const prev = prevJackRef.current
    if (prev) {
      const axes: [string, boolean, boolean][] = [
        ['X', prev.x, x],
        ['Y', prev.y, y],
        ['Z', prev.z, z],
      ]
      for (const [name, was, is] of axes) {
        if (was !== is) {
          pushLog(null, `${name} ${is ? 'connected' : 'disconnected'}`)
          actRef.current[name.toLowerCase()] = rt
        }
      }
    }
    prevJackRef.current = { x, y, z }
  }

  // log raw button/gate edges (jackFlags bits 3/4, sampled at the 20Hz
  // delta cadence). The firmware's noteOn/noteOff 'E' events track voice-0
  // gating (MIDI included), not the raw gate input line, so gate edges get
  // their own entries here; button edges surface SCK phantom clicks.
  const trackBtnGate = (button: boolean, gate: boolean, rt: number) => {
    const prev = prevBtnGateRef.current
    if (prev) {
      if (prev.button !== button) {
        pushLog(null, button ? 'button pressed' : 'button released')
        actRef.current.button = rt
      }
      if (prev.gate !== gate) {
        pushLog(null, gate ? 'gate high' : 'gate low')
        actRef.current.gate = rt
      }
    }
    prevBtnGateRef.current = { button, gate }
  }

  // log trimmer wiper-open transitions (jackFlags bits 5-7): the firmware's
  // ADC charge probe flags a pot whose wiper is physically disconnected
  // (dying pot / CW-rail dead zone) — instant diagnosis from the log
  const trackTrimOpen = (ax: boolean, ay: boolean, az: boolean, rt: number) => {
    const prev = prevTrimOpenRef.current
    if (prev) {
      const axes = [
        ['aX', 'ax', prev.ax, ax],
        ['aY', 'ay', prev.ay, ay],
        ['aZ', 'az', prev.az, az],
      ] as const
      for (const [name, act, was, is] of axes) {
        if (was !== is) {
          pushLog(
            null,
            is
              ? `trimmer ${name} disconnected (wiper open)`
              : `trimmer ${name} reconnected`,
          )
          actRef.current[act] = rt
        }
      }
    }
    prevTrimOpenRef.current = { ax, ay, az }
  }

  const handleLine = (line: string) => {
    const p = parseLine(line)
    if (!p) return
    const rt = performance.now()
    switch (p.type) {
      case 'cv': {
        latestCvRef.current = p
        pushSample({ rt, cv: p, mod: null, st: null })
        trackJacks(p.xConn, p.yConn, p.zConn, rt)
        notifyChecklist({
          ax: p.ax,
          ay: p.ay,
          az: p.az,
          k: p.k,
          pitchRaw: p.pitchRaw,
          note: p.note,
        })
        notifyCal({
          rt,
          pitchRaw: p.pitchRaw,
          x: p.x,
          y: p.y,
          z: p.z,
          xConn: p.xConn,
          yConn: p.yConn,
          zConn: p.zConn,
        })
        if (p.mode !== prevModeRef.current) {
          pushLog(p.t, `mode → [${p.mode}]`)
          prevModeRef.current = p.mode
        }
        if (p.note !== prevNoteRef.current) {
          pushLog(p.t, `note → ${p.note}`)
          prevNoteRef.current = p.note
        }
        break
      }
      case 'mod':
        latestModRef.current = p
        pushSample({ rt, cv: null, mod: p, st: null })
        notifyChecklist({
          ax: p.ax,
          ay: p.ay,
          az: p.az,
          k: p.k,
          pitchRaw: null,
          note: null,
        })
        break
      case 'patch': {
        const text = p.pairs.map(([a, b]) => `${a}/${b}`).join(' ')
        latestPatchRef.current = text
        pushLog(null, `PATCH TL0/TL3: ${text}`)
        break
      }
      case 'heartbeat':
        heartbeatRef.current = { rt, loopRate: p.loopRate }
        pushLog(p.t, `heartbeat loop:${p.loopRate}/s`)
        break
      case 'raw':
        pushLog(null, p.text)
        break
    }
  }

  // DBG_STATE binary frames: state keyframes/deltas at ~20Hz plus events.
  // Every state frame becomes a chart sample (same shape as CV/MOD lines).
  const handleFrame = (f: ParsedFrame) => {
    const rt = performance.now()
    if (f.type === 'event') {
      if (f.kind === 4) {
        // config-mode instrument load: value = (slot << 6) | dial position
        const { slot, instrument } = unpackInstrumentEvent(f.value)
        const name = instrumentName(instrument)
        pushLog(
          null,
          `instrument ${name !== null ? `${name} (${instrument})` : instrument} → slot ${SLOT_NAMES[slot]}`,
        )
        return
      }
      if (f.kind === 5) {
        // config-mode dial position 0: slot reloaded from EEPROM (undo)
        pushLog(null, `slot ${SLOT_NAMES[f.value & 3]} restored from EEPROM`)
        return
      }
      const kind = EVENT_KINDS[f.kind] ?? `event#${f.kind}`
      pushLog(
        null,
        kind === 'modeChange'
          ? `event ${kind} → [${modeName(f.value)}]`
          : `event ${kind} ${f.value}`,
      )
      return
    }
    if (f.type === 'voices') {
      // per-voice note+gate snapshot — feeds the Voices strip only
      latestVoicesRef.current = f
      return
    }
    if (f.type === 'patch') {
      // rotating channel_t snapshot: feeds the "Live patch" panel only
      patchChRef.current[f.channel] = { f, rt }
      return
    }
    const st = f.state
    latestStateRef.current = st
    rxFramesRef.current++
    // stamp every field this frame changed (delta bitmask / keyframe diff)
    for (const [name, bit] of Object.entries(FIELD_BITS)) {
      if (f.changed & (1 << bit)) actRef.current[name] = rt
    }
    trackJacks(st.xConn, st.yConn, st.zConn, rt)
    trackBtnGate(st.button, st.gate, rt)
    trackTrimOpen(st.axOpen, st.ayOpen, st.azOpen, rt)
    if (f.frame === 'K' && st.dropCount > 0) {
      dropsTotalRef.current += st.dropCount
      lastDropRtRef.current = rt
    }
    pushSample({ rt, cv: null, mod: null, st })
    notifyChecklist({
      ax: st.ax,
      ay: st.ay,
      az: st.az,
      k: st.k,
      pitchRaw: st.pitchRaw,
      note: st.note,
    })
    notifyCal({
      rt,
      pitchRaw: st.pitchRaw,
      x: st.x,
      y: st.y,
      z: st.z,
      xConn: st.xConn,
      yConn: st.yConn,
      zConn: st.zConn,
    })
    // keyframes carry loopRate — keep the heartbeat fresh without log spam
    heartbeatRef.current = { rt, loopRate: st.loopRate }
    const mn = modeName(st.mode)
    if (mn !== prevModeRef.current) {
      pushLog(null, `mode → [${mn}]`)
      prevModeRef.current = mn
    }
    // note changes are NOT diff-logged here: the firmware already emits
    // explicit noteOn/noteOff 'E' event frames (logged above) and the STATE
    // panel shows the current note live — a diff-log would double-report
  }

  const subscribeChk = useCallback<ChkSubscribe>((fn) => {
    chkSubsRef.current.add(fn)
    return () => {
      chkSubsRef.current.delete(fn)
    }
  }, [])

  const subscribeCal = useCallback<CalSubscribe>((fn) => {
    calSubsRef.current.add(fn)
    return () => {
      calSubsRef.current.delete(fn)
    }
  }, [])

  // voice-0 resting cents offset from the latest v2 voices frame — the
  // signal the calibration panel watches to confirm the firmware applied
  // the captured rests (all voices share the analog-CV pitch component)
  const getRestCents = useCallback(() => {
    const v = latestVoicesRef.current
    const cv0 = v?.cvs?.[0]
    return v && cv0 !== undefined ? centsOffset(cv0, v.notes[0]) : null
  }, [])

  const getLatestNote = useCallback(
    () => latestCvRef.current?.note ?? latestStateRef.current?.note ?? null,
    [],
  )

  // reuse the single paired port (skip the picker), else prompt
  const openBridgePort = async (): Promise<SerialPortLike> => {
    const serial = getSerial()
    if (!serial) throw new Error('Web Serial not supported')
    const granted = await serial.getPorts()
    console.log('[mon] openBridgePort: granted ports =', granted.length)
    const p = granted.length === 1 ? granted[0] : await serial.requestPort()
    // reuse an already-open port (a fast reconnect can race the previous close)
    if (!p.readable) {
      console.log('[mon] opening port @38400')
      await p.open({ baudRate: 38400 })
    } else {
      console.log('[mon] reusing an already-open port')
    }
    return p
  }

  const readLoop = async (initialPort: SerialPortLike) => {
    // one demux per connection: binary frames and ASCII lines split here
    const demux = new FrameDemux()
    let sawData = false
    let sawFrame = false
    let port: SerialPortLike | null = initialPort
    // re-acquire on drop (the Uno bridge can reset on open); real data resets the streak
    let lostStreak = 0
    while (keepReadingRef.current) {
      if (!port || !port.readable) {
        if (lostStreak++ > 8) break
        await new Promise((r) => setTimeout(r, 1500)) // wait for re-enumeration
        try {
          port = await openBridgePort()
          portRef.current = port
        } catch {
          port = null
          continue
        }
      }
      const reader = port.readable!.getReader()
      readerRef.current = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value || value.length === 0) continue
          lostStreak = 0
          rxBytesRef.current += value.length
          if (!sawData) { console.log('[mon] first bytes in:', value.length, 'B'); sawData = true }
          const { frames, textLines } = demux.feed(value)
          if (!sawFrame && frames.length) { console.log('[mon] first parsed frame:', frames[0].type ?? '?'); sawFrame = true }
          for (const f of frames) handleFrame(f)
          for (const l of textLines) handleLine(l)
        }
      } catch {
        // device lost / transient read error — the outer loop re-acquires
      } finally {
        try {
          reader.releaseLock()
        } catch {
          // reader already gone with the device
        }
      }
      if (port && !port.readable) port = null // lost -> force re-acquire above
    }
    readerRef.current = null
    keepReadingRef.current = false
    try {
      if (port) await port.close()
    } catch {
      // already closed / device gone
    }
    if (port && portRef.current === port) portRef.current = null
    // drop last-session state so the STATE panel, Voices strip, Patch vivo
    // panel and drops counter don't show stale values while "disconnected"
    latestStateRef.current = null
    latestVoicesRef.current = null
    patchChRef.current = Array.from({ length: NUM_VOICES }, () => null)
    prevNoteRef.current = null
    prevModeRef.current = null
    prevJackRef.current = null
    prevBtnGateRef.current = null
    prevTrimOpenRef.current = null
    actRef.current = {}
    setConn('idle')
    pushLog(null, '--- serial disconnected ---')
  }

  const connect = async () => {
    const serial = getSerial()
    if (!serial) return
    setConnError('')
    setConn('connecting')
    let port: SerialPortLike
    try {
      port = await openBridgePort()
    } catch (err) {
      // NotFoundError = user dismissed the picker: not an error
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setConn('idle')
      } else {
        setConn('error')
        setConnError(err instanceof Error ? err.message : String(err))
        console.error('[mon] connect failed:', err)
      }
      return
    }
    portRef.current = port
    keepReadingRef.current = true
    // seed the bandwidth window at connect so the first reading measures
    // actual traffic, not the idle span since page load; drops are a
    // per-session total, so they restart here too
    bwRef.current = {
      lastBytes: rxBytesRef.current,
      lastFrames: rxFramesRef.current,
      lastT: performance.now(),
      rate: 0,
      frameRate: 0,
    }
    dropsTotalRef.current = 0
    lastDropRtRef.current = null
    setConn('connected')
    console.log('[mon] connected @38400; midiOut =', MidiIO.getMidiOutName())
    pushLog(null, '--- serial connected (38400 baud) ---')
    // prod ships OFF: enable on connect so the stream flows (needs a MIDI output)
    if (MidiIO.getMidiOutName() !== null) {
      sendToggleDebug(true)
      setTelemetryEnabled(true)
    } else {
      pushLog(
        null,
        '⚠ no MIDI output selected — telemetry stays OFF (the toggle needs it). Pick one in the Editor tab, then reconnect.',
      )
    }
    readLoop(port)
  }

  const disconnect = async () => {
    // leave the module in its shipped default (silent) before dropping the link
    if (telemetryEnabled && MidiIO.getMidiOutName() !== null) sendToggleDebug(false)
    setTelemetryEnabled(false)
    keepReadingRef.current = false
    try {
      await readerRef.current?.cancel()
    } catch {
      // reader already gone
    }
  }

  const toggleTelemetry = () => {
    const next = !telemetryEnabled
    sendToggleDebug(next)
    setTelemetryEnabled(next)
  }

  // flush the event-log queue, refresh live values (~4Hz) and recompute
  // the serial bandwidth over ~1s windows
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now()
      const bw = bwRef.current
      if (now - bw.lastT >= 1000) {
        bw.rate =
          ((rxBytesRef.current - bw.lastBytes) * 1000) / (now - bw.lastT)
        bw.frameRate =
          ((rxFramesRef.current - bw.lastFrames) * 1000) / (now - bw.lastT)
        bw.lastBytes = rxBytesRef.current
        bw.lastFrames = rxFramesRef.current
        bw.lastT = now
      }
      setTick((v) => v + 1)
      if (logQueueRef.current.length > 0) {
        const q = logQueueRef.current
        logQueueRef.current = []
        setLog((prev) => [...prev, ...q].slice(-MAX_LOG))
      }
    }, 250)
    return () => clearInterval(id)
  }, [])

  // window stats refresh (~2Hz, deliberately decoupled from the 30fps
  // chart redraw — stats don't need per-frame precision)
  useEffect(() => {
    const id = setInterval(() => {
      if (!visibleRef.current) return
      statsRef.current = computeStats(samplesRef.current, performance.now())
    }, 500)
    return () => clearInterval(id)
  }, [])

  // auto-scroll the event log
  useEffect(() => {
    const el = logBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  // chart redraw loop (~30fps, skipped while the tab is hidden)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (!visibleRef.current) return
      if (ts - last < FRAME_MS) return
      last = ts
      const now = performance.now()
      CHARTS.forEach((cfg, i) => {
        const canvas = canvasEls.current[i]
        if (canvas) drawChart(canvas, samplesRef.current, now, cfg)
      })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  // close the port when the component unmounts
  useEffect(() => {
    return () => {
      keepReadingRef.current = false
      readerRef.current?.cancel().catch(() => {})
    }
  }, [])

  const cv = latestCvRef.current
  const mod = latestModRef.current
  const st = latestStateRef.current
  const voices = latestVoicesRef.current
  const hb = heartbeatRef.current
  const hbAge = hb ? (performance.now() - hb.rt) / 1000 : null
  const rxRate = bwRef.current.rate
  const frameRate = bwRef.current.frameRate
  const dropsTotal = dropsTotalRef.current
  const dropsRecent =
    lastDropRtRef.current !== null &&
    performance.now() - lastDropRtRef.current < 10000
  // legends read from whatever telemetry is available (CV preferred)
  const legendSample: Sample = { rt: 0, cv, mod, st }
  // activity: true if any of the named fields changed in the last 500ms
  const nowRt = performance.now()
  const hot = (...names: string[]) =>
    names.some(
      (n) => nowRt - (actRef.current[n] ?? Number.NEGATIVE_INFINITY) < 500,
    )

  return (
    <div className="monitor" style={{ display: visible ? undefined : 'none' }}>
      <nav className="monitor-bar">
        {conn === 'connected' ? (
          <button type="button" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={!serialSupported || conn === 'connecting'}
            onClick={connect}
          >
            Connect serial
          </button>
        )}
        <button
          type="button"
          className={telemetryEnabled ? 'active' : ''}
          disabled={conn !== 'connected' || MidiIO.getMidiOutName() === null}
          onClick={toggleTelemetry}
          title={
            MidiIO.getMidiOutName() === null
              ? 'no MIDI output; pick one in the Editor tab'
              : 'toggle the module telemetry stream (CC114)'
          }
        >
          Telemetry {telemetryEnabled ? 'ON' : 'OFF'}
        </button>
        <span className={`status ${conn}`}>
          {conn === 'connected'
            ? '● connected 38400'
            : conn === 'connecting'
              ? '○ connecting…'
              : conn === 'error'
                ? '✕ error'
                : '○ disconnected'}
        </span>
        <span>loop: {hb ? `${hb.loopRate}/s` : '—'}</span>
        <span>
          mode: {cv ? `[${cv.mode}]` : st ? `[${modeName(st.mode)}]` : '—'}
        </span>
        {/* quantize is silently toggleable on the hardware (phantom SCK
            clicks persist it to EEPROM) — keep it always visible */}
        <span
          className={`q-badge${st?.quantize ? ' on' : ''}`}
          title={
            st
              ? `quantize: ${QUANTIZE_NAMES[st.quantize] ?? st.quantize}`
              : 'quantize: waiting for keyframe'
          }
        >
          Q
        </span>
        <span>
          heartbeat: {hbAge !== null ? `${hbAge.toFixed(1)}s ago` : '—'}
        </span>
        <span>
          rx: {conn === 'connected' ? `${Math.round(rxRate)} B/s` : '—'}
        </span>
        <span>
          frames: {conn === 'connected' ? `${Math.round(frameRate)}/s` : '—'}
        </span>
        <span style={dropsRecent ? { color: '#ff5252' } : undefined}>
          drops: {conn === 'connected' ? dropsTotal : '—'}
        </span>
      </nav>
      {conn === 'connected' && MidiIO.getMidiOutName() === null && (
        <p className="hint warn">
          ⚠ No MIDI output selected — the module can't be switched into
          telemetry mode. Pick a MIDI Out in the Editor tab, then reconnect.
        </p>
      )}
      {!serialSupported && (
        <p className="hint">
          WebSerial unavailable; use Chrome (or Edge) and serve the app over
          localhost or https.
        </p>
      )}
      {conn === 'error' && connError !== '' && (
        <p className="hint">
          {connError}; is the port held by another process (cat, another tab)?
          There can be only ONE owner of the port.
        </p>
      )}
      <Stimuli />
      <div className="voices">
        <h5>Voices</h5>
        <div className="cells">
          {Array.from({ length: NUM_VOICES }, (_, i) => {
            const lit = voices?.gates[i] ?? false
            // v2 frames carry the voice's FINAL pitch CV: everything
            // non-MIDI (analog CV, tune, transpose, bend, mode intervals)
            // shows up as a cents offset from the MIDI base note
            const vcv = voices?.cvs?.[i]
            const cents =
              voices && vcv !== undefined
                ? centsOffset(vcv, voices.notes[i])
                : null
            return (
              <span
                // voices are positional (0..5), the index IS the identity
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-slot strip
                key={i}
                className={lit ? 'cell lit' : 'cell'}
                title={`voice ${i}${voices ? ` — note ${voices.notes[i]}${vcv !== undefined ? ` cv ${vcv}` : ''}${lit ? ' (gated)' : ''}` : ''}`}
              >
                <span className="vn">{i}</span>
                <span className="nn">
                  {voices ? noteName(voices.notes[i]) : '—'}
                </span>
                {vcv !== undefined && cents !== null && (
                  <>
                    <span className="hz">{fmtHz(freqHz(vcv))}</span>
                    <span
                      className={Math.abs(cents) < 3 ? 'cents' : 'cents shift'}
                    >
                      {fmtCents(cents)}
                    </span>
                  </>
                )}
              </span>
            )
          })}
        </div>
        {st && (
          <div className="decomp">
            <span className="lbl">
              pitch breakdown (common to all voices):
            </span>{' '}
            pitch {fmtCents(pitchDevCents(st.pitchRaw, st.pitchRest))} | tune{' '}
            {fmtCents((st.tu - 64) * 12.5)} | transpose{' '}
            {`${st.tr - 64 >= 0 ? '+' : ''}${st.tr - 64}st`} | bend{' '}
            {bendDisplay(st.bend)}
          </div>
        )}
      </div>
      <details className="patch-live">
        <summary>Live patch (chip)</summary>
        <div className="rows">
          {patchChRef.current.map((e, i) => {
            // channels are positional (0..5), the index IS the identity
            const stale = e !== null && nowRt - e.rt > PATCH_STALE_MS
            const cls = e === null ? 'pch empty' : stale ? 'pch stale' : 'pch'
            if (e === null)
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-slot rows
                <div key={i} className={cls}>
                  <span className="idx">ch{i}</span> —
                </div>
              )
            const { ch, raw } = e.f
            const hex = Array.from(raw, (b) =>
              b.toString(16).padStart(2, '0'),
            ).join(' ')
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-slot rows
              <div
                key={i}
                className={cls}
                title={`ch ${i} — LR:${ch.lr} AMS:${ch.ams} FMS:${ch.fms}${
                  stale ? ' (no refresh in >10s)' : ''
                }\nraw: ${hex}`}
              >
                <span className="idx">ch{i}</span> AL{ch.al} FB{ch.fb} · TL{' '}
                {ch.ops.map((op) => op.tl).join('/')}
              </div>
            )
          })}
        </div>
      </details>
      <RestCalibration
        subscribe={subscribeCal}
        getCents={getRestCents}
        pushLog={pushLog}
        serialConnected={conn === 'connected'}
        pitchRest={st?.pitchRest ?? null}
      />
      <div className="monitor-body">
        <div className="charts">
          {CHARTS.map((cfg, i) => (
            <div className="chart" key={cfg.title}>
              <h5>{cfg.title}</h5>
              <canvas
                ref={(el) => {
                  canvasEls.current[i] = el
                }}
              />
              <div className="legend">
                {cfg.series.map((s) => {
                  const v = s.get(legendSample)
                  // connection-aware chips: null = series has no jack
                  const connected = s.conn ? s.conn(legendSample) : null
                  // wiper-open probe: red chip + ⚠ while the pot is open
                  const open = s.open ? s.open(legendSample) : false
                  const cls = connected === null ? '' : connected ? 'on' : 'off'
                  return (
                    <span
                      key={s.label}
                      className={cls}
                      style={
                        open
                          ? { color: '#ff5252' }
                          : connected
                            ? { color: s.color }
                            : undefined
                      }
                      title={
                        open
                          ? `trimmer ${s.label} disconnected (wiper open)`
                          : undefined
                      }
                    >
                      <i
                        style={{
                          background: open
                            ? '#ff5252'
                            : connected === false
                              ? '#555'
                              : s.color,
                        }}
                      />
                      {s.label}
                      {open ? '⚠' : ''}
                      {v !== null
                        ? `:${
                            s.display ? s.display(legendSample) : Math.round(v)
                          }`
                        : ''}
                    </span>
                  )
                })}
              </div>
              <div className="stats">
                {cfg.series.map((s, si) => {
                  const stt = statsRef.current[i][si]
                  const off = s.conn ? !s.conn(legendSample) : false
                  return (
                    <span key={s.label} className={off ? 'off' : ''}>
                      <b>{s.label}</b>{' '}
                      {stt
                        ? `${fmtStat(stt.min)}…${fmtStat(stt.max)} pp:${fmtStat(
                            stt.pp,
                          )} σΔ:${fmtSigma(stt.sd)}`
                        : '—'}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="live">
          <h5>Live values</h5>
          {cv ? (
            <>
              <Row k="t" v={`${cv.t} ms`} />
              <Row k="mode" v={`[${cv.mode}]`} />
              <Row k="note" v={cv.note} />
              <Row
                k="P raw"
                v={`${cv.pitchRaw} (${cv.pitchVolts}V d:${cv.pitchDev})`}
              />
              <Row k="T / tu" v={`${cv.transpose} / ${cv.tuning}`} />
              <Row k="C" v={cv.c} />
              <Row k="CV" v={cv.cv} />
              <Row k="PB" v={cv.pb} />
              <Row k="F" v={`${cv.f} (${freqHz(cv.cv).toFixed(1)} Hz)`} />
              <Row
                k="X / Y / Z"
                v={`${cv.x}${cv.xConn ? '*' : '.'} ${cv.y}${
                  cv.yConn ? '*' : '.'
                } ${cv.z}${cv.zConn ? '*' : '.'}`}
              />
              <Row k="K" v={cv.k} />
              <Row k="aX/aY/aZ" v={`${cv.ax} / ${cv.ay} / ${cv.az}`} />
              <Row
                k="mod wxyz"
                v={`${cv.modW},${cv.modX},${cv.modY},${cv.modZ}`}
              />
              <Row
                k="CC mask"
                v={cv.ccMask !== null ? `0x${cv.ccMask.toString(16)}` : '—'}
              />
              <Row
                k="RGB"
                v={
                  <>
                    <i
                      className="swatch"
                      style={{
                        background: `rgb(${cv.rgb[0]},${cv.rgb[1]},${cv.rgb[2]})`,
                      }}
                    />{' '}
                    {cv.rgb.join(',')}
                  </>
                }
              />
            </>
          ) : (
            // binary frames alone (DBG_STATE without DBG_CV) fill the STATE
            // block below, so only claim we are waiting when nothing arrives
            !st && (
              <p className="hint">waiting for telemetry (DBG_STATE / DBG_CV)…</p>
            )
          )}
          {st && (
            <>
              <h5>STATE (20Hz)</h5>
              <Row
                k="note / mode"
                act={hot('note', 'mode')}
                v={`${noteName(st.note)} (${st.note}) [${modeName(st.mode)}]${
                  st.quantize ? ` Q:${QUANTIZE_NAMES[st.quantize] ?? st.quantize}` : ''
                }`}
              />
              <Row
                k="P / CV"
                act={hot('pitchRaw', 'cv')}
                v={`${pitchVolts(st.pitchRaw)}V (${st.pitchRaw}) / ${st.cv}`}
              />
              <Row
                k="PB"
                act={hot('bend')}
                v={`${bendDisplay(st.bend)} (${st.bend})`}
              />
              <Row
                k="X"
                act={hot('x', 'jack')}
                v={`${modVolts(st.x)}V (${st.x})${st.xConn ? '*' : '.'}`}
              />
              <Row
                k="Y"
                act={hot('y', 'jack')}
                v={`${modVolts(st.y)}V (${st.y})${st.yConn ? '*' : '.'}`}
              />
              <Row
                k="Z"
                act={hot('z', 'jack')}
                v={`${modVolts(st.z)}V (${st.z})${st.zConn ? '*' : '.'}`}
              />
              <Row
                k="button / gate"
                act={hot('button', 'gate')}
                v={
                  <>
                    <i className={st.button ? 'led on' : 'led'} />
                    {'button  '}
                    <i className={st.gate ? 'led on' : 'led'} />
                    {'gate'}
                  </>
                }
              />
              <Row k="K" act={hot('k')} v={st.k} />
              <Row
                k="aX/aY/aZ"
                act={hot('ax', 'ay', 'az')}
                v={(
                  [
                    ['aX', st.ax, st.axOpen],
                    ['aY', st.ay, st.ayOpen],
                    ['aZ', st.az, st.azOpen],
                  ] as const
                ).map(([name, val, open], i) => (
                  <React.Fragment key={name}>
                    {i > 0 && ' / '}
                    <span
                      style={open ? { color: '#ff5252' } : undefined}
                      title={
                        open
                          ? `trimmer ${name} disconnected (wiper open)`
                          : undefined
                      }
                    >
                      {val}
                      {open && ' ⚠ OPEN'}
                    </span>
                  </React.Fragment>
                ))}
              />
              <Row
                k="mod wxyz"
                act={hot('modW', 'modX', 'modY', 'modZ')}
                v={`${st.modW},${st.modX},${st.modY},${st.modZ}`}
              />
              <Row
                k="tu / tr"
                act={hot('tu', 'tr')}
                v={`${st.tu} / ${st.tr}`}
              />
              <Row
                k="TL0 / TL3"
                act={hot('tl0', 'tl3')}
                v={`${st.tl0} / ${st.tl3}`}
              />
              <Row k="loop / drops" v={`${st.loopRate}/s / ${st.dropCount}`} />
              {st.stackFree !== null && (
                <Row
                  k="free RAM"
                  v={
                    <span
                      className={`ram ${
                        st.stackFree === 0
                          ? 'crit'
                          : st.stackFree < RAM_WARN_BYTES
                            ? 'warn'
                            : 'ok'
                      }`}
                      title="free SRAM below the stack at telemetry-send time (bytes)"
                    >
                      {st.stackFree} B{st.stackFree === 0 && ' ⚠'}
                    </span>
                  }
                />
              )}
            </>
          )}
          {mod && (
            <>
              <h5>MOD</h5>
              <Row k="w / x" v={`${mod.w} / ${mod.x}`} />
              <Row k="ax/ay/az" v={`${mod.ax} / ${mod.ay} / ${mod.az}`} />
              <Row k="K" v={mod.k} />
              <Row k="raw X" v={`${mod.raw}${mod.rawConn ? '*' : '.'}`} />
              <Row k="mm" v={mod.mm} />
              <Row k="TL0 / TL3" v={`${mod.tl0} / ${mod.tl3}`} />
            </>
          )}
          {latestPatchRef.current && (
            <>
              <h5>PATCH TL0/TL3</h5>
              <Row k="A B C D" v={latestPatchRef.current} />
            </>
          )}
        </div>
      </div>
      <Checklist
        subscribe={subscribeChk}
        getLatestNote={getLatestNote}
        serialConnected={conn === 'connected'}
      />
      <div className="event-log" ref={logBoxRef}>
        {log.length === 0 ? (
          <p className="hint">event log empty; connect the serial…</p>
        ) : (
          log.map((e) => (
            <div key={e.key}>
              <span className="t">{e.t !== null ? e.t : '·'}</span>
              {e.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default Monitor
