import React, { useCallback } from 'react'
import Calibration from './calibration'
import InstrumentsLoader from './instruments-loader'
import { state } from './context'
import logo from './logo.png'
import Midi from './midi'
import Patch from './patch'
import { PlayModeEnum } from './enums'
import { useSnapshot } from 'valtio'
import Channel from './channel'
import Dropdown from './dropdown'
import Sequencer from './sequencer'
import Slider from './slider'
import './styles.sass'

const App = () => {
  const snap = useSnapshot(state)

  const renderView = useCallback(() => {
    if (snap.calibrationStep > 0) {
      return <Calibration />
    }

    return (
      <>
        <Midi />
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
        <Patch />
        <InstrumentsLoader />
        <br />
        <Channel />
      </>
    )
  }, [snap.calibrationStep, snap.settings.pm])

  return (
    <>
      <div className="two-cols">
        <div className="col">
          <img
            alt=""
            style={{ filter: 'invert(1)' }}
            src={logo}
            height="80px"
          />
        </div>
        <div className="col">
          <h3 style={{ textAlign: 'right' }}>CV-2612 Editor</h3>
        </div>
      </div>
      {renderView()}
    </>
  )
}

export default App
