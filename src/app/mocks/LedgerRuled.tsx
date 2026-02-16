"use client";

import React from "react";
import { motion } from "framer-motion";
import type { MockSidebarProps } from "./mockData";
import { staggerContainer, fadeLeft } from "@/shared/motion/motionTokens";

export const LedgerRuled: React.FC<MockSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.04, 0.06);
  const item = fadeLeft(8);

  return (
    <motion.nav
      className="mock-ledger"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div className="mock-ledger-header" variants={item}>
        Register
      </motion.div>

      {sections.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <motion.button
            key={section.id}
            variants={item}
            className={`mock-ledger-row ${isActive ? "mock-ledger-row--active" : ""}`}
            onClick={() => onSelect(section.id)}
          >
            <span className="mock-ledger-prefix">
              {isActive ? "§" : ""}
            </span>
            <span className="mock-ledger-name">{section.label}</span>
            <span className="mock-ledger-count">{section.count}</span>
          </motion.button>
        );
      })}
    </motion.nav>
  );
};
