import React from "react";
import { CV2612Provider } from "./context";
import "./styles.sass";
import Midi from "./midi";
import Scene from "./scene";

const App = () => (
  <CV2612Provider>
    <h3>CV-2612 Editor</h3>
    <Midi />
    <Scene />
  </CV2612Provider>
);

export default App;
