import React, { ChangeEventHandler, useCallback } from 'react'
import { useSnapshot } from 'valtio'
import {
  cloneFromLibrary,
  cloneFromSibling,
  instrumentName,
  state,
} from './context'
import { MenuDropdown } from './menu-dropdown'
import { Stereo } from './stereo'
import { readDmp } from './utils/readDmp'

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
  a.download = `${state.name}.json`

  // Trigger the download
  a.click()

  // Clean up by revoking the URL
  URL.revokeObjectURL(url)
}

const dropdown_options = [
  { label: 'Load JSON', value: 'load_json' },
  { label: 'Download JSON', value: 'download_json' },
  { label: 'Add DMP', value: 'add_dmp' },
]

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
      case 'add_dmp':
        addDmpInstruments()
        break
    }
  }, [])

  const handleNameChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      if (e.target.value.length >= 30) return

      const name = e.target.value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace consecutive hyphens with a single hyphen
        .replace(/^-+/g, '') // Remove leading hyphens

      state.name = name
    },
    [],
  )

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
        <input
          placeholder="Patch Name"
          type="text"
          value={snap.name}
          size={30}
          onChange={handleNameChange}
          onFocus={(e) => e.target.select()}
        />
        <select onChange={handleLibraryChange} value={-1}>
          <option value={-1} disabled>
            From Library
          </option>
          {snap.library.map((inst, i) => (
            <option key={inst.name} value={i}>
              {inst.name}
            </option>
          ))}
        </select>
        <select onChange={handleSiblingChange} value={-1}>
          <option value={-1} disabled>
            From other channel
          </option>
          {snap.patches.map((p, pid) =>
            p.channels.map((c, cid) => (
              <option key={`${pid}:${cid}`} value={`${pid}:${cid}`}>
                {'ABCD'[pid]}
                {cid + 1} - {instrumentName(pid, cid)}
              </option>
            )),
          )}
        </select>
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
            {snap.patches.map((_p, pid) => (
              <th key={pid}>{'ABCD'[pid]}</th>
            ))}
            <th>OUTs</th>
          </tr>
        </thead>
        <tbody>
          {snap.patches[0].channels.map((_ch, cid) => (
            <tr key={cid}>
              <td>{cid + 1}</td>
              {snap.patches.map((_p, pid) => {
                const active = snap.selection.some(
                  (s) => s.pid === pid && s.cid === cid,
                )

                return (
                  <td
                    key={pid}
                    className={active ? 'active' : ''}
                    onClick={handleCellClick(pid as PatchId, cid as PatchId)}
                  >
                    {instrumentName(pid, cid)}
                  </td>
                )
              })}
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

export default Patch
