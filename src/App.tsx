import React, { useState } from "react";
import Dashboard from "./views/Dashboard";
import Grades from "./views/Grades";
import Schedule from "./views/Schedule";
import Services from "./views/Services";
import AIAssistant from "./views/AIAssistant";

const TABS = [
  { id: "dashboard", label: "Home", icon: "house.fill" },
  { id: "grades", label: "Grades", icon: "chart.bar.fill" },
  { id: "schedule", label: "Schedule", icon: "calendar" },
  { id: "services", label: "Services", icon: "square.grid.2x2.fill" },
  { id: "ai", label: "AI", icon: "sparkles" },
];

function TabIcon({ icon, active }: { icon: string; active: boolean }) {
  const icons: Record<string, React.ReactElement> = {
    "house.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
    "chart.bar.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M3 12v7h4v-7H3zm0-2h4V7H3v3zm6 9h4V7H9v12zm0-14h4V3H9v2zm6 14h4V3h-4v18z" />
      </svg>
    ),
    "calendar": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M8 2v2H5a2 2 0 00-2 2v13a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-3V2h-2v2H9V2H8zm-3 7h14v9H5V9z" />
      </svg>
    ),
    "square.grid.2x2.fill": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
      </svg>
    ),
    "sparkles": (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
        <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm7 10l.9 2.7 2.7.9-2.7.9L19 19l-.9-2.7-2.7-.9 2.7-.9L19 12zM5 16l.7 2.1 2.1.7-2.1.7L5 21.5l-.7-2.1-2.1-.7 2.1-.7L5 16z" />
      </svg>
    ),
  };
  return icons[icon] || null;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div
      className="relative w-full h-full flex flex-col overflow-hidden"
      style={{ background: "#000", fontFamily: "Inter, system-ui, sans-serif", maxWidth: 430, margin: "0 auto" }}
    >
      {/* Status Bar */}
      <div className="flex items-center justify-between px-6 pt-3 pb-1 shrink-0" style={{ height: 44 }}>
        <span className="text-white text-sm font-semibold" style={{ fontFamily: "Inter" }}>9:41</span>
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 10" fill="white" className="w-4 h-3 opacity-90">
            <rect x="0" y="4" width="3" height="6" rx="0.5" />
            <rect x="4.5" y="3" width="3" height="7" rx="0.5" />
            <rect x="9" y="1" width="3" height="9" rx="0.5" />
            <rect x="13.5" y="0" width="3" height="10" rx="0.5" />
          </svg>
          <svg viewBox="0 0 16 12" fill="white" className="w-4 h-3 opacity-90">
            <path d="M8 2C5.4 2 3.1 3.1 1.5 4.8L0 3.3C2 1.2 4.9 0 8 0s6 1.2 8 3.3L14.5 4.8C12.9 3.1 10.6 2 8 2zm0 4c-1.5 0-2.8.6-3.8 1.5L2.8 6.1C4.2 4.8 6 4 8 4s3.8.8 5.2 2.1l-1.4 1.4C10.8 6.6 9.5 6 8 6zm0 4a2 2 0 110 4 2 2 0 010-4z" />
          </svg>
          <div className="flex items-center gap-0.5">
            <div className="rounded-sm" style={{ width: 22, height: 11, background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.4)", padding: "1.5px 2px" }}>
              <div className="h-full rounded-sm" style={{ width: "80%", background: "#30D158" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "grades" && <Grades />}
        {activeTab === "schedule" && <Schedule />}
        {activeTab === "services" && <Services />}
        {activeTab === "ai" && <AIAssistant />}
      </div>

      {/* Tab Bar */}
      <div className="tab-bar shrink-0 flex items-start justify-around pt-2 pb-5 px-2" style={{ height: 83 }}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex flex-col items-center gap-1 px-4 py-1 transition-all duration-200"
              style={{ minWidth: 60 }}
            >
              <span style={{ color: active ? "#007AFF" : "rgba(235,235,245,0.45)", transition: "color 0.2s" }}>
                <TabIcon icon={tab.icon} active={active} />
              </span>
              <span
                className="text-xs font-medium"
                style={{ color: active ? "#007AFF" : "rgba(235,235,245,0.45)", fontSize: 10, transition: "color 0.2s" }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
