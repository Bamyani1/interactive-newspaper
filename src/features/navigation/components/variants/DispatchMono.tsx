"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";

const STAGGER_MS = 60;

export const DispatchMono: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  return (
    <motion.aside
      className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block"
      initial="hidden"
      animate="show"
    >
      <nav className="nav-dispatch">
        <div className="nav-dispatch-rule" />
        <div className="nav-dispatch-header">Dispatch Log</div>
        <div className="nav-dispatch-rule" />

        <div className="nav-dispatch-list">
          {sections.map((section, i) => {
            const isActive = activeSection === section.id;
            const num = String(i + 1).padStart(2, "0");
            return (
              <motion.button
                key={section.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * (STAGGER_MS / 1000), duration: 0.01 }}
                className={`nav-dispatch-row ${isActive ? "nav-dispatch-row--active" : ""}`}
                onClick={() => onSelect(section.id)}
              >
                <span className="nav-dispatch-number">{num}.</span>
                <span className="nav-dispatch-prefix">
                  {isActive ? "▸ " : "  "}
                </span>
                <span className="nav-dispatch-name">{section.label}</span>
                {section.count !== undefined && section.count > 0 && (
                  <span className="nav-dispatch-count">
                    [{String(section.count).padStart(2, "0")}]
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        <div className="nav-dispatch-footer">— End —</div>
      </nav>
    </motion.aside>
  );
};
