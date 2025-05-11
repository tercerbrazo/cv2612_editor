import React, { useCallback } from 'react'
import Calibration from './calibration'
import InstrumentsLoader from './instruments-loader'
import { state } from './context'
import logo from './logo.png'
import Midi from './midi'
import Patch from './patch'
import Scene from './scene'
import './styles.sass'
import { useSnapshot } from 'valtio'

const App = () => {
  const snap = useSnapshot(state)

  const renderView = useCallback(() => {
    if (snap.instrumentsLoader) {
      return (
        <>
          <Midi />
          <InstrumentsLoader />
        </>
      )
    }
    if (snap.calibrationStep > 0) {
      return <Calibration />
    }

    return (
      <>
        <Patch />
        <Midi />
        <Scene />
      </>
    )
  }, [snap.calibrationStep, snap.instrumentsLoader])

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
