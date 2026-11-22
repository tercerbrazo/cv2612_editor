/*
 * Guided "Calibration mode" view for the Monitor. A full-screen wizard that
 * walks the operator through capturing the rests AND verifying the module, with
 * every ✓ derived live from telemetry (not from the operator clicking "done").
 * All decision logic lives in monitor-cal-wizard.ts (unit-tested); this file is
 * the view + the MIDI it sends.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EFFECT_TIMEOUT_MS } from './monitor-calibration.ts'
import {
  centsEffectSeen,
  evalCapturePrecheck,
  emptyJackProbe,
  emptySpan,
  inTune,
  type JackProbe,
  jackProbeOk,
  observeJack,
  reachedOctave,
  type Span,
  spanSemitones,
  trackSpan,
  type WizSample,
  type WizStepId,
  WIZARD_STEPS,
} from './monitor-cal-wizard.ts'
import MidiIO from './midi-io'
import { noteOff, noteOn, sendCaptureRests } from './monitor-stimuli'

const SETTINGS_CH = 14 // editor 0-based: settings channel
const PLAY_MODE_CC = 20
const MODE_MONO = 0
const MODE_DUO = 1
const MODE_TRIO = 2
const A4_NOTE = 69

const setPlayMode = (mode: number) => MidiIO.sendCC(SETTINGS_CH, PLAY_MODE_CC, mode)

type CaptureState = {
  sentAt: number
  beforeCents: number | null
  afterCents: number | null
}

const CheckRow = ({
  ok,
  label,
  value,
}: {
  ok: boolean
  label: string
  value?: string
}) => (
  <div className={ok ? 'cal-check ok' : 'cal-check bad'}>
    <span className="st">{ok ? '✔' : '✘'}</span>
    <span className="name">{label}</span>
    {value !== undefined && <span className="val">{value}</span>}
  </div>
)

export const CalibrationMode = ({
  subscribe,
  getCents,
  serialConnected,
  noOut,
  pushLog,
  onExit,
}: {
  subscribe: (fn: (s: WizSample) => void) => () => void
  getCents: () => number | null
  serialConnected: boolean
  noOut: boolean
  pushLog: (t: number | null, msg: string) => void
  onExit: () => void
}) => {
  const [idx, setIdx] = useState(0)
  const idxRef = useRef(0)
  idxRef.current = idx
  const step = WIZARD_STEPS[idx]

  const samplesRef = useRef<WizSample[]>([])
  const spanYRef = useRef<Span>(emptySpan())
  const spanZRef = useRef<Span>(emptySpan())
  const jackRef = useRef<{ x: JackProbe; y: JackProbe; z: JackProbe }>({
    x: emptyJackProbe(),
    y: emptyJackProbe(),
    z: emptyJackProbe(),
  })
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const [pass, setPass] = useState<Record<string, boolean>>({})
  const [, setTick] = useState(0)
  const a4HeldRef = useRef(false)

  // live telemetry feed: buffer samples and update the active step's trackers
  useEffect(
    () =>
      subscribe((s) => {
        const buf = samplesRef.current
        buf.push(s)
        // keep ~3s at 20Hz
        if (buf.length > 80) buf.splice(0, buf.length - 80)
        const id = WIZARD_STEPS[idxRef.current].id
        if (id === 'sweepY') spanYRef.current = trackSpan(spanYRef.current, s.modY)
        else if (id === 'sweepZ')
          spanZRef.current = trackSpan(spanZRef.current, s.modZ)
        else if (id === 'jacks') {
          const j = jackRef.current
          j.x = observeJack(j.x, s.xConn)
          j.y = observeJack(j.y, s.yConn)
          j.z = observeJack(j.z, s.zConn)
        }
      }),
    [subscribe],
  )

  // ~5Hz re-render so live checks refresh without a frame-rate storm
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 200)
    return () => clearInterval(t)
  }, [])

  // entering a step prepares its side (mode + fresh trackers)
  useEffect(() => {
    const id = WIZARD_STEPS[idx].id
    // leaving the tuning step: stop the held reference note
    if (id !== 'tuning' && a4HeldRef.current) {
      noteOff(A4_NOTE)
      a4HeldRef.current = false
    }
    if (id === 'sweepY') {
      spanYRef.current = emptySpan()
      setPlayMode(MODE_DUO)
    } else if (id === 'sweepZ') {
      spanZRef.current = emptySpan()
      setPlayMode(MODE_TRIO)
    } else if (id === 'jacks') {
      jackRef.current = {
        x: emptyJackProbe(),
        y: emptyJackProbe(),
        z: emptyJackProbe(),
      }
    } else if (id === 'tuning') {
      setPlayMode(MODE_MONO)
    }
  }, [idx])

  // capture: watch the voices cents collapse to confirm the firmware applied it
  useEffect(() => {
    if (capture === null || capture.afterCents !== null) return
    const t = setInterval(() => {
      const cents = getCents()
      if (centsEffectSeen(capture.beforeCents, cents)) {
        setCapture((c) => (c ? { ...c, afterCents: cents } : c))
        setPass((p) => ({ ...p, capture: true }))
        pushLog(null, 'capture applied: rests + trimmer centers → EEPROM')
      }
    }, 150)
    return () => clearInterval(t)
  }, [capture, getCents, pushLog])

  const now =
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  const pre = evalCapturePrecheck(samplesRef.current, now)
  const yOct = reachedOctave(spanYRef.current)
  const zOct = reachedOctave(spanZRef.current)
  const jacks = jackRef.current
  const cents = getCents()

  // what the summary records: a real telemetry-derived pass for each step
  const verified = (id: WizStepId): boolean => {
    switch (id) {
      case 'prepare':
        return pre.readyToCapture
      case 'capture':
        return capture?.afterCents != null
      case 'jacks':
        return (
          jackProbeOk(jacks.x) && jackProbeOk(jacks.y) && jackProbeOk(jacks.z)
        )
      case 'sweepY':
        return yOct
      case 'sweepZ':
        return zOct
      case 'tuning':
        return inTune(cents)
      case 'done':
        return true
    }
  }

  // the gate for "Siguiente". Steps whose check is reliably telemetry-measured
  // block until verified; steps that need v2 voices frames (capture, tuning) or
  // a signal-carrying cable (jacks — detection is voltage-based) stay
  // advanceable, so a module without that telemetry never traps the operator.
  // The summary still records the truth via verified().
  // Only the capture pre-conditions hard-block: jacks out + quiet is reliable
  // and a bad rest capture is not recoverable. The sweeps, jack test and tuning
  // are advisory — a guessed octave threshold, a bare cable or missing voices
  // telemetry must never trap a remote operator. The summary records the truth.
  const BLOCKING: WizStepId[] = ['prepare']
  const canAdvance = (id: WizStepId): boolean => {
    if (id === 'done') return true
    if (id === 'capture')
      return (
        capture != null &&
        (capture.afterCents != null || now - capture.sentAt > EFFECT_TIMEOUT_MS)
      )
    if (!BLOCKING.includes(id)) return true
    return verified(id)
  }

  const doCapture = () => {
    const before = getCents()
    sendCaptureRests()
    pushLog(null, 'CC113 val 9 sent (capture rests)')
    setCapture({ sentAt: now, beforeCents: before, afterCents: null })
  }

  const advance = () => {
    setPass((p) => ({ ...p, [step.id]: verified(step.id) }))
    if (idx < WIZARD_STEPS.length - 1) setIdx(idx + 1)
  }

  const exit = () => {
    if (a4HeldRef.current) {
      noteOff(A4_NOTE)
      a4HeldRef.current = false
    }
    setPlayMode(MODE_MONO)
    onExit()
  }

  const holdA4 = () => {
    if (a4HeldRef.current) {
      noteOff(A4_NOTE)
      a4HeldRef.current = false
    } else {
      noteOn(A4_NOTE)
      a4HeldRef.current = true
    }
    setTick((n) => n + 1)
  }

  const ySemi = spanSemitones(spanYRef.current)
  const zSemi = spanSemitones(spanZRef.current)
  const fmtRange = (s: { lo: number; hi: number }) =>
    `${s.lo.toFixed(1)}..${s.hi >= 0 ? '+' : ''}${s.hi.toFixed(1)} semitonos`

  return (
    <div className="cal-mode">
      <div className="cal-mode-head">
        <strong>Modo calibración</strong>
        <span className="cal-progress">
          paso {idx + 1}/{WIZARD_STEPS.length}
        </span>
        <button type="button" className="cal-exit" onClick={exit}>
          Salir
        </button>
      </div>

      {!serialConnected && (
        <p className="cal-hint warn">
          Conectá la telemetría (Connect serial) para ver los chequeos.
        </p>
      )}

      <ol className="cal-stepline">
        {WIZARD_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={
              i === idx
                ? 'now'
                : pass[s.id]
                  ? 'done'
                  : i < idx
                    ? 'done'
                    : 'todo'
            }
          >
            {s.title}
          </li>
        ))}
      </ol>

      <div className="cal-step">
        <h4>{step.title}</h4>
        <p className="cal-hint">{step.hint}</p>

        {step.id === 'prepare' && (
          <div className="cal-checks">
            <CheckRow
              ok={pre.jacksOk}
              label="jacks desconectados"
              value={pre.latest ? '' : 'sin datos'}
            />
            <CheckRow
              ok={pre.centered}
              label="trimmers al centro"
              value={
                pre.latest
                  ? `aX/aY/aZ ${pre.latest.ax}/${pre.latest.ay}/${pre.latest.az}`
                  : '—'
              }
            />
            <CheckRow
              ok={pre.pitchStable && pre.xStable && pre.yStable && pre.zStable}
              label="todo quieto (pp ≤2 en 2s)"
              value={
                pre.pp
                  ? `P:${pre.pp.pitch} X/Y/Z:${pre.pp.x}/${pre.pp.y}/${pre.pp.z}`
                  : '—'
              }
            />
          </div>
        )}

        {step.id === 'capture' && (
          <div className="cal-checks">
            <button
              type="button"
              disabled={noOut || !serialConnected || capture !== null}
              onClick={doCapture}
            >
              ▶ Capturar reposo
            </button>
            {capture && (
              <CheckRow
                ok={capture.afterCents != null}
                label="firmware aplicó los reposos"
                value={
                  capture.afterCents != null
                    ? `cents → ${capture.afterCents.toFixed(0)}`
                    : now - capture.sentAt > EFFECT_TIMEOUT_MS
                      ? 'sin efecto visible (¿voces en telemetría?)'
                      : 'esperando…'
                }
              />
            )}
          </div>
        )}

        {step.id === 'jacks' && (
          <div className="cal-checks">
            {(['x', 'y', 'z'] as const).map((ax) => (
              <CheckRow
                key={ax}
                ok={jackProbeOk(jacks[ax])}
                label={`eje ${ax.toUpperCase()}: enchufar y sacar`}
                value={`${jacks[ax].sawConnected ? 'conectó ✓' : 'conectar…'} · ${
                  jacks[ax].sawDisconnected ? 'sacó ✓' : 'sacar…'
                }`}
              />
            ))}
          </div>
        )}

        {step.id === 'sweepY' && (
          <div className="cal-checks">
            <CheckRow
              ok={yOct}
              label="Y llega a ±1 octava"
              value={`modY ${spanYRef.current.min}..${spanYRef.current.max} (${fmtRange(ySemi)})`}
            />
          </div>
        )}

        {step.id === 'sweepZ' && (
          <div className="cal-checks">
            <CheckRow
              ok={zOct}
              label="Z llega a ±1 octava"
              value={`modZ ${spanZRef.current.min}..${spanZRef.current.max} (${fmtRange(zSemi)})`}
            />
          </div>
        )}

        {step.id === 'tuning' && (
          <div className="cal-checks">
            <button
              type="button"
              disabled={noOut || !serialConnected}
              onClick={holdA4}
            >
              {a4HeldRef.current ? '■ Soltar A4' : '▶ Tocar A4'}
            </button>
            <CheckRow
              ok={inTune(cents)}
              label="A4 afinado (±15 cents)"
              value={cents != null ? `${cents.toFixed(0)} cents` : '— (sin voces)'}
            />
          </div>
        )}

        {step.id === 'done' && (
          <div className="cal-summary">
            {WIZARD_STEPS.filter((s) => s.id !== 'done').map((s) => (
              <CheckRow key={s.id} ok={pass[s.id] === true} label={s.title} />
            ))}
            <p className="cal-hint">
              {WIZARD_STEPS.filter((s) => s.id !== 'done').every(
                (s) => pass[s.id],
              )
                ? '✅ módulo verificado'
                : 'quedaron pasos en rojo — revisá arriba'}
            </p>
          </div>
        )}
      </div>

      <div className="row-btns cal-nav">
        {idx > 0 && step.id !== 'done' && (
          <button type="button" onClick={() => setIdx(idx - 1)}>
            ◀ Atrás
          </button>
        )}
        {step.id === 'done' ? (
          <button type="button" onClick={exit}>
            Terminar
          </button>
        ) : (
          <button
            type="button"
            className="cal-next"
            disabled={!canAdvance(step.id)}
            onClick={advance}
          >
            Siguiente ▶
          </button>
        )}
      </div>
    </div>
  )
}
