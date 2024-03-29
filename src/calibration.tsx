import React, { useCallback, useContext } from 'react'
import { CV2612Context } from './context'

const CalibrationStart = () => {
  const { dispatch } = useContext(CV2612Context)

  const handleCancelClick = useCallback(() => {
    dispatch({ type: 'calibration-step', step: 0 })
  }, [])

  const handleStartClick = useCallback(() => {
    dispatch({ type: 'calibration-step', step: 2 })
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
  const { state, dispatch } = useContext(CV2612Context)

  const handleExitClick = useCallback(() => {
    dispatch({ type: 'calibration-step', step: 0 })
  }, [])

  const handleNextClick = useCallback(() => {
    dispatch({ type: 'calibration-step', step: state.calibrationStep + 1 })
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

const Knob = ({ name, position }) => {
  return (
    <CalibrationStep name={name}>
      <p>
        Set the knob to <strong>{position}</strong>.
      </p>
    </CalibrationStep>
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
  const { dispatch } = useContext(CV2612Context)

  const handleDoneClick = useCallback(() => {
    dispatch({ type: 'calibration-step', step: 0 })
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
  const { state } = useContext(CV2612Context)

  switch (state.calibrationStep) {
    case 0:
      return null
    case 1:
      return <CalibrationStart />
    case 2:
      return <Knob name="Main Knob" position="position A" />
    case 3:
      return <Knob name="Main Knob" position="position B" />
    case 4:
      return <Knob name="Main Knob" position="position C" />
    case 5:
      return <Knob name="Main Knob" position="position D" />
    case 6:
      return <Knob name="Attenuverter X" position="left position" />
    case 7:
      return <Knob name="Attenuverter X" position="center position" />
    case 8:
      return <Knob name="Attenuverter X" position="right position" />
    case 9:
      return <Knob name="Attenuverter Y" position="left position" />
    case 10:
      return <Knob name="Attenuverter Y" position="center position" />
    case 11:
      return <Knob name="Attenuverter Y" position="right position" />
    case 12:
      return <Knob name="Attenuverter Z" position="left position" />
    case 13:
      return <Knob name="Attenuverter Z" position="center position" />
    case 14:
      return <Knob name="Attenuverter Z" position="right position" />
    case 15:
      return <Input name="Input X" signal="low voltage" />
    case 16:
      return <Input name="Input X" signal="high voltage" />
    case 17:
      return <Input name="Input Y" signal="low voltage" />
    case 18:
      return <Input name="Input Y" signal="high voltage" />
    case 19:
      return <Input name="Input Z" signal="low voltage" />
    case 20:
      return <Input name="Input Z" signal="high voltage" />

    case 21:
    default:
      return <CalibrationDone />
  }
}

export default Calibration
