"use client";

import React from "react";
import { motion } from "framer-motion";
import type { MockSidebarProps } from "./mockData";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

export const BroadsheetCompact: React.FC<MockSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.04, 0.06);
  const item = fadeUp(4);

  return (
    <motion.nav
      className="mock-broadsheet-compact"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div className="mock-bc-header" variants={item}>
        Sections
      </motion.div>

      {sections.map((section, i) => {
        const isActive = activeSection === section.id;
        return (
          <motion.button
            key={section.id}
            variants={item}
            className={`mock-bc-row ${isActive ? "mock-bc-row--active" : ""}`}
            onClick={() => onSelect(section.id)}
          >
            <span className="mock-bc-number">{i + 1}.</span>
            <span className="mock-bc-name">{section.label}</span>
            <span className="mock-bc-count">{section.count}</span>
          </motion.button>
        );
      })}

      <motion.div className="mock-bc-footer" variants={item}>
        ※
      </motion.div>
    </motion.nav>
  );
};
