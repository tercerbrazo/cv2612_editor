import React, { useContext, useEffect, useState } from 'react'
import { reactLocalStorage } from 'reactjs-localstorage'
import { BindingKey, CV2612Context } from './context'
import MidiIO from './midi-io'

const activityDuration = 80

const Midi = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const [midiOutId, setMidiOutId] = useState('-')
  const [midiOuts, setMidiOuts] = useState<WebMidi.MIDIOutput[]>([])
  const [midiOutActivity, setMidiOutActivity] = useState(false)

  useEffect(() => {
    if (midiOutId !== '-') {
      reactLocalStorage.set('midiOutId', midiOutId)
      MidiIO.setMidiOutId(midiOutId)
    }
  }, [midiOutId])

  useEffect(() => {
    const unsubMidiStateChanged = MidiIO.sub(
      'midiStateChanged',
      ({ outputs }) => {
        if (JSON.stringify(midiOuts) !== JSON.stringify(outputs)) {
          const mOut = reactLocalStorage.get('midiOutId', '')
          // is last id still available??
          setMidiOutId(outputs.map((a) => a.id).includes(mOut) ? mOut : '')
          setMidiOuts(outputs)
        }
      },
    )
    const unsubMidiOutProgress = MidiIO.sub('midiOutProgress', ({ done }) => {
      setMidiOutActivity(true)
      if (done) setTimeout(() => setMidiOutActivity(false), activityDuration)
    })

    return () => {
      unsubMidiStateChanged()
      unsubMidiOutProgress()
    }
  }, [])

  return (
    <nav className="midi">
      <span>
        MIDI Out
        <i className={midiOutActivity ? 'active' : ''} />
      </span>
      {/* eslint-disable-next-line jsx-a11y/no-onchange */}
      <select
        className="out"
        value={midiOutId}
        onChange={(ev) => setMidiOutId(ev.target.value)}
      >
        <option key="" value="">
          Not Connected
        </option>
        {midiOuts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <span> </span>
      <span> </span>
      {(['x', 'y', 'z'] as BindingKey[]).map((i) => (
        <a
          href="/"
          title={`Bind parameters to ${i.toUpperCase()}`}
          className={`${i} ${state.bindingKey === i ? 'active' : ''}`}
          onClick={(ev) => {
            ev.preventDefault()
            dispatch({ type: 'toggle-binding', bindingKey: i })
          }}
          key={i}
        >
          {i.toUpperCase()}
        </a>
      ))}
      <span> </span>
      <span> </span>
      <a
        href="/"
        title="Upload a Patch"
        onClick={(ev) => {
          ev.preventDefault()
          dispatch({ type: 'upload-patch' })
        }}
      >
        UPLOAD
      </a>
      <a
        href="/"
        title="Download Patch"
        onClick={(ev) => {
          ev.preventDefault()
          dispatch({ type: 'download-patch' })
        }}
      >
        DOWNLOAD
      </a>
      <a
        href="/"
        title="Sync Midi"
        onClick={(ev) => {
          ev.preventDefault()
          dispatch({ type: 'sync-midi' })
        }}
      >
        SYNC
      </a>
      <a
        href="/"
        title="Save state to EEPROM"
        onClick={(ev) => {
          ev.preventDefault()
          dispatch({ type: 'save-state' })
        }}
      >
        SAVE STATE
      </a>
    </nav>
  )
}

export default Midi
