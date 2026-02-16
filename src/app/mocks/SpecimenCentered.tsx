"use client";

import React from "react";
import { motion } from "framer-motion";
import type { MockSidebarProps } from "./mockData";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

export const SpecimenCentered: React.FC<MockSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.06, 0.1);
  const item = fadeUp(8);

  return (
    <motion.nav
      className="mock-specimen"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {sections.map((section, i) => {
        const isActive = activeSection === section.id;
        return (
          <React.Fragment key={section.id}>
            {i > 0 && (
              <motion.div className="mock-specimen-divider" variants={item} />
            )}
            <motion.button
              variants={item}
              className={`mock-specimen-entry ${isActive ? "mock-specimen-entry--active" : ""}`}
              onClick={() => onSelect(section.id)}
            >
              <span className="mock-specimen-name">
                {isActive && <span className="mock-specimen-star">✦</span>}
                {section.label}
              </span>
              <span className="mock-specimen-count">
                {section.count} {section.count === 1 ? "story" : "stories"}
              </span>
            </motion.button>
          </React.Fragment>
        );
      })}

      <motion.div className="mock-specimen-end" variants={item}>
        ◆
      </motion.div>
    </motion.nav>
  );
};
