import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applySkin, loadUiTheme, type UiTheme } from "./theme";

async function mountShell() {
  // Native initialization supplies the persisted mode before the document runs.
  // Browser previews use the same bounded settings read instead.
  const initial = (window as Window & { __DSH_INITIAL_THEME__?: UiTheme }).__DSH_INITIAL_THEME__;
  const mode = initial === "dark" || initial === "light" || initial === "system" ? initial
    : await Promise.race([loadUiTheme(), new Promise<UiTheme>(resolve => setTimeout(() => resolve("system"), 1500))]);
  applySkin(mode);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}
void mountShell();
