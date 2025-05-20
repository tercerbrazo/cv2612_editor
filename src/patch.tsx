import React, {
  ChangeEventHandler,
  MouseEventHandler,
  useCallback,
} from 'react'
import { useSnapshot } from 'valtio'
import { state } from './context'
import { MenuDropdown } from './menu-dropdown'

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

const Patch = () => {
  const snap = useSnapshot(state)

  const handlePresetsClick: MouseEventHandler<HTMLAnchorElement> = (ev) => {
    ev.preventDefault()
    state.instrumentsLoader = true
  }

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

  return (
    <nav className="patch">
      <span>Patch: </span>
      <input
        placeholder="Patch Name"
        type="text"
        value={snap.name}
        size={30}
        onChange={handleNameChange}
        onFocus={(e) => e.target.select()}
      />
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <a href="/" title="Open Presets Matrix" onClick={handlePresetsClick}>
        PRESETS
      </a>
      <MenuDropdown
        title="More..."
        text="⋯"
        options={[
          { label: 'Calibrate', value: 1 },
          { label: 'Load JSON', value: 2 },
          { label: 'Download JSON', value: 3 },
        ]}
        onSelect={(option) => {
          switch (option.value) {
            case 1:
              state.calibrationStep = 1
              break
            case 2:
              loadJSON()
              break
            case 3:
              downloadJSON()
              break
          }
        }}
      />
    </nav>
  )
}

export default Patch
