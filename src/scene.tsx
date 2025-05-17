import {
  DndContext,
  DragEndEvent,
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
import { PlayModeEnum } from './enums'

import React, { FC, MouseEventHandler, useCallback, useMemo } from 'react'
import { useSnapshot } from 'valtio'
import Channel from './channel'
import { dispatch, state } from './context'
import Dropdown from './dropdown'
import Poly from './poly'
import Sequencer from './sequencer'
import Slider from './slider'

function useCombinedRefs<T>(...refs: ((node: T) => void)[]): (node: T) => void {
  return useMemo(
    () => (node: T) => {
      refs.forEach((ref) => ref(node))
    },
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
      className={` 
        ${active ? 'active' : ''} 
        ${isDragging ? 'dragging' : ''} 
        ${!isDragging && isOver ? 'over' : ''}
        `}
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      {...listeners}
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

type StereoProps = {
  cid: ChannelId
}

const Stereo: FC<StereoProps> = ({ cid }) => {
  const snap = useSnapshot(state)
  // all `st` values are the same between patches
  // FIXME: refactor data shape to reflect this
  const value = snap.patches[0].channels[cid].st
  const left = value & 0b01
  const right = (value & 0b10) >> 1

  const handleLeftClick = () => {
    const newValue = (right << 1) | (left ? 0 : 1)
    for (let i = 0; i < 4; i++) {
      state.patches[i].channels[cid].st = newValue
    }
  }

  const handleRightClick = () => {
    const newValue = ((right ? 0 : 1) << 1) | left
    for (let i = 0; i < 4; i++) {
      state.patches[i].channels[cid].st = newValue
    }
  }

  return (
    <div className="stereo">
      <div onClick={handleLeftClick} className={`left ${left ? 'on' : ''}`}>
        L
      </div>
      <div onClick={handleRightClick} className={`right ${right ? 'on' : ''}`}>
        R
      </div>
    </div>
  )
}

const Mixer = () => {
  return (
    <table className="mixer">
      <tbody>
        <tr>
          {([0, 1, 2, 3, 4, 5] as const).map((i) => (
            <td key={i}>
              <Stereo cid={i} />
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

const Scene = () => {
  const snap = useSnapshot(state)
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

  const handlePatchDragEnd = useCallback((event: DragEndEvent) => {
    const drag = event.active?.data?.current
    const drop = event.over?.data?.current

    if (!drag || !drop) return

    if (drop.action === 'move') {
      dispatch({ type: 'move-patch', index: drag.index, before: drop.index })
    } else if (drop.action === 'copy') {
      dispatch({ type: 'copy-patch', source: drag.index, target: drop.index })
    }
  }, [])

  const handleChannelDragEnd = useCallback((event: DragEndEvent) => {
    const drag = event.active?.data?.current
    const drop = event.over?.data?.current

    if (!drag || !drop) return

    if (drop.action === 'move') {
      dispatch({
        type: 'move-channel',
        index: drag.index,
        before: drop.index,
      })
    } else if (drop.action === 'copy') {
      dispatch({
        type: 'copy-channel',
        source: drag.index,
        target: drop.index,
      })
    }
  }, [])

  return (
    <>
      <br />
      <div className="four-cols">
        <div className="col">
          <Dropdown id="pm" />
          {snap.settings.pm === PlayModeEnum.POLY && <Dropdown id="rc" />}
        </div>
        <div className="col">
          <Slider id="tr" />
        </div>
        <div className="col">
          <Slider id="tu" />
        </div>
        <div className="col">
          <Slider id="lb" />
        </div>
      </div>

      {snap.settings.pm === PlayModeEnum.SEQ && <Sequencer />}

      {snap.settings.pm === PlayModeEnum.POLY ? (
        <Poly />
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
                        active={snap.patchIdx === i}
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
                        active={snap.channelIdx === i}
                        onClick={handleChannelClick(i as ChannelId)}
                      />
                    </React.Fragment>
                  ))}
                  <Droppable index={6} />
                </nav>
              </DndContext>
              <Mixer />
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
