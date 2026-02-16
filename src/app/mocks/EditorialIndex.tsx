"use client";

import React from "react";
import { motion } from "framer-motion";
import type { MockSidebarProps } from "./mockData";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

const LEADERS = "· ".repeat(30);

export const EditorialIndex: React.FC<MockSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.06, 0.12);
  const item = fadeUp(6);

  return (
    <motion.nav
      className="mock-editorial"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div
        className="mock-editorial-header"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: "center" }}
      >
        Index
      </motion.div>

      {sections.map((section) => {
        const isActive = activeSection === section.id;
        return (
          <motion.button
            key={section.id}
            variants={item}
            className={`mock-editorial-row ${isActive ? "mock-editorial-row--active" : ""}`}
            onClick={() => onSelect(section.id)}
          >
            {isActive && <div className="mock-editorial-active-rule" />}
            <span className="mock-editorial-name">{section.label}</span>
            <span className="mock-editorial-leaders">{LEADERS}</span>
            <span className="mock-editorial-count">{section.count}</span>
          </motion.button>
        );
      })}

      <motion.div className="mock-editorial-endmark" variants={item}>
        ■
      </motion.div>
    </motion.nav>
  );
};
