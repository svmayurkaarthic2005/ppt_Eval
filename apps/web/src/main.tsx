import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./index.css";
import Layout from "./components/Layout";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import AdminCalibration from "./pages/AdminCalibration";
import Compare from "./pages/Compare";
import Dashboard from "./pages/Dashboard";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Team from "./pages/Team";
import Upload from "./pages/Upload";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfirmDialogProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/team/:id" element={<Team />} />
            <Route path="/admin/calibration" element={<AdminCalibration />} />
            <Route path="/login" element={<Login />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfirmDialogProvider>
  </React.StrictMode>,
);
