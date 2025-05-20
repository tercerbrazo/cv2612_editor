import React from 'react'
import { state, useParamMidi, clearSequence, toggleSeqStep } from './context'
import { useSnapshot } from 'valtio'
import MidiIO from './midi-io'

const Sequencer = () => {
  const snap = useSnapshot(state)

  const { cc, ch } = useParamMidi('stp', 0)

  const handleHeaderClick = (val: number) => {
    state.settings.stp = val
    MidiIO.sendCC(ch, cc, val)
  }

  return (
    <div className="four-cols">
      <div className="col">
        <button className={`btn`} onClick={() => clearSequence()}>
          CLEAR SEQ
        </button>
      </div>
      <div className="tcol">
        <div className="seq">
          {snap.settings.sequence.map((voiceSteps, voiceIndex) => (
            <React.Fragment key={voiceIndex}>
              {voiceIndex === 0 && (
                <div className="seq-row">
                  <div className="seq-cell seq-header" />
                  {voiceSteps.map((_step, stepIndex) => (
                    <div
                      onClick={() => handleHeaderClick(stepIndex)}
                      key={stepIndex}
                      className={`seq-cell seq-header ${stepIndex <= snap.settings.stp ? 'active' : 'inactive'
                        }`}
                    >
                      {stepIndex + 1}
                    </div>
                  ))}
                </div>
              )}
              <div className="seq-row">
                <div className="seq-cell seq-header">{voiceIndex + 1}</div>
                {voiceSteps.map((stepValue, stepIndex) => {
                  return (
                    <div
                      className={`seq-cell ${stepValue ? 'step-on' : ''} ${stepIndex <= snap.settings.stp ? 'active' : 'inactive'
                        }`}
                      key={stepIndex}
                      onClick={() => toggleSeqStep(voiceIndex, stepIndex)}
                    />
                  )
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Sequencer
