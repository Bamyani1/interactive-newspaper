"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";
import { staggerContainer, fadeLeft } from "@/shared/motion/motionTokens";

export const LedgerRuled: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.04, 0.06);
  const item = fadeLeft(8);

  return (
    <motion.aside
      className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block"
      initial="hidden"
      animate="show"
    >
      <motion.nav
        className="nav-ledger"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div className="nav-ledger-header" variants={item}>
          Register
        </motion.div>

        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <motion.button
              key={section.id}
              variants={item}
              className={`nav-ledger-row ${isActive ? "nav-ledger-row--active" : ""}`}
              onClick={() => onSelect(section.id)}
            >
              <span className="nav-ledger-prefix">
                {isActive ? "§" : ""}
              </span>
              <span className="nav-ledger-name">{section.label}</span>
              {section.count !== undefined && section.count > 0 && (
                <span className="nav-ledger-count">{section.count}</span>
              )}
            </motion.button>
          );
        })}
      </motion.nav>
    </motion.aside>
  );
};
