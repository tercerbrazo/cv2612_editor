import React from 'react'
import { useSnapshot } from 'valtio'
import Algorithm from './algorithm'
import { state } from './context'
import Operator from './operator'
import Slider from './slider'
import { CARRIER_OPS } from './utils/carriers'

const operatorsOrder = [0, 2, 1, 3] as const

const Channel = () => {
  const snap = useSnapshot(state)
  // muted: routes to neither output — edits here are inaudible
  const patch = snap.patches[snap.pid]
  const muted = snap.selection.every((s) => patch.routing[s.cid] === 0)
  // inert without LFO: FMS always; AMS unless an op uses AM; per-op AM unless AMS>0
  const lfoOff = snap.selection.every((s) => patch.scenes[s.sid].lfo === 0)
  const chSel = (s: { sid: number; cid: number }) =>
    patch.scenes[s.sid].channels[s.cid]
  const noOpAm = snap.selection.every((s) =>
    chSel(s).operators.every((o) => o.am === 0),
  )
  const amsZero = snap.selection.every((s) => chSel(s).ams === 0)
  const amsInert = lfoOff || noOpAm // AMS: no LFO, or no operator uses AM
  const amInert = lfoOff || amsZero // per-op AM: no LFO, or channel AMS is 0
  // carrier set for the selected algorithm (null if the selection mixes algos)
  const als = snap.selection.map((s) => patch.scenes[s.sid].channels[s.cid].al)
  const carriers = als.every((a) => a === als[0]) ? CARRIER_OPS[als[0]] : null
  // feedback is only on operator 1 (S1); fb=0 → pure sine
  const fbZero = snap.selection.every(
    (s) => patch.scenes[s.sid].channels[s.cid].fb === 0,
  )

  return (
    <div
      className={muted ? 'channel muted' : 'channel'}
      title={muted ? 'Muted channel (both stereo outs off)' : undefined}
    >
      <div className="four-cols">
        <div className="col">
          <Slider id="lfo" />
        </div>
        <div className="col">
          <Slider id="ams" inert={amsInert} />
          <Slider id="fms" inert={lfoOff} />
        </div>
        <div className="col">
          <Slider id="al" />
          <Slider id="fb" />
        </div>
        <div className="col">
          <Algorithm />
        </div>
      </div>
      <div className="four-cols">
        {operatorsOrder.map((o) => (
          <div key={o} className="col">
            <Operator
              op={o}
              amInert={amInert}
              carrier={carriers ? carriers.includes(o) : undefined}
              feedbackOp={o === 0}
              fbZero={fbZero}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Channel
