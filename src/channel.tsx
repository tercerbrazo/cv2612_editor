import React from 'react'
import Algorithm from './algorithm'
import Operator from './operator'
import Slider from './slider'

const Channel = () => {
  return (
    <>
      <div className="four-cols">
        <div className="col">
          <Slider id="lfo" />
          <Slider id="st" />
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
        <div className="col">
          <Operator op={0} />
        </div>
        <div className="col">
          <Operator op={1} />
        </div>
        <div className="col">
          <Operator op={2} />
        </div>
        <div className="col">
          <Operator op={3} />
        </div>
      </div>
    </>
  )
}

export default Channel
