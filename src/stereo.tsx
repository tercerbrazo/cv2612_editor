import React, { FC } from 'react'
import { useSnapshot } from 'valtio'
import { state } from './context'

type StereoProps = {
  cid: ChannelId
}

const Stereo: FC<StereoProps> = ({ cid }) => {
  const snap = useSnapshot(state)
  // all `st` values are the same between patches
  // FIXME: refactor data shape to reflect this
  const value = snap.patches[0].channels[cid].st
  const left = value & 0b01
  const right = (value & 0b10) >> 1

  const handleLeftClick = () => {
    const newValue = (right << 1) | (left ? 0 : 1)
    for (let i = 0; i < 4; i++) {
      state.patches[i].channels[cid].st = newValue
    }
  }

  const handleRightClick = () => {
    const newValue = ((right ? 0 : 1) << 1) | left
    for (let i = 0; i < 4; i++) {
      state.patches[i].channels[cid].st = newValue
    }
  }

  return (
    <div className="stereo">
      <div onClick={handleLeftClick} className={`left ${left ? 'on' : ''}`}>
        1
      </div>
      <div onClick={handleRightClick} className={`right ${right ? 'on' : ''}`}>
        2
      </div>
    </div>
  )
}

export { Stereo }
