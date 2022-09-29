import React, { useEffect, useReducer } from "react";
import { calculateEnvelopePoints } from "./utils/envelopePoints";
// import { reactLocalStorage } from "reactjs-localstorage"
import MidiIO from "./midi-io";
import { compress, decompress } from "lzutf8";

const CV2612Context = React.createContext();

/*
 * A Patch is the state of the YM2612 regarding sound design.
 * What defines a patch is the value of the whole parameters set,
 * which can be defined by a set of CC values.
 */
const emptyPatch = () => {
  const ccsPerChannel = [];

  for (let i = 0; i < 6; i++) {
    const ccs = {
      20: 7 << (7 - 3), // al
      21: 0, // fb
      22: 0, // ams
      23: 0, // fms
      24: 3 << (7 - 2), // st
    };
    for (let op = 0; op < 4; op++) {
      ccs[`${30 + op * 10 + 0}`] = 0; // ar
      ccs[`${30 + op * 10 + 1}`] = 0; // d1
      ccs[`${30 + op * 10 + 2}`] = 0; // sl
      ccs[`${30 + op * 10 + 3}`] = 0; // d2
      ccs[`${30 + op * 10 + 4}`] = 0; // rr
      ccs[`${30 + op * 10 + 5}`] = 0; // tl
      ccs[`${30 + op * 10 + 6}`] = 0; // mul
      ccs[`${30 + op * 10 + 7}`] = 0; // det
      ccs[`${30 + op * 10 + 8}`] = 0; // rs
      ccs[`${30 + op * 10 + 9}`] = 0; // am
    }
    ccsPerChannel.push(ccs);
  }
  ccsPerChannel[0][1] = 0; // lfo
  ccsPerChannel[0][119] = 0; // blend

  return ccsPerChannel;
};

const emptyPatches = () => {
  const patches = [];
  for (let i = 0; i < 4; i++) {
    patches.push(emptyPatch());
  }
  return patches;
};

const initialState = {
  activeBinding: null,
  bindings: { x: [], y: [], z: [] },
  envelopes: {},
  patches: emptyPatches(),
  patchIdx: 0,
  channelIdx: 0,
};

const updateEnvelope = (patch, ch, op) => {
  const ar = patch[ch][30 + 10 * op + 0] / 127;
  const d1 = patch[ch][30 + 10 * op + 1] / 127;
  const sl = patch[ch][30 + 10 * op + 2] / 127;
  const d2 = patch[ch][30 + 10 * op + 3] / 127;
  const rr = patch[ch][30 + 10 * op + 4] / 127;
  const tl = patch[ch][30 + 10 * op + 5] / 127;

  return calculateEnvelopePoints({ ar, d1, sl, d2, rr, tl });
};

const bindingsMap = { x: 110, y: 111, z: 112 };

const touchParam = (state, cc) => {
  if (state.activeBinding) {
    const bindings = { ...state.bindings };

    const exists = bindings[state.activeBinding].includes(cc);

    if (exists) {
      bindings[state.activeBinding] = bindings[state.activeBinding].filter(
        (i) => i !== cc
      );
    } else {
      bindings[state.activeBinding].push(cc);
    }

    // re-send cc value (of first channel) just to make it the lastParameter
    const patch = state.patches[state.patchIdx];
    console.log(patch[0][cc], cc, patch[0]);
    MidiIO.sendCC(0, cc, patch[0][cc]);
    // bind parameter
    MidiIO.sendCC(0, bindingsMap[state.activeBinding], exists ? 0 : 127);

    return { ...state, bindings };
  } else {
    return state;
  }
};

const updateParam = (state, ch, cc, val) => {
  const patch = state.patches[state.patchIdx];

  // update patch state
  patch[ch][cc] = val;

  MidiIO.sendCC(ch, cc, val);

  const envelopes = { ...state.envelopes };

  // does this parameter change an envelope?
  if (cc >= 30 && cc < 70 && cc % 10 <= 5) {
    // get operator index from cc
    const op = Math.floor((cc - 30) / 10, 0);

    envelopes[op] = updateEnvelope(patch, ch, op);
  }

  return { ...state, envelopes };
};

const updateParams = (state) => {
  const envelopes = { ...state.envelopes };
  const patch = state.patches[state.patchIdx];
  const ch = state.channelIdx;

  // TODO: do not asume envelopes have changed
  for (let op = 0; op < 4; op++) {
    envelopes[op] = updateEnvelope(patch, ch, op);
  }

  return { ...state, envelopes };
};

const syncMidi = (state) => {
  for (let i = 0; i < 4; i++) {
    const patch = state.patches[i];
    patch.forEach((ccs, ch) => {
      Object.entries(ccs).forEach(([key, val]) => {
        const cc = parseInt(key, 10);
        // sync midi cc
        MidiIO.sendCC(ch, cc, val);
        if (i === 0 && ch === 0) {
          // sync bindings
          MidiIO.sendCC(0, 110, state.bindings.x.includes(cc) ? 127 : 0);
          MidiIO.sendCC(0, 111, state.bindings.y.includes(cc) ? 127 : 0);
          MidiIO.sendCC(0, 112, state.bindings.z.includes(cc) ? 127 : 0);
        }
      });
    });
  }
};

const resetChannel = (state) => {
  const patch = state.patches[state.patchIdx];
  const ch = state.channelIdx;

  const updateAndSync = (ch, cc, val) => {
    // update patch state
    patch[ch][cc] = val;
    // sync midi cc
    MidiIO.sendCC(ch, cc, val);
  };

  updateAndSync(0, 1, 0);
  updateAndSync(ch, 20, 127);
  updateAndSync(ch, 21, 0);
  updateAndSync(ch, 22, 0);
  updateAndSync(ch, 23, 0);
  updateAndSync(ch, 24, 127);

  return resetOperator(
    resetOperator(resetOperator(resetOperator(state, 0), 1), 2),
    3
  );
};

const resetOperator = (state, op) => {
  const patch = state.patches[state.patchIdx];
  const ch = state.channelIdx;

  const updateAndSync = (cc, val) => {
    // update patch state
    patch[ch][cc] = val;
    // sync midi cc
    MidiIO.sendCC(ch, cc, val);
  };

  updateAndSync(30 + op * 10 + 0, 127);
  updateAndSync(30 + op * 10 + 1, 0);
  updateAndSync(30 + op * 10 + 2, 0);
  updateAndSync(30 + op * 10 + 3, 0);
  updateAndSync(30 + op * 10 + 4, 127);
  updateAndSync(30 + op * 10 + 5, 0);

  updateAndSync(30 + op * 10 + 6, 32);
  updateAndSync(30 + op * 10 + 7, 64);
  updateAndSync(30 + op * 10 + 8, 0);
  updateAndSync(30 + op * 10 + 9, 0);

  return updateParams(state);
};

//TODO: udpateParams without sending MIDI out
const reducer = (state, action) => {
  switch (action.type) {
    case "provider-ready":
      return updateParams(action.savedState ? action.savedState : state);
    case "touch-param":
      return touchParam(state, action.cc);
    case "update-param":
      return updateParam(state, action.ch, action.cc, action.val);
    case "toggle-binding":
      return {
        ...state,
        activeBinding:
          action.binding === state.activeBinding ? null : action.binding,
      };
    case "reset-channel":
      return resetChannel(state);
    case "reset-operator":
      return resetOperator(state, action.op);
    case "change-patch":
      const patchIdx = action.index;
      MidiIO.sendCC(0, 120, patchIdx);
      return updateParams({ ...state, patchIdx }, false);
    case "change-channel":
      const channelIdx = action.index;
      return updateParams({ ...state, channelIdx });
    case "sync-midi":
      syncMidi(state);
      return state;
    case "save-patch":
      MidiIO.sendCC(0, 121, state.patchIdx);
      const savedState = { ...state, activeBinding: null };
      // reactLocalStorage.set("savedState", JSON.stringify(savedState))
      return savedState;
    default:
      throw new Error("Invalid action type");
  }
};

const encodeState = (state) => {
  const patches = state.patches.reduce(
    (acc, p) =>
      acc +
      p.reduce(
        (acc, ccs) =>
          acc +
          Object.values(ccs).reduce(
            (acc, val) => acc + val.toString(16).padStart(2, "0"),
            ""
          ),
        ""
      ),
    ""
  );

  const bindings = Object.values(state.bindings).reduce(
    (acc, p) =>
      acc +
      "|" +
      p.reduce((acc, ccs) => acc + ccs.toString(16).padStart(2, "0"), ""),
    ""
  );

  const output = compress(`${patches}${bindings}`, {
    outputEncoding: "Base64",
  });

  return output;
};

const decodeState = (str) => {
  const output = decompress(str, {
    inputEncoding: "Base64",
  });

  const values = output.split("|").map((s) =>
    s
      .split(/(.{2})/)
      .filter((s) => s)
      .map((s) => parseInt(s, 16))
  );

  const { patches, bindings } = { ...initialState };

  const patchValues = values.shift();
  patches.forEach((p) => {
    p.forEach((ch) => {
      Object.entries(ch).forEach(([k, v]) => {
        ch[k] = patchValues.shift();
      });
    });
  });

  Object.entries(bindings).forEach(([k, v]) => {
    const bindingValues = values.shift();
    bindings[k] = [...bindingValues];
  });

  return { patches, bindings };
};

let saveId = null;
const CV2612Provider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const value = { state, dispatch };

  const doSaveState = () => {
    const str = encodeState(state);

    // push the state
    window.history.pushState(null, null, `#${str}`);
  };

  const saveStateDelayed = () => {
    if (saveId) {
      clearTimeout(saveId);
    }
    saveId = setTimeout(doSaveState, 500);
  };

  useEffect(saveStateDelayed, [state]);

  useEffect(() => {
    (async () => {
      await MidiIO.init();
      // const str = await reactLocalStorage.get("savedState")
      // const savedState = str ? JSON.parse(str) : null
      // dispatch({ type: "provider-ready", savedState })
      const parts = window.location.hash.split("#");
      if (parts.length === 2) {
        const str = parts[1];
        const savedState = { ...state, ...decodeState(str) };
        dispatch({ type: "provider-ready", savedState });
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CV2612Context.Provider value={value}>{children}</CV2612Context.Provider>
  );
};

const CV2612Consumer = CV2612Context.Consumer;

export { CV2612Context, CV2612Provider, CV2612Consumer };
