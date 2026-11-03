import { t } from './i18n';
import { getLocale } from '../../../renderer/src/i18n/index';
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

document.documentElement.lang = getLocale();
document.title = t("ui.navigation.label.1386e28f");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
