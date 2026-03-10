import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import {
  addToLibrary,
  cloneFromLibrary,
  cloneFromSibling,
  instrumentName,
  isChannelDirty,
  state,
} from './context'
import { MenuDropdown } from './menu-dropdown'
import { Stereo } from './stereo'
import { readDmp } from './utils/readDmp'
import { deepClone } from 'valtio/utils'
import { hashChannel } from './utils/hashing'
import { readVGI } from './utils/readVgi'

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

const dropdown_options = [
  { label: 'Load JSON', value: 'load_json' },
  { label: 'Download JSON', value: 'download_json' },
  { label: 'Add Instruments', value: 'add_instruments' },
]

const InstrumentEditor = () => {
  const snap = useSnapshot(state)
  const { pid, cid } = snap.selection[0]
  const ch = snap.patches[pid].channels[cid]
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(ch.name)
  const nameRef = useRef<HTMLInputElement>(null)

  const dirty = isChannelDirty(ch, snap.library)

  const capabilities = {
    save: !ch.system && dirty,
    rename: !ch.system,
    add: true,
    clone: true,
    restore: dirty,
  }

  useEffect(() => {
    setName(ch.name)
  }, [ch.name])

  const commitRename = () => {
    setRenaming(false)
    state.patches[pid].channels[cid].name = name
    state.library[ch.origin].name = name
    nameRef.current?.blur()
  }

  const cancelRename = () => {
    if (renaming) {
      setRenaming(false)
      setName(ch.name)
      nameRef.current?.blur()
    }
  }

  const cloneAction = () => {
    addToLibrary(state.patches[pid].channels[cid], true)
    renameAction()
  }

  const addAction = () => {
    addToLibrary(state.library[0], true)
    renameAction()
  }

  const saveAction = () => {
    const copy = deepClone(state.patches[pid].channels[cid])
    copy.origin = 0
    copy.hash = hashChannel(copy)
    state.library[ch.origin] = copy
  }

  const restoreAction = () => {
    const index = ch.origin
    state.patches[pid].channels[cid] = deepClone(state.library[index])
    state.patches[pid].channels[cid].origin = index
  }

  const renameAction = () => {
    setRenaming(true)
    nameRef.current?.focus()
    nameRef.current?.select()
  }

  if (snap.selection.length !== 1) return <span>Multi Edit</span>

  return (
    <>
      <input
        type="text"
        ref={nameRef}
        value={name}
        readOnly={!renaming}
        size={20}
        onChange={(e) => setName(e.target.value)}
        onBlur={cancelRename}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') cancelRename()
        }}
      />
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
          disabled={!capabilities.clone}
          title="Clone"
          onClick={cloneAction}
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
        <button disabled={!capabilities.add} title="Add" onClick={addAction}>
          ✚
        </button>
      </div>
    </>
  )
}

const InstrumentsBrowser = () => {
  const snap = useSnapshot(state)

  const handleDropdownMenu = useCallback(({ value }) => {
    switch (value) {
      case 'load_json':
        loadJSON()
        break
      case 'download_json':
        downloadJSON()
        break
      case 'add_instruments':
        addInstruments()
        break
    }
  }, [])

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
    const [pid, cid] = ev.target.value.split(':').map(Number)
    cloneFromSibling(pid, cid)
  }

  return (
    <div className="previewer">
      <nav className="patch">
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
          {snap.patches.map((p, pid) =>
            p.channels.map((ch, cid) => (
              <option key={`${pid}:${cid}`} value={`${pid}:${cid}`}>
                {'ABCD'[pid]}
                {cid + 1} - {instrumentName(ch, snap.library)}
              </option>
            )),
          )}
        </select>
        <InstrumentEditor />
        <MenuDropdown
          title="More..."
          text="⋯"
          options={dropdown_options}
          onSelect={handleDropdownMenu}
        />
      </nav>
      <br />
    </div>
  )
}

const addInstruments = () => {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = '.dmp,.vgi'
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
        const name = file.name.replace(/\.(dmp|vgi)$/i, '')

        let instrument: InstrumentParams | null = null

        if (ext === 'dmp') {
          instrument = readDmp(data)
        } else if (ext === 'vgi') {
          instrument = readVGI(data)
        }

        console.log(ext, instrument, data)

        if (!instrument) return

        const ch = {
          ...instrument,
          name,
          system: false,
          origin: 0,
        } as Channel

        ch.hash = hashChannel(ch)

        addToLibrary(ch)
      }

      reader.readAsArrayBuffer(file)
    }
  })

  fileInput.click()
}

const sameChannelRef = (a: ChannelRef, b: ChannelRef) => {
  return a.pid === b.pid && a.cid === b.cid
}

const Patch = () => {
  const snap = useSnapshot(state)

  const handleCellClick = (pid: PatchId, cid: ChannelId) => {
    return (ev) => {
      const multi = ev.ctrlKey || ev.metaKey
      const sel = state.selection

      const ref = { pid, cid }

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
            {snap.patches[0].channels.map((_ch, cid) => (
              <th key={cid}>
                <span>{cid + 1}</span>
                <Stereo cid={cid as ChannelId} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snap.patches.map((p, pid) => (
            <tr key={pid}>
              <td>{'ABCD'[pid]}</td>
              {p.channels.map((ch, cid) => {
                const active = snap.selection.some(
                  (s) => s.pid === pid && s.cid === cid,
                )

                return (
                  <td
                    key={cid}
                    className={active ? 'active' : ''}
                    onClick={handleCellClick(pid as PatchId, cid as PatchId)}
                  >
                    {instrumentName(ch, snap.library)}
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
