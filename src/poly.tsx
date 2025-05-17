import { MidiChannelEnum } from './enums'

import React from 'react'
import { state, useParamData, useParamMidi } from './context'
import { useSnapshot } from 'valtio'

type MidiMappingProps = {
  id: Param
  op: OperatorId
}
const MidiMapping = ({ id, op }: MidiMappingProps) => {
  const { title, label } = useParamData(id, op)
  const { cc } = useParamMidi(id, op)
  return (
    <div data-title={title} className="midi-mapping">
      <label>{label}</label>
      <span className="cell">CC {cc}</span>
    </div>
  )
}

const MidiChannelDetails = () => {
  const snap = useSnapshot(state)
  if (snap.settings.rc === MidiChannelEnum.OMNI) {
    return (
      <>
        Notes will be played as MONO using all voices simultaneously.
        <br />
        Control Change messages will affect all voices.
      </>
    )
  }
  if (snap.settings.rc === MidiChannelEnum.FORWARD) {
    return (
      <>
        Notes on channel <b>N</b> will affect voice <b>N</b>, for <b>N</b> in
        [1..6]
        <br />
        Control Change messages will affect all voices, no matter the channel.
      </>
    )
  }
  if (snap.settings.rc === MidiChannelEnum.MULTITRACK) {
    return (
      <>
        Notes and CC on channel <b>N</b> will affect voice <b>N</b>, for{' '}
        <b>N</b> in [1..6]
      </>
    )
  }
  return (
    <>
      Same as <b>OMNI</b>, but only listening to channel {snap.settings.rc + 1}
      <br />
      Notes will be played as MONO using all voices simultaneously.
      <br />
      Control Change messages will affect all voices.
    </>
  )
}

const Poly = () => {
  const snap = useSnapshot(state)

  return (
    <>
      <p>
        <b>POLY</b> is a special performance mode that is not compatible with
        patch edition, due to midi message handling in this mode.
        <br />
        This is a MIDI only mode ( GATE/CV are disabled) and behaviour is based
        on the Midi Receive Channel setting. For{' '}
        <b>{MidiChannelEnum[snap.settings.rc]}</b>:
      </p>
      <blockquote>
        <MidiChannelDetails />
      </blockquote>
      <p>
        Patches and modulations are respected, but CCs sent within this mode
        will change the parameter in all four patches at once.
        <br />
        <br />
        MIDI mappings reference:
      </p>
      <div className="four-cols">
        <div className="col">
          <MidiMapping id="lfo" op={0} />
          <MidiMapping id="st" op={0} />
        </div>
        <div className="col">
          <MidiMapping id="ams" op={0} />
          <MidiMapping id="fms" op={0} />
        </div>
        <div className="col">
          <MidiMapping id="al" op={0} />
          <MidiMapping id="fb" op={0} />
        </div>
        <div className="col"></div>
      </div>
      <br />
      <div className="four-cols">
        {([0, 1, 2, 3] as OperatorId[]).map((op) => (
          <div className="col" key={op}>
            <MidiMapping id="ar" op={op} />
            <MidiMapping id="d1" op={op} />
            <MidiMapping id="sl" op={op} />
            <MidiMapping id="d2" op={op} />
            <MidiMapping id="rr" op={op} />
            <MidiMapping id="tl" op={op} />
            <MidiMapping id="mul" op={op} />
            <MidiMapping id="det" op={op} />
            <MidiMapping id="rs" op={op} />
            <MidiMapping id="am" op={op} />
          </div>
        ))}
      </div>
    </>
  )
}

export default Poly
