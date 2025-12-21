import React, { useCallback } from 'react'
import { setCalibrationStep, state } from './context'

const CalibrationStart = () => {
  const handleCancelClick = useCallback(() => {
    setCalibrationStep(0)
  }, [])

  const handleStartClick = useCallback(() => {
    setCalibrationStep(2)
  }, [])

  return (
    <div>
      <h3>Module Calibration</h3>
      <p>This will guide you through step by step to calibrate your module.</p>
      <p>
        You do not need any measurement tool (like a multimeter or tuner) but
        you'll need a voltage signal to set your particular input range that
        will set the minimum/maximum of each CV modulator
      </p>
      <p>For reference, the expected voltage range is:</p>
      <ul>
        <li>Minimum: 2v</li>
        <li>Maximum: 10v</li>
      </ul>
      <button onClick={handleCancelClick}>Agh, not now...</button>
      <button onClick={handleStartClick}>Let's Go!</button>
    </div>
  )
}

const CalibrationStep = ({ name, children }) => {
  const handleExitClick = useCallback(() => {
    setCalibrationStep(0)
  }, [])

  const handleNextClick = useCallback(() => {
    setCalibrationStep(state.calibrationStep + 1)
  }, [state.calibrationStep])

  return (
    <div>
      <h3>{name}</h3>
      {children}
      <p>Hit next when ready.</p>
      <button onClick={handleExitClick}>Exit</button>
      <button onClick={handleNextClick}>Next</button>
    </div>
  )
}

const Input = ({ name, signal }) => {
  return (
    <CalibrationStep name={name}>
      <p>
        Plug in a cable with a <strong>{signal}</strong> signal.
      </p>
    </CalibrationStep>
  )
}

const CalibrationDone = () => {
  const handleDoneClick = useCallback(() => {
    setCalibrationStep(0)
  }, [])

  return (
    <div>
      <h3>Module Calibration</h3>
      <p>Your all set. You module is now calibrated.</p>
      <button onClick={handleDoneClick}>Back to Editor</button>
    </div>
  )
}

const Calibration = () => {
  switch (state.calibrationStep) {
    case 1:
      return <CalibrationStart />
    case 2:
      return <Input name="Input X" signal="low voltage" />
    case 3:
      return <Input name="Input X" signal="high voltage" />
    case 4:
      return <Input name="Input Y" signal="low voltage" />
    case 5:
      return <Input name="Input Y" signal="high voltage" />
    case 6:
      return <Input name="Input Z" signal="low voltage" />
    case 7:
      return <Input name="Input Z" signal="high voltage" />
    case 8:
      return <CalibrationDone />
    default:
      return null
  }
}

export default Calibration
