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
import { ChannelId, CV2612Context, PatchId } from './context'
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

const StepSeq = () => {
  const { state, dispatch } = useContext(CV2612Context)

  const handleClick = useCallback(
    (voice, step) => {
      dispatch({ type: 'toggle-seq-step', voice, step })
    },
    [dispatch]
  )

  return (
    state.moduleState['pm-0-0-0'] === 4 && (
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
                  {voiceSteps.map((step, j) => {
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

  const handlePatchClick = (index: PatchId) => (ev) => {
    ev.preventDefault()
    dispatch({ type: 'change-patch', index })
  }

  const handleChannelClick = (index: ChannelId) => (ev) => {
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
          <Dropdown id="rc" />
          <Dropdown id="atm" />
        </div>
      </div>

      <StepSeq />

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
  )
}

export default Scene
