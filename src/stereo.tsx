import React, { FC } from 'react'
import { useSnapshot } from 'valtio'
import { sendMidiParam, state } from './context'

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
    for (let pid = 0; pid < 4; pid++) {
      state.patches[pid].channels[cid].st = newValue
      sendMidiParam('st', pid as PatchId, cid, 0, newValue)
    }
  }

  const handleRightClick = () => {
    const newValue = ((right ? 0 : 1) << 1) | left
    for (let pid = 0; pid < 4; pid++) {
      state.patches[pid].channels[cid].st = newValue
      sendMidiParam('st', pid as PatchId, cid, 0, newValue)
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
