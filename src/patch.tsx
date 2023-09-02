import React, { ChangeEventHandler, useCallback, useContext } from 'react'
import { CV2612Context } from './context'

const Patch = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const loadPatch = useCallback(() => {
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
            dispatch({ type: 'update-state', newState })
          } catch (error) {
            console.error('Error parsing JSON:', error)
          }
        }

        reader.readAsText(file)
      }
    })

    fileInput.click()
    // return state unchanged, as the reducer is always sync
    // the updated state will be dispatched on file load
    return state
  }, [])

  const downloadPatch = useCallback(() => {
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
    return state
  }, [state.name])

  const handleNameChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (e) => {
      if (e.target.value.length >= 30) return

      const name = e.target.value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace consecutive hyphens with a single hyphen
        .replace(/^-+/g, '') // Remove leading hyphens

      dispatch({ type: 'change-name', name })
    },
    [],
  )

  return (
    <nav className="patch">
      <span>Patch: </span>
      <input
        placeholder="Patch Name"
        type="text"
        value={state.name}
        size={30}
        onChange={handleNameChange}
      />
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <span> </span>
      <a
        href="/"
        title="Load a Patch"
        onClick={(ev) => {
          ev.preventDefault()
          loadPatch()
        }}
      >
        LOAD
      </a>
      <a
        href="/"
        title="Download Patch"
        onClick={(ev) => {
          ev.preventDefault()
          downloadPatch()
        }}
      >
        DOWNLOAD
      </a>
    </nav>
  )
}

export default Patch
