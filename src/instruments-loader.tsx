import React, { FC, useCallback, useMemo, useState } from 'react'
import { useParamData } from './context'
import Envelope from './envelope'
import algorithmAscii from './utils/algorithmAscii'

type InstOp = Record<OperatorParam, number>

type Inst = Record<ChannelParam, number> & {
  name: string
  ops: InstOp[]
}

/*
* Converts a dmp instrument file into an object of CC
* being the `key` the cc number and the `value` the cc value
* to be sent in order to set this dmp in the cv2612 module
    http://www.deflemask.com/DMP_SPECS.txt
    1 Byte: LFO (FMS on YM2612, PMS on YM2151)
    1 Byte: FB
    1 Byte: ALG
    1 Byte: LFO2 (AMS on YM2612, AMS on YM2151)
    Repeat this TOTAL_OPERATORS times
      1 Byte: MULT
      1 Byte: TL
      1 Byte: AR
      1 Byte: DR
      1 Byte: SL
      1 Byte: RR
      1 Byte: AM
      1 Byte: RS
      1 Byte: DT (DT2<<4 | DT on YM2151)
      1 Byte: D2R
      1 Byte: SSGEG_Enabled <<3 | SSGEG
      */

/*
 * Transforms a dmp buffer into a compact 26-bytes representation
 * of a YM2612 channel, that matches chip REGISTERS bit a bit
 */
const readDmp = (data: Int8Array, name: string): Inst | null => {
  //version 9 or 11, genesis, FM patch
  if (
    (data[0] === 0x09 && data[1] === 0x01 && data[2] === 0x00) ||
    (data[0] === 0x0b && data[1] === 0x02 && data[2] === 0x01)
  ) {
    const ops: InstOp[] = []
    for (let op = 0; op < 4; op++) {
      const o = op * 11 + 7

      ops.push({
        mul: data[o + 0],
        tl: data[o + 1],
        ar: data[o + 2],
        d1: data[o + 3],
        sl: data[o + 4],
        rr: data[o + 5],
        am: data[o + 6],
        rs: data[o + 7],
        det: data[o + 8],
        d2: data[o + 9],
      })
    }
    return {
      name,
      st: 3,
      fms: data[3],
      fb: data[4],
      al: data[5],
      ams: data[6],
      ops,
    }
  } else {
    return null
  }
}

/*
 * YM2612 layout reference
+-----+-----+------+------+------+------+-----+-----+
|  -  |  -  | FB   |  #   |   #  | ALG  |  #  |  #  |
| L   | R   | AMS  |  #   |   #  | FMS  |  #  |  #  |
|  -  | DT1 |  #   |  #   | MUL  |   #  |  #  |  #  |
|  -  | TL  |  #   |  #   |  #   |   #  |  #  |  #  |
| RS  |  #  |   -  | AR   |  #   |   #  |  #  |  #  |
| AM  |  -  |   -  | D1R  |  #   |   #  |  #  |  #  |
|  -  |  -  |   -  | D2R  |  #   |   #  |  #  |  #  |
| D1L |  #  |   #  |  #   | RR   |   #  |  #  |  #  |
+-----+-----+------+------+------+------+-----+-----+
*/

type InstrumentSelectProps = { instruments: Inst[]; index: number }

const InstrumentSelect: FC<InstrumentSelectProps> = ({
  instruments,
  index,
}) => {
  const [selected, setSelected] = useState(index ?? 0)

  const onChange: React.ChangeEventHandler<HTMLSelectElement> = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    setSelected(val)
  }

  return (
    <select onChange={onChange} value={selected}>
      {instruments.map((inst, i) => (
        <option key={inst.name} value={i}>
          {inst.name}
        </option>
      ))}
    </select>
  )
}

type SliderProps = {
  id: Param
  value: number
}
const Slider = ({ id, value }: SliderProps) => {
  const { label, max } = useParamData(id, 0)

  return (
    <div className="slider">
      <label>{label}</label>
      <input disabled type="range" max={max} value={value} />
      <span>{value}</span>
    </div>
  )
}

type OperatorProps = { op: InstOp }
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

type InstrumentPreviewerProps = {
  instruments: Inst[]
}
const InstrumentPreviewer: FC<InstrumentPreviewerProps> = ({ instruments }) => {
  const [selected, setSelected] = useState(0)

  const instrument = useMemo(
    () => instruments[selected],
    [selected, instruments],
  )

  const onChange: React.ChangeEventHandler<HTMLSelectElement> = (ev) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    setSelected(val)
  }

  return instrument === undefined ? (
    <h4>Upload some DMPs</h4>
  ) : (
    <div className="previewer">
      <nav>
        <a
          href="/"
          title="Prev"
          onClick={(ev) => {
            ev.preventDefault()
            setSelected((prev) =>
              prev == 0 ? instruments.length - 1 : prev - 1,
            )
          }}
        >
          {`<`}
        </a>
        <select onChange={onChange} value={selected}>
          {instruments.map((inst, i) => (
            <option key={inst.name} value={i}>
              {inst.name}
            </option>
          ))}
        </select>
        <a
          href="/"
          title="Next"
          onClick={(ev) => {
            ev.preventDefault()
            setSelected((prev) =>
              prev == instruments.length - 1 ? 0 : prev + 1,
            )
          }}
        >
          {`>`}
        </a>
      </nav>
      <br />
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
          <Operator op={instrument.ops[0]} />
        </div>
        <div className="col">
          <Operator op={instrument.ops[1]} />
        </div>
        <div className="col">
          <Operator op={instrument.ops[2]} />
        </div>
        <div className="col">
          <Operator op={instrument.ops[3]} />
        </div>
      </div>
    </div>
  )
}

const patches = ['A', 'B', 'C', 'D']
const channels = [0, 1, 2, 3, 4, 5]

const InstrumentsLoader = () => {
  const [instruments, setInstruments] = useState<Inst[]>([])

  const handleUploadClick = useCallback(
    (ev: React.MouseEvent<HTMLAnchorElement>) => {
      ev.preventDefault()
      const fileInput = document.createElement('input')
      fileInput.type = 'file'
      fileInput.accept = '.dmp'
      fileInput.multiple = true

      fileInput.addEventListener('change', async (event) => {
        const { files } = event.target as HTMLInputElement

        if (files) {
          const filePromises: Promise<any>[] = []

          for (let i = 0; i < files.length; i++) {
            const file = files[i]

            const promise = new Promise<any>((resolve, reject) => {
              const reader = new FileReader()

              reader.onload = (e) => {
                if (e.target) {
                  const data = new Int8Array(e.target.result as ArrayBuffer)
                  const name = file.name.replace('.dmp', '')
                  resolve(readDmp(data, name))
                } else {
                  resolve(null)
                }
              }

              reader.onerror = reject

              reader.readAsArrayBuffer(file)
            })

            filePromises.push(promise)
          }

          const newInstruments = (await Promise.all(filePromises)).filter(
            Boolean,
          )
          const newNames = new Set(newInstruments.map((i) => i.name))

          setInstruments((prev) =>
            [
              ...prev.filter((inst) => !newNames.has(inst.name)),
              ...newInstruments,
            ].sort((a, b) => a.name.localeCompare(b.name)),
          )
        }
      })

      fileInput.click()
    },
    [],
  )

  return (
    <div className="instruments">
      <nav className="midi">
        <span>Instruments</span>
        <span> </span>
        <span> </span>
        <span> </span>
        <span> </span>
        <span> </span>
        <a href="/" title="Upload DMP" onClick={handleUploadClick}>
          UPLOAD
        </a>
      </nav>
      <table>
        <thead>
          <tr>
            <th></th>
            {channels.map((c) => (
              <th key={c}>{c + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {patches.map((p) => (
            <tr key={p}>
              <td>{p}</td>
              {channels.map((c) => (
                <th key={c}>
                  <InstrumentSelect instruments={instruments} index={0} />
                </th>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <br />
      <br />
      <InstrumentPreviewer instruments={instruments} />
    </div>
  )
}

export default InstrumentsLoader
