import React, { useContext } from "react"
import Operator from "./operator"
import Slider from "./slider"
import algorithmAscii from "./utils/algorithmAscii"
import { CV2612Context } from "./context"

const Channel = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const patch = state.patches[state.patchIdx]
  // get the patch/channel algorithm
  const al = patch[state.channelIdx][20] >> 4

  const onAlgorithmClick = ev => {
    ev.preventDefault()
    dispatch({ type: "reset-channel" })
  }

  return (
    <>
      <div className="four-cols">
        <div className="col">
          <Slider label="lfo" cc={1} noChannel bits={3} />
          <Slider label="st" cc={24} bits={2} />
        </div>
        <div className="col">
          <Slider label="ams" cc={22} bits={2} />
          <Slider label="fms" cc={23} bits={3} />
        </div>
        <div className="col">
          <Slider label="al" cc={20} bits={3} />
          <Slider label="fb" cc={21} bits={3} />
        </div>
        <div className="col">
          <a
            href="!#"
            onClick={onAlgorithmClick}
            style={{ textDecoration: "none" }}
          >
            <pre className="algorithm">{algorithmAscii(al)}</pre>
          </a>
        </div>
      </div>
      <div className="four-cols">
        <div className="col">
          <Operator op={0} />
        </div>
        <div className="col">
          <Operator op={2} />
        </div>
        <div className="col">
          <Operator op={1} />
        </div>
        <div className="col">
          <Operator op={3} />
        </div>
      </div>
    </>
  )
}

export default Channel