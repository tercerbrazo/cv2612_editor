import React from 'react'
import Algorithm from './algorithm'
import Operator from './operator'
import Slider from './slider'

const operatorsOrder = [0, 2, 1, 3] as const

const Channel = () => {
  return (
    <>
      <div className="four-cols">
        <div className="col">
          <Slider id="lfo" />
        </div>
        <div className="col">
          <Slider id="ams" />
          <Slider id="fms" />
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
            <Operator op={o} />
          </div>
        ))}
      </div>
    </>
  )
}

export default Channel
