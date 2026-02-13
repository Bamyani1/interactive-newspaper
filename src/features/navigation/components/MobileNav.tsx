"use client";

import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Newspaper,
  Trophy,
  Sparkles,
  MessageSquare,
  Palette,
  Users,
  ShoppingBag,
  Star,
} from "lucide-react";
import type { SectionId } from "@/src/types";

const SECTION_ICONS: Partial<Record<SectionId, React.ElementType>> = {
  Top: Star,
  All: Star,
  News: Newspaper,
  Sports: Trophy,
  Features: Sparkles,
  Opinion: MessageSquare,
  Arts: Palette,
  "Campus Life": Users,
  Ads: ShoppingBag,
};

interface MobileNavProps {
  sections: {
    id: SectionId;
    label: string;
    count?: number;
  }[];
  activeSection: SectionId;
  onSelect: (section: SectionId) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({
  sections,
  activeSection,
  onSelect,
}) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMoreSelect = (sectionId: SectionId) => {
    onSelect(sectionId);
    setIsMoreOpen(false);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 lg:hidden z-50 bg-[var(--color-bg-primary)]/95 backdrop-blur-md border-t"
      style={{ borderColor: "var(--stroke-accent-soft)" }}
    >
      <div className="flex items-center justify-around px-2 py-2 max-w-lg mx-auto">
        {sections.slice(0, 5).map((section) => {
          const Icon = SECTION_ICONS[section.id] || Newspaper;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              className={`
                relative flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-lg transition-colors min-w-[60px]
                ${isActive
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }
              `}
              aria-current={isActive ? "true" : undefined}
              aria-label={section.label}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-medium uppercase tracking-wider truncate max-w-[56px]">
                {section.id === "Campus Life" ? "Campus" : section.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-indicator"
                  className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-accent)]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {/* More sections dropdown if more than 5 */}
        {sections.length > 5 && (
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setIsMoreOpen((prev) => !prev)}
              className="flex flex-col items-center justify-center gap-1 py-2 px-3 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="More sections"
              aria-expanded={isMoreOpen}
            >
              <div className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
              </div>
              <span className="text-[10px] font-medium uppercase tracking-wider">
                More
              </span>
            </button>

            {/* Dropdown for additional sections */}
            <AnimatePresence>
              {isMoreOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full right-0 mb-2 py-2 bg-[var(--color-bg-secondary)] rounded-lg shadow-xl border"
                  style={{ borderColor: "var(--stroke-accent-soft)" }}
                >
                  {sections.slice(5).map((section) => {
                    const Icon = SECTION_ICONS[section.id] || Newspaper;
                    const isActive = activeSection === section.id;

                    return (
                      <button
                        key={section.id}
                        onClick={() => handleMoreSelect(section.id)}
                        className={`
                          flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors
                          ${isActive
                            ? "text-[var(--color-accent)] bg-[var(--color-accent)]/10"
                            : "text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/5"
                          }
                        `}
                      >
                        <Icon size={16} />
                        <span className="text-sm font-medium whitespace-nowrap">
                          {section.label}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </nav>
  );
};
