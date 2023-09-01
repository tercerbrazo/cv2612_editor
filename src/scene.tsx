import {
  DragEndEvent,
  DndContext,
  MouseSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers'

import React, {
  MouseEventHandler,
  useCallback,
  useContext,
  useMemo,
} from 'react'
import Channel from './channel'
import {
  Param,
  PlayModeEnum,
  ChannelId,
  CV2612Context,
  PatchId,
  OperatorId,
  MidiChannelEnum,
} from './context'
import Dropdown from './dropdown'
import Slider from './slider'

function useCombinedRefs<T>(...refs: ((node: T) => void)[]): (node: T) => void {
  return useMemo(
    () => (node: T) => {
      refs.forEach((ref) => ref(node))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs,
  )
}

type DraggableProps = {
  index: number
  text: string
  active: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}

const Draggable = ({ index, text, active, onClick }: DraggableProps) => {
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: `draggable-${index}`,
    data: { index, action: 'copy' },
  })
  const {
    attributes,
    setNodeRef: setDraggableNodeRef,
    listeners,
    isDragging,
    transform,
  } = useDraggable({
    id: `draggable-${index}`,
    data: { index },
  })
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${30 + transform.y}px, 0)`,
      }
    : undefined

  const setNodeRef = useCombinedRefs(setDroppableNodeRef, setDraggableNodeRef)

  return (
    <button
      type="button"
      // eslint-disable-next-line no-nested-ternary
      className={` 
        ${active ? 'active' : ''} 
        ${isDragging ? 'dragging' : ''} 
        ${!isDragging && isOver ? 'over' : ''}
        `}
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...listeners}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...attributes}
    >
      {text}
    </button>
  )
}

const Droppable = ({ index }) => {
  const { over, isOver, setNodeRef } = useDroppable({
    id: `droppable-${index}`,
    data: { index, action: 'move' },
  })

  return (
    <div
      className={`droppable
        ${isOver ? 'over' : ''}
        ${over ? 'dragging' : ''}
        `}
      ref={setNodeRef}
    />
  )
}

const StepSeq = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const handleClick = useCallback(
    (voice: number, step: number) => {
      dispatch({ type: 'toggle-seq-step', voice, step })
    },
    [dispatch],
  )

  return (
    <div className="four-cols">
      <div className="col">
        <Dropdown id="stp" />
      </div>
      <div className="tcol">
        <div className="seq">
          {state.sequence.map((voiceSteps, i) => (
            <React.Fragment key={i}>
              <div className="seq-row">
                {i === 0 && <div className="seq-header" />}
                {voiceSteps.map((_step, j) => {
                  return (
                    i === 0 && (
                      <div key={j} className="seq-header">
                        {j + 1}
                      </div>
                    )
                  )
                })}
              </div>
              <div className="seq-row" key={i}>
                <div className="seq-header">{i + 1}</div>
                {voiceSteps.map((step, j) => {
                  return (
                    <div
                      className={`seq-cell ${step ? 'step-on' : ''}`}
                      key={j}
                      onClick={() => handleClick(i, j)}
                    />
                  )
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

type MidiMappingProps = {
  id: Param
  op: OperatorId
}
const MidiMapping = ({ id, op }: MidiMappingProps) => {
  const { getParamData } = useContext(CV2612Context)

  const { title, label, cc } = getParamData(id, 0)
  return (
    <div data-title={title} className="midi-mapping">
      <label>{label}</label>
      <span className="cell">CC {cc + op * 10}</span>
    </div>
  )
}

const MidiChannelDetails = () => {
  const { state } = useContext(CV2612Context)

  if (state.midiChannel === MidiChannelEnum.OMNI) {
    return (
      <>
        Notes will be played as MONO using all voices simultaneously.
        <br />
        Control Change messages will affect all voices.
      </>
    )
  }
  if (state.midiChannel === MidiChannelEnum.FORWARD) {
    return (
      <>
        Notes on channel <b>N</b> will affect voice <b>N</b>, for <b>N</b> in
        [1..6]
        <br />
        Control Change messages will affect all voices, no matter the channel.
      </>
    )
  }
  if (state.midiChannel === MidiChannelEnum.MULTITRACK) {
    return (
      <>
        Notes and CC on channel <b>N</b> will affect voice <b>N</b>, for{' '}
        <b>N</b> in [1..6]
      </>
    )
  }
  return (
    <>
      Same as <b>OMNI</b>, but only listening to channel {state.midiChannel + 1}
      <br />
      Notes will be played as MONO using all voices simultaneously.
      <br />
      Control Change messages will affect all voices.
    </>
  )
}

const Scene = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const mouseSensor = useSensor(MouseSensor, {
    // Require the mouse to move by 10 pixels before activating
    activationConstraint: {
      delay: 250,
      tolerance: 5,
    },
  })

  const sensors = useSensors(mouseSensor)

  const handlePatchClick =
    (index: PatchId): MouseEventHandler =>
    (ev) => {
      ev.preventDefault()
      dispatch({ type: 'change-patch', index })
    }

  const handleChannelClick =
    (index: ChannelId): MouseEventHandler =>
    (ev) => {
      ev.preventDefault()
      dispatch({ type: 'change-channel', index })
    }

  const handlePatchDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = event.active?.data?.current
      const drop = event.over?.data?.current

      if (drop?.action === 'move') {
        dispatch({ type: 'move-patch', index: drag.index, before: drop.index })
      } else if (drop?.action === 'copy') {
        dispatch({ type: 'copy-patch', source: drag.index, target: drop.index })
      }
    },
    [dispatch],
  )

  const handleChannelDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = event.active?.data?.current
      const drop = event.over?.data?.current

      if (drop?.action === 'move') {
        dispatch({
          type: 'move-channel',
          index: drag.index,
          before: drop.index,
        })
      } else if (drop?.action === 'copy') {
        dispatch({
          type: 'copy-channel',
          source: drag.index,
          target: drop.index,
        })
      }
    },
    [dispatch],
  )

  return (
    <>
      <br />
      <div className="four-cols">
        <div className="col">
          <Dropdown id="pz" />
          <Slider id="bl" />
        </div>
        <div className="col">
          <Dropdown id="pm" />
          <Slider id="lb" />
        </div>
        <div className="col">
          <Slider id="tr" />
          <Slider id="tu" />
        </div>
        <div className="col">
          <Dropdown id="atm" />
          {state.playMode === PlayModeEnum.POLY && <Dropdown id="rc" />}
        </div>
      </div>

      {state.playMode === PlayModeEnum.SEQ && <StepSeq />}

      {state.playMode === PlayModeEnum.POLY ? (
        <>
          <p>
            <b>POLY</b> is a special performance mode that is not compatible
            with patch edition, due to midi message handling in this mode.
            <br />
            This is a MIDI only mode ( GATE/CV are disabled) and behaviour is
            based on the Midi Receive Channel setting. For{' '}
            <b>{MidiChannelEnum[state.midiChannel]}</b>:
          </p>
          <blockquote>
            <MidiChannelDetails />
          </blockquote>
          <p>
            Patches and modulations are respected, but CCs sent within this mode
            will change the parameter in all four patches at once.
            <br />
            <br />
            MIDI mappings reference:
          </p>
          <div className="four-cols">
            <div className="col">
              <MidiMapping id="lfo" op={0} />
              <MidiMapping id="st" op={0} />
            </div>
            <div className="col">
              <MidiMapping id="ams" op={0} />
              <MidiMapping id="fms" op={0} />
            </div>
            <div className="col">
              <MidiMapping id="al" op={0} />
              <MidiMapping id="fb" op={0} />
            </div>
            <div className="col"></div>
          </div>
          <br />
          <div className="four-cols">
            {([0, 1, 2, 3] as OperatorId[]).map((op) => (
              <div className="col" key={op}>
                <MidiMapping id="ar" op={op} />
                <MidiMapping id="d1" op={op} />
                <MidiMapping id="sl" op={op} />
                <MidiMapping id="d2" op={op} />
                <MidiMapping id="rr" op={op} />
                <MidiMapping id="tl" op={op} />
                <MidiMapping id="mul" op={op} />
                <MidiMapping id="det" op={op} />
                <MidiMapping id="rs" op={op} />
                <MidiMapping id="am" op={op} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="two-cols">
            <div className="col">
              <DndContext
                onDragEnd={handlePatchDragEnd}
                modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
                collisionDetection={pointerWithin}
                sensors={sensors}
              >
                <nav>
                  {['A', 'B', 'C', 'D'].map((item, i) => (
                    <React.Fragment key={item}>
                      <Droppable index={i} />
                      <Draggable
                        index={i}
                        text={item}
                        active={state.patchIdx === i}
                        onClick={handlePatchClick(i as PatchId)}
                      />
                    </React.Fragment>
                  ))}
                  <Droppable index={4} />
                </nav>
              </DndContext>
            </div>
            <div className="col">
              <DndContext
                modifiers={[restrictToHorizontalAxis, restrictToParentElement]}
                collisionDetection={pointerWithin}
                sensors={sensors}
                onDragEnd={handleChannelDragEnd}
              >
                <nav>
                  {['1', '2', '3', '4', '5', '6'].map((item, i) => (
                    <React.Fragment key={item}>
                      <Droppable index={i} />
                      <Draggable
                        index={i}
                        text={item}
                        active={state.channelIdx === i}
                        onClick={handleChannelClick(i as ChannelId)}
                      />
                    </React.Fragment>
                  ))}
                  <Droppable index={6} />
                </nav>
              </DndContext>
            </div>
          </div>
          <br />

          <Channel />
        </>
      )}
    </>
  )
}

export default Scene
