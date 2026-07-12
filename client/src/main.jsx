import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Room from "./Room.jsx";
import { applyTheme } from "./hooks/useTheme.js";
import "./index.css";

// Apply the saved/system theme before first paint to avoid a flash.
applyTheme(
  localStorage.getItem("meet:theme") ||
    (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/room/:roomId" element={<Room />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
