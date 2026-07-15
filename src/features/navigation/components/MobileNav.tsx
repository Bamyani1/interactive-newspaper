"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { TRANSITIONS } from "@/shared/motion/motionTokens";
import {
  Newspaper,
  Trophy,
  MessageSquare,
  MessageCircleQuestion,
  Palette,
  Globe,
  ShoppingBag,
  Star,
  Search,
} from "lucide-react";
import type { SectionId } from "@/src/types";

const SECTION_ICONS: Partial<Record<SectionId, React.ElementType>> = {
  Top: Star,
  All: Star,
  "Campus News": Newspaper,
  News: Globe,
  Sports: Trophy,
  Opinion: MessageSquare,
  "Arts & Entertainment": Palette,
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
  const pathname = usePathname();
  const isSearchActive = pathname?.startsWith("/search") ?? false;
  const isAskActive = pathname?.startsWith("/ask") ?? false;
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuId = useId();

  const getMenuItems = () =>
    Array.from(
      moreMenuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    ).filter((item) => {
      const style = window.getComputedStyle(item);
      return style.display !== "none" && style.visibility !== "hidden";
    });

  const openMore = (edge: "first" | "last" = "first") => {
    setIsMoreOpen(true);
    window.requestAnimationFrame(() => {
      const items = getMenuItems();
      (edge === "first" ? items[0] : items[items.length - 1])?.focus();
    });
  };

  const closeMore = (returnFocus = false) => {
    setIsMoreOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => moreButtonRef.current?.focus());
    }
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        closeMore();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isMoreOpen) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMore(true);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isMoreOpen]);

  const handleMoreSelect = (sectionId: SectionId) => {
    onSelect(sectionId);
    closeMore(true);
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null || items.length === 0) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 lg:hidden z-[var(--z-header)] bg-[var(--color-bg-primary)]/95 backdrop-blur-md border-t border-[var(--stroke-accent-soft)]"
    >
      <div className="flex items-center justify-around px-2 py-2 max-w-lg mx-auto">
        {sections.slice(0, 5).map((section, idx) => {
          const Icon = SECTION_ICONS[section.id] || Newspaper;
          const isActive = activeSection === section.id;
          const hideOnMobile = idx >= 3;

          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              className={`
                relative flex-col items-center justify-center gap-1 py-2 px-2 sm:px-3 rounded-sm transition-colors min-w-[48px] sm:min-w-[60px]
                ${hideOnMobile ? "hidden sm:flex" : "flex"}
                ${isActive
                  ? "text-[var(--color-accent-text)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                }
              `}
              aria-current={isActive ? "true" : undefined}
              aria-label={section.label}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-xs font-medium uppercase tracking-label-sm truncate max-w-[56px]">
                {section.id === "Arts & Entertainment" ? "Arts" : section.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-indicator"
                  className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-rule-accent)]"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}

        {/* Search link */}
        <Link
          href="/search"
          className={`
            relative flex flex-col items-center justify-center gap-1 py-2 px-2 sm:px-3 rounded-sm transition-colors min-w-[48px] sm:min-w-[60px]
            ${isSearchActive
              ? "text-[var(--color-accent-text)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }
          `}
          aria-label="Search the archive"
        >
          <Search size={20} strokeWidth={isSearchActive ? 2.5 : 2} />
          <span className="text-xs font-medium uppercase tracking-label-sm">
            Search
          </span>
          {isSearchActive && (
            <motion.div
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-rule-accent)]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </Link>

        {/* Ask the Archive link */}
        <Link
          href="/ask"
          className={`
            relative flex flex-col items-center justify-center gap-1 py-2 px-2 sm:px-3 rounded-sm transition-colors min-w-[48px] sm:min-w-[60px]
            ${isAskActive
              ? "text-[var(--color-accent-text)]"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }
          `}
          aria-label="Ask the archive"
        >
          <MessageCircleQuestion size={20} strokeWidth={isAskActive ? 2.5 : 2} />
          <span className="text-xs font-medium uppercase tracking-label-sm">
            Ask
          </span>
          {isAskActive && (
            <motion.div
              className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[var(--color-rule-accent)]"
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </Link>

        {/* More dropdown — shown on mobile when >3 sections, on sm+ when >5 sections */}
        {sections.length > 3 && (
          <div
            ref={moreRef}
            className={`relative ${sections.length > 5 ? "" : "sm:hidden"}`}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next && event.currentTarget.contains(next)) return;
              closeMore();
            }}
          >
            <button
              ref={moreButtonRef}
              onFocus={(event) => {
                if (
                  isMoreOpen &&
                  event.relatedTarget instanceof Node &&
                  moreMenuRef.current?.contains(event.relatedTarget)
                ) {
                  closeMore();
                }
              }}
              onClick={() => {
                if (isMoreOpen) closeMore();
                else openMore();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  openMore(event.key === "ArrowDown" ? "first" : "last");
                }
              }}
              className={`flex flex-col items-center justify-center gap-1 py-2 px-2 sm:px-3 rounded-sm min-w-[48px] sm:min-w-[60px] min-h-[56px] hover:text-[var(--color-text-primary)] transition-colors ${
                isMoreOpen
                  ? "text-[var(--color-accent-text)]"
                  : "text-[var(--color-text-secondary)]"
              }`}
              aria-label="More sections"
              aria-expanded={isMoreOpen}
              aria-haspopup="menu"
              aria-controls={isMoreOpen ? moreMenuId : undefined}
            >
              <div className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
                <span className="w-1 h-1 rounded-full bg-current" />
              </div>
              <span className="text-xs font-medium uppercase tracking-label-sm">
                More
              </span>
            </button>

            {/* Dropdown for additional sections */}
            <AnimatePresence>
              {isMoreOpen && (
                <motion.div
                  ref={moreMenuRef}
                  id={moreMenuId}
                  role="menu"
                  aria-label="More sections"
                  onKeyDown={handleMenuKeyDown}
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
                  transition={shouldReduceMotion ? { duration: 0 } : TRANSITIONS.micro}
                  className="absolute bottom-full right-0 mb-2 py-2 bg-[var(--color-bg-secondary)] rounded-sm shadow-xl border border-[var(--stroke-accent-soft)]"
                >
                  {sections.map((section, idx) => {
                    const Icon = SECTION_ICONS[section.id] || Newspaper;
                    const isActive = activeSection === section.id;
                    // On mobile (<sm), indices 3+ show here; on sm+, indices 5+ show here.
                    const classes =
                      idx >= 5
                        ? "flex"
                        : idx >= 3
                          ? "flex sm:hidden"
                          : "hidden";

                    return (
                      <button
                        key={section.id}
                        onClick={() => handleMoreSelect(section.id)}
                        role="menuitem"
                        tabIndex={-1}
                        aria-current={isActive ? "page" : undefined}
                        className={`
                          ${classes} items-center gap-3 w-full px-4 py-2.5 text-left transition-colors min-h-[44px]
                          ${isActive
                            ? "text-[var(--color-accent-text)] bg-[var(--color-accent)]/10"
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
