import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CovidAtlas } from "../app/CovidAtlas";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CovidAtlas />
  </StrictMode>,
);
