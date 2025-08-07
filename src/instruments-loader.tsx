import React, { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import { instrumentName, state, syncCurrentChannel, syncMidi } from './context'
import { MenuDropdown } from './menu-dropdown'
import { Stereo } from './stereo'
import { readDmp } from './utils/readDmp'
import Slider from './slider'

const cloneInstrument = (val: number) => {
  state.patchIdxs.forEach((p) => {
    state.channelIdxs.forEach((c) => {
      state.patches[p].channels[c] = deepClone(state.library[val])
    })
  })
  syncMidi()
  // syncCurrentChannel()
}

const InstrumentsBrowser = () => {
  const snap = useSnapshot(state)
  const [selected, setSelected] = useState(-1)

  useEffect(() => {
    const name = state.patches[state.patchIdx].channels[state.channelIdx].name
    const index = state.library.findIndex((inst) => inst.name === name)
    setSelected(index)
  })

  const handlePrevClick: React.MouseEventHandler<HTMLAnchorElement> = (ev) => {
    ev.preventDefault()
    setSelected((prev) => {
      const val = prev <= 0 ? snap.library.length - 1 : prev - 1
      cloneInstrument(val)
      return val
    })
  }

  const handleNextClick: React.MouseEventHandler<HTMLAnchorElement> = (ev) => {
    ev.preventDefault()
    setSelected((prev) => {
      const val = prev >= snap.library.length - 1 ? 0 : prev + 1
      cloneInstrument(val)
      return val
    })
  }

  const handleChange: React.ChangeEventHandler<HTMLSelectElement> = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    setSelected(val)
    cloneInstrument(val)
  }

  return (
    <div className="previewer">
      <nav>
        <a href="/" title="Prev" onClick={handlePrevClick}>
          {`<`}
        </a>
        <select onChange={handleChange} value={selected}>
          <option value={-1} disabled>
            Pick an instrument for {'ABCD'[snap.patchIdx]}
            {snap.channelIdx + 1}
          </option>
          {snap.library.map((inst, i) => (
            <option key={inst.name} value={i}>
              {inst.name}
            </option>
          ))}
        </select>
        <a href="/" title="Next" onClick={handleNextClick}>
          {`>`}
        </a>
        <MenuDropdown
          title="More..."
          text="⋯"
          options={[{ label: 'Add DMP', value: 1 }]}
          onSelect={(option) => {
            switch (option.value) {
              case 1:
                addDmpInstruments()
                break
            }
          }}
        />
      </nav>
      <br />
    </div>
  )
}

const addDmpInstruments = () => {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.dmp'
  fileInput.multiple = true

  fileInput.addEventListener('change', async (event) => {
    const { files } = event.target as HTMLInputElement

    if (files) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]

        const reader = new FileReader()

        reader.onload = (e) => {
          if (e.target) {
            const data = new Int8Array(e.target.result as ArrayBuffer)
            const name = file.name.replace('.dmp', '')
            const channel = readDmp(data, name)
            if (channel) {
              const index = state.library.findIndex(
                (inst) => inst.name === name,
              )
              if (index !== -1) {
                state.library[index] = channel
              } else {
                state.library.push(channel)
                state.library.sort((a, b) => a.name.localeCompare(b.name))
              }
            }
          }
        }

        reader.readAsArrayBuffer(file)
      }
    }
  })

  fileInput.click()
}

const InstrumentsLoader = () => {
  const snap = useSnapshot(state)

  return (
    <div className="instruments">
      <InstrumentsBrowser />
      <table className="instruments-matrix">
        <thead>
          <tr>
            <th></th>
            {snap.patches.map((_p, pid) => (
              <th
                key={pid}
                className={`${snap.patchIdxs.includes(pid as PatchId) ? 'active' : ''}`}
                onClick={() => {
                  if (state.patchIdxs.includes(pid as PatchId)) {
                    if (state.patchIdxs.length === 1) return

                    state.patchIdxs = state.patchIdxs.filter((p) => p !== pid)
                  } else {
                    state.patchIdxs.push(pid as PatchId)
                  }
                }}
              >
                {'ABCD'[pid]}
              </th>
            ))}
            <th>OUTs</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>LFOs</td>
            {snap.patches.map((_p, pid) => (
              <td key={pid}>
                <Slider id="lfo" />
              </td>
            ))}
            <td></td>
          </tr>
          {snap.patches[0].channels.map((_ch, cid) => (
            <tr key={cid}>
              <td
                className={`${snap.channelIdxs.includes(cid as ChannelId) ? 'active' : ''}`}
                onClick={() => {
                  if (state.channelIdxs.includes(cid as ChannelId)) {
                    if (state.channelIdxs.length === 1) return

                    state.channelIdxs = state.channelIdxs.filter(
                      (c) => c !== cid,
                    )
                  } else {
                    state.channelIdxs.push(cid as ChannelId)
                  }
                }}
              >
                {cid + 1}
              </td>
              {snap.patches.map((_p, pid) => (
                <td
                  key={pid}
                  className={`${snap.patchIdxs.includes(pid as PatchId) && snap.channelIdxs.includes(cid as ChannelId) ? 'active' : ''}`}
                  onClick={() => {
                    state.patchIdx = pid as PatchId
                    state.channelIdx = cid as ChannelId
                  }}
                >
                  {instrumentName(pid, cid)}
                </td>
              ))}
              <td>
                <Stereo cid={cid as ChannelId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default InstrumentsLoader
