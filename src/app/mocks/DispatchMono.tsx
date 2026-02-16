"use client";

import React from "react";
import { motion } from "framer-motion";
import type { MockSidebarProps } from "./mockData";

const STAGGER_MS = 60;

export const DispatchMono: React.FC<MockSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  return (
    <motion.nav className="mock-dispatch">
      <div className="mock-dispatch-rule" />
      <div className="mock-dispatch-header">Dispatch Log</div>
      <div className="mock-dispatch-rule" />

      <div className="mock-dispatch-list">
        {sections.map((section, i) => {
          const isActive = activeSection === section.id;
          const num = String(i + 1).padStart(2, "0");
          return (
            <motion.button
              key={section.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * (STAGGER_MS / 1000), duration: 0.01 }}
              className={`mock-dispatch-row ${isActive ? "mock-dispatch-row--active" : ""}`}
              onClick={() => onSelect(section.id)}
            >
              <span className="mock-dispatch-number">{num}.</span>
              <span className="mock-dispatch-prefix">
                {isActive ? "▸ " : "  "}
              </span>
              <span className="mock-dispatch-name">{section.label}</span>
              <span className="mock-dispatch-count">
                [{String(section.count).padStart(2, "0")}]
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="mock-dispatch-footer">— End —</div>
    </motion.nav>
  );
};
