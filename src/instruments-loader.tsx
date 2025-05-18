import React, { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import { state } from './context'
import Envelope from './envelope'
import algorithmAscii from './utils/algorithmAscii'
import { getParamMeta } from './utils/paramsHelpers'
import { readDmp } from './utils/readDmp'
import { Stereo } from './stereo'

type SliderProps = {
  id: Param
  value: number
}
const Slider = ({ id, value }: SliderProps) => {
  const { label, max } = getParamMeta(id)

  return (
    <div className="slider">
      <label>{label}</label>
      <input disabled type="range" max={max} value={value} />
      <span>{value}</span>
    </div>
  )
}

type OperatorProps = { op: Operator }
const Operator = ({ op }: OperatorProps) => {
  return (
    <div className="operator">
      <Slider id="ar" value={op.ar} />
      <Slider id="d1" value={op.d1} />
      <Slider id="sl" value={op.sl} />
      <Slider id="d2" value={op.d2} />
      <Slider id="rr" value={op.rr} />
      <Slider id="tl" value={op.tl} />
      <Envelope {...op} />
      <Slider id="mul" value={op.mul} />
      <Slider id="det" value={op.det} />
      <Slider id="rs" value={op.rs} />
      <Slider id="am" value={op.am} />
    </div>
  )
}

const InstrumentsPreview = () => {
  const snap = useSnapshot(state)
  const instrument = snap.patches[snap.patchIdx].channels[snap.channelIdx]

  return (
    <>
      <div className="four-cols">
        <div className="col"></div>
        <div className="col">
          <Slider id="ams" value={instrument.ams} />
          <Slider id="fms" value={instrument.fms} />
        </div>
        <div className="col">
          <Slider id="al" value={instrument.al} />
          <Slider id="fb" value={instrument.fb} />
        </div>
        <div className="col">
          <pre className="algorithm">{algorithmAscii(instrument.al)}</pre>
        </div>
      </div>
      <div className="four-cols">
        <div className="col">
          <Operator op={instrument.operators[0]} />
        </div>
        <div className="col">
          <Operator op={instrument.operators[1]} />
        </div>
        <div className="col">
          <Operator op={instrument.operators[2]} />
        </div>
        <div className="col">
          <Operator op={instrument.operators[3]} />
        </div>
      </div>
    </>
  )
}

const cloneInstrument = (val: number) => {
  state.patches[state.patchIdx].channels[state.channelIdx] = deepClone(
    state.library[val],
  )
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
      const val = prev === 0 ? snap.library.length - 1 : prev - 1
      cloneInstrument(val)
      return val
    })
  }

  const handleNextClick: React.MouseEventHandler<HTMLAnchorElement> = (ev) => {
    ev.preventDefault()
    setSelected((prev) => {
      const val = prev === snap.library.length - 1 ? 0 : prev + 1
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

  const handleLoadClick = (ev: React.MouseEvent<HTMLAnchorElement>) => {
    ev.preventDefault()
    addDmpInstruments()
  }

  const handleBackClick = (ev: React.MouseEvent<HTMLAnchorElement>) => {
    ev.preventDefault()
    state.instrumentsLoader = false
  }

  return (
    <div className="previewer">
      <nav>
        <a href="/" title="Prev" onClick={handlePrevClick}>
          {`<`}
        </a>
        <select onChange={handleChange} value={selected}>
          <option value={-1} disabled selected={selected === -1}>
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
        <a href="/" title="Load DMP files" onClick={handleLoadClick}>
          LOAD
        </a>
        <a href="/" title="Back to Editor" onClick={handleBackClick}>
          DONE
        </a>
      </nav>
      <br />
      <InstrumentsPreview />
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
      <table className="instruments-matrix">
        <thead>
          <tr>
            <th></th>
            {snap.patches[0].channels.map((_c, cid) => (
              <th key={cid}>{cid + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>out</td>
            {snap.patches[0].channels.map((_c, cid) => (
              <td>
                <Stereo cid={cid as ChannelId} />
              </td>
            ))}
          </tr>
          {snap.patches.map((p, pid) => (
            <tr key={pid}>
              <td>{'ABCD'[pid]}</td>
              {p.channels.map((ch, cid) => {
                const libIndex = state.library.findIndex(
                  (inst) => inst.name === ch.name,
                )
                let changed = false
                if (libIndex !== -1) {
                  changed =
                    JSON.stringify(ch) !==
                    JSON.stringify(state.library[libIndex])
                }
                return (
                  <td
                    key={cid}
                    className={`${snap.patchIdx === pid && snap.channelIdx === cid ? 'active' : ''}`}
                    onClick={() => {
                      state.patchIdx = pid as PatchId
                      state.channelIdx = cid as ChannelId
                    }}
                  >
                    {ch.name}
                    {changed ? ' (*)' : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <br />
      <br />
      <InstrumentsBrowser />
    </div>
  )
}

export default InstrumentsLoader
