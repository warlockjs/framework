import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { applyStoredTheme } from "@/app/useColorScheme";
import "./styles.css";

// Set the saved theme before the first render so the page does not flash the wrong one.
applyStoredTheme();

const container = document.getElementById("root");

if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
