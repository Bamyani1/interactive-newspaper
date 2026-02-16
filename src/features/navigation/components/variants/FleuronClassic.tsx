"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";
import { staggerContainer, fadeUp } from "@/shared/motion/motionTokens";

const LEADERS = "· ".repeat(30);

export const FleuronClassic: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const container = staggerContainer(0.07, 0.2);
  const item = fadeUp(8);

  return (
    <motion.aside
      className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block"
      initial="hidden"
      animate="show"
    >
        <motion.nav
          key={sections.length}
          className="nav-fleuron"
          variants={container}
          initial="hidden"
          animate="show"
        >
          {/* Header Block */}
          <motion.div className="nav-fleuron-header-block" variants={item}>
            <div className="nav-fleuron-header">SECTIONS</div>
          </motion.div>

          {/* Section Rows */}
          {sections.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <motion.button
                key={section.id}
                variants={item}
                className={`nav-fleuron-row${isActive ? " nav-fleuron-row--active" : ""}`}
                onClick={() => onSelect(section.id)}
                aria-current={isActive ? "true" : undefined}
              >
                {isActive && (
                  <motion.div
                    className="nav-fleuron-active-rule"
                    layoutId="fleuron-active-rule"
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  />
                )}
                <span className="nav-fleuron-name">{section.label}</span>
                <span className="nav-fleuron-leaders">{LEADERS}</span>
                {section.count !== undefined && section.count > 0 && (
                  <span className="nav-fleuron-count">{section.count}</span>
                )}
              </motion.button>
            );
          })}
        </motion.nav>
    </motion.aside>
  );
};
