import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import { applyTheme } from "./hooks/useTheme.js";
import "./index.css";

// The call screen pulls in livekit-client, by far the largest thing we ship.
// Splitting it here means the landing page — where people type a name and a
// room code — no longer downloads an entire WebRTC stack it will never use.
// It is fetched while the user is deciding, not before the page paints.
const Room = lazy(() => import("./Room.jsx"));

// Apply the saved/system theme before first paint to avoid a flash.
applyTheme(
  localStorage.getItem("meet:theme") ||
    (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark")
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="route-loading" />}>
        <Routes>
          {/* Bare routes use the public tenant; /t/<tenant>/… namespaces the
              room so different clients can reuse friendly codes without
              colliding. See server/services/roomKey.js. */}
          <Route path="/" element={<App />} />
          <Route path="/room/:code" element={<Room />} />
          <Route path="/t/:tenant" element={<App />} />
          <Route path="/t/:tenant/room/:code" element={<Room />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
