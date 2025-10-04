import React, { useCallback, useEffect, useState } from 'react'
import { reactLocalStorage } from 'reactjs-localstorage'
import { useSnapshot } from 'valtio'
import { bindAll, saveState, sendCrc32, state, syncMidi } from './context'
import { MenuDropdown, MenuDropdownOption } from './menu-dropdown'
import MidiIO, { SpeedPreset } from './midi-io'
import { getParamMidiCc } from './utils/paramsHelpers'

const activityDuration = 80

const options = [
  { label: 'Unbind All', value: 0 },
  { label: 'Bind All to X', value: 1 },
  { label: 'Bind All to Y', value: 2 },
  { label: 'Bind All to Z', value: 3 },
  { label: 'X: Absolute', value: 10 },
  { label: 'X: Linked Morph', value: 11 },
  { label: 'X: Direct Morph', value: 12 },
  { label: 'Y: Absolute', value: 13 },
  { label: 'Y: Linked Morph', value: 14 },
  { label: 'Y: Direct Morph', value: 15 },
  { label: 'Z: Absolute', value: 16 },
  { label: 'Z: Linked Morph', value: 17 },
  { label: 'Z: Direct Morph', value: 18 },
]

const modulation_mode_icons = ['🎯', '🔗', '⚡']
/*
ABSOLUTE → 🎯
LINKED_MORPH → 🔗
DIRECT_MORPH → ⚡
*/

const speedPresetOptions: { value: SpeedPreset; label: string }[] = [
  { value: 'turbo', label: '🚀 Turbo' },
  { value: 'fast', label: '🐇 Fast' },
  { value: 'normal', label: '🐕 Normal' },
  { value: 'slow', label: '🐢 Slow' },
  { value: 'shitty', label: '💩 Shitty' },
]

const setModulationMode = (param: SettingParam, value: number) => {
  const { ch, cc } = getParamMidiCc(param, 0, 0, 0)
  state.settings[param] = value
  MidiIO.sendCC(ch, cc, value)
}

const Midi = () => {
  const snap = useSnapshot(state)
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

  const handleOptionSelect = useCallback((option: MenuDropdownOption) => {
    switch (option.value) {
      case 0:
        bindAll()
        break
      case 1:
        bindAll(0)
        break
      case 2:
        bindAll(1)
        break
      case 3:
        bindAll(2)
        break
      case 10:
        setModulationMode('mmx', 0)
        break
      case 11:
        setModulationMode('mmx', 1)
        break
      case 12:
        setModulationMode('mmx', 2)
        break
      case 13:
        setModulationMode('mmy', 0)
        break
      case 14:
        setModulationMode('mmy', 1)
        break
      case 15:
        setModulationMode('mmy', 2)
        break
      case 16:
        setModulationMode('mmz', 0)
        break
      case 17:
        setModulationMode('mmz', 1)
        break
      case 18:
        setModulationMode('mmz', 2)
        break
    }
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
      {([0, 1, 2] as const).map((i) => (
        <a
          href="/"
          title={`Bind parameters to ${'XYZ'[i]}`}
          className={`${'xyz'[i]} ${snap.bindingId === i ? 'active' : ''}`}
          onClick={(ev) => {
            ev.preventDefault()
            state.bindingId = i === snap.bindingId ? undefined : i
          }}
          key={i}
        >
          {'XYZ'[i]}
          {modulation_mode_icons[snap.settings[`mm${'xyz'[i]}`]]}
        </a>
      ))}
      <MenuDropdown
        title="Bind all to..."
        text="⋯"
        options={options}
        onSelect={handleOptionSelect}
      />
      <span> </span>
      <span> </span>
      <a
        href="/"
        title="Sync Midi"
        onClick={(ev) => {
          ev.preventDefault()
          syncMidi()
        }}
      >
        SYNC
      </a>
      <a
        href="/"
        title="Verify State Checksum"
        onClick={(ev) => {
          ev.preventDefault()
          sendCrc32()
        }}
      >
        VERIFY
      </a>
      <a
        href="/"
        title="Save state to EEPROM"
        onClick={(ev) => {
          ev.preventDefault()
          saveState()
        }}
      >
        SAVE STATE
      </a>
    </nav>
  )
}

export default Midi
