import {
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

import React, { useCallback, useContext, useMemo } from 'react'
import Channel from './channel'
import { CV2612Context } from './context'
import Dropdown from './dropdown'
import Slider from './slider'

function useCombinedRefs<T>(...refs: ((node: T) => void)[]): (node: T) => void {
  return useMemo(
    () => (node: T) => {
      refs.forEach((ref) => ref(node))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    refs
  )
}

const Draggable = ({ index, text, active, onClick }) => {
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

  const handlePatchClick = (index: number) => (ev) => {
    ev.preventDefault()
    dispatch({ type: 'change-patch', index })
  }

  const handleChannelClick = (index: number) => (ev) => {
    ev.preventDefault()
    dispatch({ type: 'change-channel', index })
  }

  const handlePatchDragEnd = useCallback(
    (event) => {
      const drag = event.active?.data?.current
      const drop = event.over?.data?.current

      if (drop?.action === 'move') {
        dispatch({ type: 'move-patch', index: drag.index, before: drop.index })
      } else if (drop?.action === 'copy') {
        dispatch({ type: 'copy-patch', source: drag.index, target: drop.index })
      }
    },
    [dispatch]
  )

  const handleChannelDragEnd = useCallback(
    (event) => {
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
    [dispatch]
  )

  return (
    <>
      <br />
      <div className="four-cols">
        <div className="col">
          <Dropdown
            label="pz"
            title="Patch Zone"
            cc={118}
            options={['A- B', 'B - C', 'C - D']}
          />
          <Slider
            label="bl"
            title="Blend"
            cc={119}
            setting
            noChannel
            bits={7}
          />
          {/*
          <Slider label="polyphony" cc={96} noChannel bits={2} />
          <Slider label="quantize" cc={97} noChannel bits={1} />
          <Slider label="legato" cc={98} noChannel bits={1} />
          <Slider label="portamento" cc={99} noChannel bits={7} />
          <Slider label="velocity" cc={100} noChannel bits={1} />
          */}
        </div>
        <div className="col">
          <Dropdown
            label="pm"
            title="Play Mode"
            cc={90}
            options={['MONO', 'DUO', 'TRIO', 'CHORD', 'CYCLE', 'RAND', 'POLY']}
          />
          <Slider
            label="lb"
            title="Led Brightness"
            cc={91}
            setting
            noChannel
            unbounded
            bits={7}
          />
        </div>
        <div className="col">
          <Slider
            label="tr"
            title="Transpose"
            cc={94}
            noChannel
            setting
            unbounded
            bits={7}
          />
          <Slider
            label="tu"
            title="Tunning"
            cc={95}
            noChannel
            setting
            unbounded
            bits={7}
          />
        </div>
        <div className="col">
          <Dropdown
            label="rc"
            title="Midi Receive Channel"
            cc={92}
            options={[
              'OMNI',
              'RESPECT',
              1,
              2,
              3,
              4,
              5,
              6,
              7,
              8,
              9,
              10,
              11,
              12,
              13,
              14,
              15,
              16,
            ]}
          />
          <Dropdown
            label="am"
            title="Attenuverter Mode"
            cc={93}
            options={['AUTO', 'OFFSET', 'ATTENUVERTER']}
          />
        </div>
      </div>

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
                    onClick={handlePatchClick(i)}
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
                    onClick={handleChannelClick(i)}
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
  )
}

export default Scene
