import React, { useContext } from "react";
import { CV2612Context } from "./context";
import Channel from "./channel";
import Slider from "./slider";

const Scene = () => {
  const { state, dispatch } = useContext(CV2612Context);

  const onChangePatch = (index) => (ev) => {
    ev.preventDefault();
    dispatch({ type: "change-patch", index });
  };

  const onChangeChannel = (index) => (ev) => {
    ev.preventDefault();
    dispatch({ type: "change-channel", index });
  };

  return (
    <>
      <br />
      <br />
      <div className="four-cols">
        <div className="col">
          <Slider
            label="pz"
            title="Patch Zone"
            cc={118}
            unbounded
            noChannel
            bits={2}
          />
          <Slider label="bl" title="Blend" cc={119} noChannel bits={7} />
          {/*
          <Slider label="polyphony" cc={96} noChannel bits={2} />
          <Slider label="quantize" cc={97} noChannel bits={1} />
          <Slider label="legato" cc={98} noChannel bits={1} />
          <Slider label="portamento" cc={99} noChannel bits={7} />
          <Slider label="velocity" cc={100} noChannel bits={1} />
          */}
        </div>
        <div className="col">
          <Slider
            label="pm"
            title={"Play Mode"}
            cc={90}
            unbounded
            noChannel
            bits={3}
          />
          <Slider
            label="lb"
            title="Led Brightness"
            cc={91}
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
            unbounded
            bits={7}
          />
          <Slider
            label="tu"
            title="Tunning"
            cc={95}
            noChannel
            unbounded
            bits={7}
          />
        </div>
        <div className="col">
          <Slider
            label="rc"
            title="Midi Receive Channel"
            cc={92}
            noChannel
            unbounded
            bits={5}
          />
          <Slider
            label="am"
            title="Attenuverter Mode"
            cc={93}
            noChannel
            unbounded
            bits={2}
          />
        </div>
      </div>

      <div className="two-cols">
        <div className="col">
          <nav>
            {[0, 1, 2, 3].map((i) => (
              <a
                href="/"
                className={state.patchIdx === i ? "active" : ""}
                key={i}
                onClick={onChangePatch(i)}
                title={`Patch ${"ABCD"[i]}`}
              >
                {"ABCD"[i]}
              </a>
            ))}
          </nav>
        </div>
        <div className="col">
          <nav>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <a
                href="/"
                className={state.channelIdx === i ? "active" : ""}
                key={i}
                onClick={onChangeChannel(i)}
                title={`Channel ${i + 1}`}
              >{`${i + 1}`}</a>
            ))}
          </nav>
        </div>
      </div>

      <br />

      <Channel />
    </>
  );
};

export default Scene;
