import React from 'react'
import * as zip from '@zip.js/zip.js'

import { useSnapshot } from 'valtio'
import {
  addToLibrary,
  cloneFromLibrary,
  cloneFromSibling,
  channelName,
  isChannelDirty,
  state,
} from './context'
import { MenuDropdown } from './menu-dropdown'
import { Stereo } from './stereo'
import { readDmp } from './utils/readDmp'
import { deepClone } from 'valtio/utils'
import { hashInstrument } from './utils/hashing'
import { readVGI } from './utils/readVgi'
import { readFui } from './utils/readFui'
import { BlobWriter, Uint8ArrayReader } from '@zip.js/zip.js'

const loadJSON = () => {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.json'

  fileInput.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement

    const file = target.files?.[0]

    if (file) {
      const reader = new FileReader()

      reader.onload = (e) => {
        try {
          const newState = JSON.parse(e.target?.result as string)
          // FIXME
        } catch (error) {
          console.error('Error parsing JSON:', error)
        }
      }

      reader.readAsText(file)
    }
  })

  fileInput.click()
}

const downloadJSON = () => {
  // Convert the object to a JSON string
  var jsonData = JSON.stringify(state)

  // Create a Blob from the JSON data
  var blob = new Blob([jsonData], { type: 'application/json' })

  // Create a URL for the Blob
  var url = URL.createObjectURL(blob)

  // Create a download link
  var a = document.createElement('a')
  a.href = url
  a.download = 'state.json'

  // Trigger the download
  a.click()

  // Clean up by revoking the URL
  URL.revokeObjectURL(url)
}

const exportInstruments = async () => {
  // create zip
  const zipWriter = new zip.ZipWriter(new BlobWriter('application/zip'))

  const indices = state.library.map((_entry, i) => i)
  for (const index of indices) {
    const libEntry = state.library[index]
    const inst = libEntry.instrument
    const name = libEntry.name
    const bytes = getDmpBytes(inst)

    // add file to zip
    await zipWriter.add(
      `${name}.dmp`,
      new Uint8ArrayReader(new Uint8Array(bytes)),
    )
  }

  // finalize zip
  const zipBlob = await zipWriter.close()

  // download
  const url = URL.createObjectURL(zipBlob)

  const a = document.createElement('a')
  a.href = url
  a.download = 'library.zip'
  a.click()

  URL.revokeObjectURL(url)
}

const getDmpBytes = (inst: Instrument) => {
  const bytes: number[] = []

  // version
  bytes.push(0x09)

  // header flags expected by reader
  bytes.push(0x01)
  bytes.push(0x00)

  // channel params
  bytes.push(inst.fms)
  bytes.push(inst.fb)
  bytes.push(inst.al)
  bytes.push(inst.ams)

  for (const op of inst.operators) {
    bytes.push(op.mul)
    bytes.push(op.tl)
    bytes.push(op.ar)
    bytes.push(op.d1)
    bytes.push(op.sl)
    bytes.push(op.rr)
    bytes.push(op.am)
    bytes.push(op.rs)
    bytes.push(op.det)
    bytes.push(op.d2)

    // reserved byte
    bytes.push(0)
  }

  return bytes
}

const dropdown_options = [
  { label: 'Load JSON', value: 'load_json' },
  { label: 'Download JSON', value: 'download_json' },
  { label: 'Load Instruments', value: 'load_instruments' },
  { label: 'Export Instruments', value: 'export_instruments' },
] as const

const InstrumentEditor = () => {
  const snap = useSnapshot(state)
  const { sid, cid } = snap.selection[0]
  const ch = snap.scenes[sid].channels[cid]
  const origin = snap.library[ch.origin]

  const dirty = isChannelDirty(ch, snap.library)

  const capabilities = {
    save: !origin.system && dirty,
    rename: !origin.system,
    create: true,
    duplicate: true,
    restore: dirty,
  }

  const duplicateAction = () => {
    const ch = state.scenes[sid].channels[cid]

    const name = prompt('Instrument name:', snap.library[ch.origin].name)
    if (!name) {
      return
    }

    const nextIndex = state.library.length
    addToLibrary(ch, name)
    ch.origin = nextIndex
  }

  const createAction = () => {
    const name = prompt('Instrument name:', snap.library[0].name)
    if (!name) {
      return
    }

    const nextIndex = state.library.length
    addToLibrary(state.library[0].instrument, name)
    state.scenes[sid].channels[cid].origin = nextIndex
  }

  const saveAction = () => {
    const copy = deepClone(state.scenes[sid].channels[cid])
    state.library[ch.origin].instrument = copy
    state.library[ch.origin].hash = hashInstrument(copy)
  }

  const restoreAction = () => {
    const index = ch.origin
    state.scenes[sid].channels[cid] = {
      ...deepClone(state.library[index].instrument),
      origin: index,
    }
  }

  const renameAction = () => {
    const name = prompt('Instrument name:', snap.library[ch.origin].name)
    if (!name) {
      return
    }
    state.library[ch.origin].name = name
  }

  if (snap.selection.length !== 1) return <span>Multi Edit</span>

  return (
    <>
      <div className="toolbar">
        <button
          disabled={!capabilities.rename}
          title="Library"
          style={{ display: 'none' }}
        >
          ☰
        </button>
      </div>
      <span className="instrument-name">{snap.library[ch.origin].name}</span>
      <div className="toolbar">
        <button
          disabled={!capabilities.rename}
          title="Rename"
          onClick={renameAction}
        >
          ✎
        </button>
        <button disabled={!capabilities.save} title="Save" onClick={saveAction}>
          ✔
        </button>
        <button
          disabled={!capabilities.duplicate}
          title="Duplicate"
          onClick={duplicateAction}
        >
          ⧉
        </button>
        <button
          disabled={!capabilities.restore}
          title="Restore"
          onClick={restoreAction}
        >
          ↺
        </button>
        <button
          disabled={!capabilities.create}
          title="New"
          onClick={createAction}
        >
          ✚
        </button>
      </div>
    </>
  )
}

const InstrumentsBrowser = () => {
  const snap = useSnapshot(state)

  const handleLibraryChange: React.ChangeEventHandler<HTMLSelectElement> = (
    ev,
  ) => {
    ev.preventDefault()
    const val = parseInt(ev.target.value, 10)
    cloneFromLibrary(val)
  }

  const handleSiblingChange: React.ChangeEventHandler<HTMLSelectElement> = (
    ev,
  ) => {
    ev.preventDefault()
    const [sid, cid] = ev.target.value.split(':').map(Number)
    cloneFromSibling(sid, cid)
  }

  return (
    <div className="previewer">
      <nav className="patch">
        <InstrumentEditor />
        <select onChange={handleLibraryChange} value={-1}>
          <option value={-1} disabled>
            From Library
          </option>
          {snap.library.map((inst, i) => (
            <option key={i} value={i}>
              {inst.name}
            </option>
          ))}
        </select>
        <select onChange={handleSiblingChange} value={-1}>
          <option value={-1} disabled>
            From Patch
          </option>
          {snap.scenes.map((p, sid) =>
            p.channels.map((ch, cid) => (
              <option key={`${sid}:${cid}`} value={`${sid}:${cid}`}>
                {'ABCD'[sid]}
                {cid + 1} - {channelName(ch, snap.library)}
              </option>
            )),
          )}
        </select>
        <MenuDropdown
          title="More..."
          text="⋯"
          options={dropdown_options}
          onSelect={(opt) => {
            switch (opt) {
              case 'load_json':
                loadJSON()
                break
              case 'download_json':
                downloadJSON()
                break
              case 'load_instruments':
                loadInstruments()
                break
              case 'export_instruments':
                exportInstruments()
                break
            }
          }}
        />
      </nav>
      <br />
    </div>
  )
}

const loadInstruments = () => {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.dmp,.vgi,.fui'
  fileInput.multiple = true

  fileInput.addEventListener('change', async (event) => {
    const { files } = event.target as HTMLInputElement
    if (!files) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      const reader = new FileReader()

      reader.onload = (e) => {
        if (!e.target) return

        const data = new Uint8Array(e.target.result as ArrayBuffer)

        const ext = file.name.split('.').pop()?.toLowerCase()
        const name = file.name.replace(/\.(dmp|vgi|fui)$/i, '')

        let instrument: Instrument | null = null

        if (ext === 'dmp') {
          instrument = readDmp(data)
        } else if (ext === 'vgi') {
          instrument = readVGI(data)
        } else if (ext === 'fui') {
          instrument = readFui(data)
        }

        if (!instrument) return

        addToLibrary(instrument, name)
      }

      reader.readAsArrayBuffer(file)
    }
  })

  fileInput.click()
}

const sameChannelRef = (a: ChannelRef, b: ChannelRef) => {
  return a.sid === b.sid && a.cid === b.cid
}

const Patch = () => {
  const snap = useSnapshot(state)

  const handleCellClick = (sid: SceneId, cid: ChannelId) => {
    return (ev) => {
      const multi = ev.ctrlKey || ev.metaKey
      const sel = state.selection

      const ref = { sid, cid }

      if (!multi) {
        state.selection = [ref]
        return
      }

      const exists = sel.some((s) => sameChannelRef(s, ref))

      if (exists) {
        if (sel.length === 1) return
        state.selection = sel.filter((s) => !sameChannelRef(s, ref))
      } else {
        state.selection = [...sel, ref]
      }
    }
  }

  return (
    <div className="instruments">
      <InstrumentsBrowser />
      <table className="instruments-matrix">
        <thead>
          <tr>
            <th></th>
            {snap.scenes[0].channels.map((_ch, cid) => (
              <th key={cid}>
                <span>{cid + 1}</span>
                <Stereo cid={cid as ChannelId} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.scenes.map((p, sid) => (
            <tr key={sid}>
              <td>{'ABCD'[sid]}</td>
              {p.channels.map((ch, cid) => {
                const active = snap.selection.some(
                  (s) => s.sid === sid && s.cid === cid,
                )

                return (
                  <td
                    key={cid}
                    className={active ? 'active' : ''}
                    onClick={handleCellClick(sid as SceneId, cid as SceneId)}
                  >
                    {channelName(ch, snap.library)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default Patch
