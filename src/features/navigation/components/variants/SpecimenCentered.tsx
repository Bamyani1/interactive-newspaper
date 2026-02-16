"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

export const SpecimenCentered: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.06, 0.1);
  const item = fadeUp(8);

  return (
    <motion.aside
      className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block"
      initial="hidden"
      animate="show"
    >
      <motion.nav
        className="nav-specimen"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {sections.map((section, i) => {
          const isActive = activeSection === section.id;
          return (
            <React.Fragment key={section.id}>
              {i > 0 && (
                <motion.div className="nav-specimen-divider" variants={item} />
              )}
              <motion.button
                variants={item}
                className={`nav-specimen-entry ${isActive ? "nav-specimen-entry--active" : ""}`}
                onClick={() => onSelect(section.id)}
              >
                <span className="nav-specimen-name">
                  {isActive && <span className="nav-specimen-star">✦</span>}
                  {section.label}
                </span>
                {section.count !== undefined && section.count > 0 && (
                  <span className="nav-specimen-count">
                    {section.count} {section.count === 1 ? "story" : "stories"}
                  </span>
                )}
              </motion.button>
            </React.Fragment>
          );
        })}

        <motion.div className="nav-specimen-end" variants={item}>
          ◆
        </motion.div>
      </motion.nav>
    </motion.aside>
  );
};
