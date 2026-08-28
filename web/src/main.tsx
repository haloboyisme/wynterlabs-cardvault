import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import { applyAppearance, readAppearance, watchSystemTheme } from "./lib/appearance";
import "./styles/global.css";
import "./styles/workspace.css";

applyAppearance(readAppearance());
watchSystemTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
