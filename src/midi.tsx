import React, { useCallback, useContext, useEffect, useState } from 'react'
import { reactLocalStorage } from 'reactjs-localstorage'
import { CV2612Context } from './context'
import MidiIO, { SpeedPreset } from './midi-io'
import { MenuDropdown } from './menu-dropdown'

const activityDuration = 80

const options = [
  { label: 'Unbind All', value: 0 },
  { label: 'Bind All to X', value: 1 },
  { label: 'Bind All to Y', value: 2 },
  { label: 'Bind All to Z', value: 3 },
]

const speedPresetOptions: { value: SpeedPreset; label: string }[] = [
  { value: 'fast', label: '🐇 Fast' },
  { value: 'normal', label: '🐕 Normal' },
  { value: 'slow', label: '🐢 Slow' },
  { value: 'shitty', label: '💩 Shitty' },
]

const Midi = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const [speed, setSpeed] = useState('normal')
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
    const speed = reactLocalStorage.get('speedPreset', 'normal')
    MidiIO.setSpeedPreset(speed)
    setSpeed(speed)
  }, [])

  const handleSpeedChange = useCallback((speed: SpeedPreset) => {
    setSpeed(speed)
    MidiIO.setSpeedPreset(speed)
    reactLocalStorage.set('speedPreset', speed)
  }, [])

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

  if (state.calibrationStep > 0) return null

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
      <select
        className="speed"
        value={speed}
        onChange={(ev) => handleSpeedChange(ev.target.value as SpeedPreset)}
      >
        {speedPresetOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span> </span>
      <span> </span>
      {(['x', 'y', 'z'] as const).map((i) => (
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
      <MenuDropdown
        title="Bind all to..."
        text="⋯"
        options={options}
        onSelect={(option) => {
          switch (option.value) {
            case 0:
              dispatch({ type: 'bind-all' })
              break
            case 1:
              dispatch({ type: 'bind-all', modulator: 'x' })
              break
            case 2:
              dispatch({ type: 'bind-all', modulator: 'y' })
              break
            case 3:
              dispatch({ type: 'bind-all', modulator: 'z' })
              break
          }
        }}
      />
      <span> </span>
      <span> </span>
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
        title="Verify State Checksum"
        onClick={(ev) => {
          ev.preventDefault()
          dispatch({ type: 'verify-checksum' })
        }}
      >
        VERIFY
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
