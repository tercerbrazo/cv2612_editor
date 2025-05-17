import React, { useCallback } from 'react'
import { state, dispatch } from './context'
import { useSnapshot } from 'valtio'

const Sequencer = () => {
  const snap = useSnapshot(state)
  const handleCellClick = useCallback(
    (voice: number, step: number) => {
      dispatch({ type: 'toggle-seq-step', voice, step })
    },
    [dispatch],
  )

  const handleHeaderClick = useCallback(
    (step: number) => {
      dispatch({ type: 'change-param', id: 'stp', val: step, op: 0 })
    },
    [dispatch],
  )

  const handleClearClick = useCallback(() => {
    dispatch({ type: 'clear-sequence' })
  }, [dispatch])

  return (
    <div className="four-cols">
      <div className="col">
        <button className={`btn`} onClick={() => handleClearClick()}>
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
                      onClick={() => handleCellClick(voiceIndex, stepIndex)}
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
