import React, { FC } from 'react'
import { useSnapshot } from 'valtio'
import { state } from './context'

type StereoProps = {
  cid: ChannelId
}

const OUT1 = 0b01
const OUT2 = 0b10

const Stereo: FC<StereoProps> = ({ cid }) => {
  const snap = useSnapshot(state)

  const val = snap.patches[snap.pid].routing[cid]

  const toggle1 = () => {
    state.patches[state.pid].routing[cid] ^= OUT1
  }

  const toggle2 = () => {
    state.patches[state.pid].routing[cid] ^= OUT2
  }

  return (
    <div className="stereo">
      <div onClick={toggle1} className={`out ${val & OUT1 ? 'on' : ''}`}>
        1
      </div>
      <div onClick={toggle2} className={`out ${val & OUT2 ? 'on' : ''}`}>
        2
      </div>
    </div>
  )
}

export { Stereo }
