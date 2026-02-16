"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

export const BroadsheetCompact: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.04, 0.06);
  const item = fadeUp(4);

  return (
    <motion.aside
      className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block"
      initial="hidden"
      animate="show"
    >
      <motion.nav
        className="nav-broadsheet-compact"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div className="nav-bc-header" variants={item}>
          Sections
        </motion.div>

        {sections.map((section, i) => {
          const isActive = activeSection === section.id;
          return (
            <motion.button
              key={section.id}
              variants={item}
              className={`nav-bc-row ${isActive ? "nav-bc-row--active" : ""}`}
              onClick={() => onSelect(section.id)}
            >
              <span className="nav-bc-number">{i + 1}.</span>
              <span className="nav-bc-name">{section.label}</span>
              {section.count !== undefined && section.count > 0 && (
                <span className="nav-bc-count">{section.count}</span>
              )}
            </motion.button>
          );
        })}

        <motion.div className="nav-bc-footer" variants={item}>
          ※
        </motion.div>
      </motion.nav>
    </motion.aside>
  );
};
