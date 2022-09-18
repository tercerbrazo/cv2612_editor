import React from "react";
import { CV2612Provider } from "./context";
import "./styles.sass";
import Midi from "./midi";
import Scene from "./scene";
import logo from "./logo.png";

console.log(logo);

const App = () => (
  <CV2612Provider>
    <div className="two-cols">
      <div className="col">
        <img src={logo} height={"80px"} />
      </div>
      <div className="col">
        <h3 style={{ textAlign: "right" }}>CV-2612 Editor</h3>
      </div>
    </div>
    <Midi />
    <Scene />
  </CV2612Provider>
);

export default App;
