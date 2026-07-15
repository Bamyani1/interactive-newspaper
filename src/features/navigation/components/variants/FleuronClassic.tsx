"use client";

import React from "react";
import { motion } from "framer-motion";
import type { NavigationSidebarProps } from "../NavigationSidebar";

export const FleuronClassic: React.FC<NavigationSidebarProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  return (
    <aside className="edition-sidebar-surface h-full min-h-0 overflow-y-auto hidden md:block">
        <nav className="nav-fleuron">
          {/* Header Block */}
          <div className="nav-fleuron-header-block">
            <div className="nav-fleuron-header">SECTIONS</div>
          </div>

          {/* Section Rows */}
          {sections.map((section) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
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
                <span className="nav-fleuron-leaders" aria-hidden="true" />
                {section.count !== undefined && section.count > 0 && (
                  <span className="nav-fleuron-count">{section.count}</span>
                )}
              </button>
            );
          })}
        </nav>
    </aside>
  );
};
