import { PlayModeEnum } from './enums'

import React from 'react'
import { useSnapshot } from 'valtio'
import Channel from './channel'
import { state } from './context'
import Dropdown from './dropdown'
import Sequencer from './sequencer'
import Slider from './slider'

const Scene = () => {
  const snap = useSnapshot(state)

  return (
    <>
      <br />
      <div className="four-cols">
        <div className="col">
          <Dropdown id="pm" />
          <Dropdown id="rc" />
        </div>
        <div className="col">
          <Slider id="tr" />
          <Slider id="vs" />
        </div>
        <div className="col">
          <Slider id="tu" />
        </div>
        <div className="col">
          <Slider id="lb" />
        </div>
      </div>

      {snap.settings.pm === PlayModeEnum.SEQ && <Sequencer />}

      <Channel />
    </>
  )
}

export default Scene
