import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Studio from "./Studio.tsx";
import "./studio.css";

// No router here — the studio is a handful of screens behind a password, a
// plain state switch inside Studio.tsx is all it needs.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Studio />
  </StrictMode>,
);
