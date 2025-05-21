import React, { FC } from 'react'
import { useSnapshot } from 'valtio'
import { sendMidiParam, state } from './context'

type StereoProps = {
  cid: ChannelId
}

const Stereo: FC<StereoProps> = ({ cid }) => {
  const snap = useSnapshot(state)

  const value = snap.routing[cid]
  const left = Boolean(value & 0b01)
  const right = Boolean(value & 0b10)

  const updateRouting = (l: boolean, r: boolean) => {
    state.routing[cid] = (((r ? 1 : 0) << 1) | (l ? 1 : 0)) as Routing
    sendMidiParam('lr', 0, cid, 0, state.routing[cid])
  }

  const toggleLeft = () => updateRouting(!left, right)
  const toggleRight = () => updateRouting(left, !right)

  return (
    <div className="stereo">
      <div onClick={toggleLeft} className={`left ${left ? 'on' : ''}`}>
        1
      </div>
      <div onClick={toggleRight} className={`right ${right ? 'on' : ''}`}>
        2
      </div>
    </div>
  )
}

export { Stereo }
