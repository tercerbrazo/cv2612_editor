import * as zip from '@zip.js/zip.js'
import { BlobWriter, Uint8ArrayReader } from '@zip.js/zip.js'
import React, { useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { deepClone } from 'valtio/utils'
import {
  addToLibrary,
  assignFromChannel,
  assignFromLibrary,
  channelName,
  createPatch,
  isChannelDirty,
  state,
} from './context'
import { Stereo } from './stereo'
import { hashInstrument } from './utils/hashing'
import { readDmp } from './utils/readDmp'
import { readFui } from './utils/readFui'
import { readVGI } from './utils/readVgi'
import { previewInstrument } from './utils/vgm'

const applyNewState = async () => {}

const restoreBackup = () => {
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
          console.log(newState)
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

const downloadBackup = () => {
  // Convert the object to a JSON string
  var jsonData = JSON.stringify(state)

  // Create a Blob from the JSON data
  var blob = new Blob([jsonData], { type: 'application/json' })

  // Create a URL for the Blob
  var url = URL.createObjectURL(blob)

  // Create a download link
  var a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  a.download = `backup-${date}.json`

  // Trigger the download
  a.click()

  // Clean up by revoking the URL
  URL.revokeObjectURL(url)
}

const exportInstruments = async () => {
  // create zip
  const zipWriter = new zip.ZipWriter(new BlobWriter('application/zip'))

  const indices = Object.values(state.library).map((i) => i.id)

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

const LibraryBrowser = () => {
  const snap = useSnapshot(state)

  const cols = 4
  const items = Object.values(snap.library)
  const perCol = Math.ceil(items.length / cols)
  const columns = Array.from({ length: cols }, (_, i) =>
    items.slice(i * perCol, (i + 1) * perCol),
  )

  return (
    <div className="four-cols instruments-list">
      {columns.map((col, i) => (
        <div className="col" key={i}>
          {col.map((inst) => (
            <nav className="instrument-entry" key={inst.id}>
              <a
                href="#"
                onClick={(ev) => {
                  ev.preventDefault()
                  assignFromLibrary(inst.id)
                  state.browserOn = false
                }}
              >
                {inst.name}
              </a>
              <div className="toolbar">
                {!inst.system && (
                  <button
                    title="Rename"
                    onClick={() => {
                      const name = prompt(
                        'Instrument name:',
                        snap.library[inst.id].name,
                      )
                      if (!name) {
                        return
                      }
                      state.library[inst.id].name = name
                    }}
                  >
                    ✎
                  </button>
                )}
                <button
                  title="Preview"
                  onClick={() => {
                    previewInstrument(inst.instrument, String(inst.hash))
                  }}
                >
                  ▶
                </button>
              </div>
            </nav>
          ))}
        </div>
      ))}
    </div>
  )
}

const PatchBrowser = () => {
  const snap = useSnapshot(state)

  return (
    <table className="instruments-matrix">
      <thead>
        <tr>
          <th></th>
          {snap.patches[snap.pid].scenes[0].channels.map((_ch, cid) => (
            <th key={cid}>
              <span>{cid + 1}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snap.patches[snap.pid].scenes.map((p, sid) => (
          <tr key={sid}>
            <td>{'ABCD'[sid]}</td>
            {p.channels.map((ch, cid) => {
              return (
                <td
                  key={cid}
                  className={`cell`}
                  onClick={() => {
                    assignFromChannel(sid, cid)
                    state.browserOn = false
                  }}
                >
                  {channelName(ch, snap.library)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const categories = [
  'ALL',
  'ARP',
  'BASS',
  'BELL',
  'BRASS',
  'DRONE',
  'DRUM',
  'KEYS',
  'LEAD',
  'METAL',
  'NOISE',
  'ORG',
  'PAD',
  'PLUCK',
  'SFX',
  'STR',
  'USER',
]

const Browser = () => {
  const snap = useSnapshot(state)

  const closeAction = () => {
    state.browserOn = false
  }

  if (!snap.browserOn) return null

  return (
    <div className="modal">
      <div className="modal-content">
        <div id="browser">
          <nav>
            {snap.browserType === 'library' ? (
              <>
                <span>Category:</span>
                <select
                  onChange={(ev) => {
                    state.browserCategory = ev.target.value
                  }}
                  value={snap.browserCategory}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  title="Patch Browser"
                  onClick={() => {
                    state.browserType = 'patch'
                  }}
                >
                  Copy from Patch
                </button>
              </>
            ) : (
              <>
                <span>Copy from Patch</span>
                <button
                  title="Library Browser"
                  onClick={() => {
                    state.browserType = 'library'
                  }}
                >
                  Pick from Library
                </button>
              </>
            )}

            <div className="toolbar">
              <button title="Save Backup" onClick={downloadBackup}>
                💾
              </button>
              <button title="Load Backup" onClick={restoreBackup}>
                📂
              </button>
              <button title="Import Instruments" onClick={importInstruments}>
                📥
              </button>
              <button title="Export Instruments" onClick={exportInstruments}>
                📦
              </button>
              <button title="Close" onClick={closeAction}>
                x
              </button>
            </div>
          </nav>
          <br />
          {snap.browserType === 'library' ? (
            <LibraryBrowser />
          ) : (
            <PatchBrowser />
          )}
        </div>
      </div>
    </div>
  )
}

const NavBar = () => {
  const snap = useSnapshot(state)
  const { sid, cid } = snap.selection[0]
  const ch = snap.patches[snap.pid].scenes[sid].channels[cid]
  const origin = snap.library[ch.origin]

  const dirty = isChannelDirty(ch, snap.library)
  const multiEdit = snap.selection.length !== 1

  const capabilities = {
    save: !multiEdit && !origin.system && dirty,
    create: true,
    duplicate: !multiEdit,
    restore: !multiEdit && dirty,
  }

  const duplicateAction = () => {
    const ch = state.patches[state.pid].scenes[sid].channels[cid]

    const name = prompt('Instrument name:', snap.library[ch.origin].name)
    if (!name) {
      return
    }

    const id = addToLibrary(name, ch)
    ch.origin = id
  }

  const createAction = () => {
    const name = prompt('Instrument name:')
    if (!name) {
      return
    }

    const id = addToLibrary(name)
    if (!multiEdit) {
      state.patches[state.pid].scenes[sid].channels[cid].origin = id
    }
  }

  const saveAction = () => {
    const copy = deepClone(state.patches[state.pid].scenes[sid].channels[cid])
    state.library[ch.origin].instrument = copy
    state.library[ch.origin].hash = hashInstrument(copy)
  }

  const restoreAction = () => {
    const index = ch.origin
    state.patches[state.pid].scenes[sid].channels[cid] = {
      ...deepClone(state.library[index].instrument),
      origin: index,
    }
  }

  const browseAction = () => {
    state.browserOn = true
  }

  const handlePatchChange: React.ChangeEventHandler<HTMLSelectElement> = (
    ev,
  ) => {
    ev.preventDefault()
    state.pid = ev.target.value
  }

  const createPatchAction = () => {
    const name = prompt('Patch name:')
    if (!name) {
      return
    }

    const patch = createPatch(name)

    state.patches[patch.id] = deepClone(patch)
    state.pid = patch.id
  }

  const renamePatchAction = () => {
    const name = prompt('Patch name:', snap.patches[state.pid].name)
    if (!name) {
      return
    }
    state.patches[state.pid].name = name
  }

  return (
    <nav>
      <span>Patch:</span>
      <select onChange={handlePatchChange} value={snap.pid}>
        {Object.values(snap.patches).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="toolbar">
        <button title="Rename Patch" onClick={renamePatchAction}>
          ✎
        </button>
        <button title="Create New Patch" onClick={createPatchAction}>
          ✚
        </button>

        <span> | </span>
        <button
          disabled={!capabilities.save}
          title="Save Instrument"
          onClick={saveAction}
        >
          ✔
        </button>
        <button
          disabled={!capabilities.duplicate}
          title="Save as New Instrument"
          onClick={duplicateAction}
        >
          ⧉
        </button>
        <button
          disabled={!capabilities.restore}
          title="Restore from Instrument"
          onClick={restoreAction}
        >
          ↺
        </button>
        <button
          disabled={!capabilities.create}
          title="Create New Instrument"
          onClick={createAction}
        >
          ✚
        </button>
        <button title="Browse Instruments" onClick={browseAction}>
          ≡
        </button>
      </div>
    </nav>
  )
}

const importInstruments = () => {
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

        addToLibrary(name, instrument)
      }

      reader.readAsArrayBuffer(file)
    }
  })

  fileInput.click()
}

function getRange(a: ChannelRef, b: ChannelRef) {
  const res: ChannelRef[] = []

  const r1 = Math.min(a.sid, b.sid)
  const r2 = Math.max(a.sid, b.sid)
  const c1 = Math.min(a.cid, b.cid)
  const c2 = Math.max(a.cid, b.cid)

  for (let sid = r1; sid <= r2; sid++) {
    for (let cid = c1; cid <= c2; cid++) {
      res.push({ sid, cid } as ChannelRef)
    }
  }

  return res
}

const Patch = () => {
  const snap = useSnapshot(state)

  const [anchor, setAnchor] = useState<ChannelRef | null>(null)
  const didMoveRef = useRef(false)

  useEffect(() => {
    const handleUp = () => setAnchor(null)
    window.addEventListener('mouseup', handleUp)
    return () => window.removeEventListener('mouseup', handleUp)
  }, [])

  return (
    <div className="instruments">
      <Browser />
      <NavBar />
      <table className="instruments-matrix">
        <thead>
          <tr>
            <th></th>
            {snap.patches[snap.pid].scenes[0].channels.map((_ch, cid) => (
              <th key={cid}>
                <span>{cid + 1}</span>
                <Stereo cid={cid as ChannelId} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.patches[snap.pid].scenes.map((p, sid) => (
            <tr key={sid}>
              <td>{'ABCD'[sid]}</td>
              {p.channels.map((ch, cid) => {
                const active = snap.selection.some(
                  (s) => s.sid === sid && s.cid === cid,
                )

                return (
                  <td
                    key={cid}
                    className={`cell ${active ? 'active' : ''}`}
                    onMouseEnter={(ev) => {
                      if (!anchor) return
                      const isExtend = ev.ctrlKey || ev.metaKey

                      didMoveRef.current = true

                      const range = getRange(anchor, {
                        sid,
                        cid,
                      } as ChannelRef)

                      const next: Map<string, ChannelRef> = isExtend
                        ? new Map(
                            snap.selection.map((s) => [`${s.sid}:${s.cid}`, s]),
                          )
                        : new Map()

                      for (const s of range) {
                        next.set(`${s.sid}:${s.cid}`, s)
                      }

                      state.selection = Array.from(next.values())
                    }}
                    onMouseDown={(_ev) => {
                      setAnchor({ sid, cid } as ChannelRef)
                      didMoveRef.current = false
                    }}
                    onMouseUp={(ev) => {
                      if (!anchor) return
                      const isExtend = ev.ctrlKey || ev.metaKey

                      const isClick = !didMoveRef.current

                      if (isClick) {
                        if (active) {
                          state.browserOn = true
                        } else {
                          // select single cell on click

                          const next: Map<string, ChannelRef> = isExtend
                            ? new Map(
                                snap.selection.map((s) => [
                                  `${s.sid}:${s.cid}`,
                                  s,
                                ]),
                              )
                            : new Map()

                          next.set(`${sid}:${cid}`, { sid, cid } as ChannelRef)

                          state.selection = Array.from(next.values())
                        }
                      }

                      setAnchor(null)
                    }}
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
