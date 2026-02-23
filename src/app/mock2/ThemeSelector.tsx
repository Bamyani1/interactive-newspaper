"use client";

import React, { useEffect, useRef, useState } from "react";
import { Palette } from "lucide-react";
import { THEMES, type CanopyTheme } from "./themes";

interface ThemeSelectorProps {
  activeThemeId: string;
  onThemeChange: (theme: CanopyTheme) => void;
}

export function ThemeSelector({ activeThemeId, onThemeChange }: ThemeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close strip on outside click
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
  }, [isOpen]);

  return (
    <div className="canopy-theme-selector" ref={containerRef}>
      <div className={`canopy-theme-strip ${isOpen ? "canopy-theme-strip--open" : ""}`}>
        {THEMES.map((theme) => (
          <button
            key={theme.id}
            className={`canopy-theme-swatch ${theme.id === activeThemeId ? "canopy-theme-swatch--active" : ""}`}
            style={{ background: theme.dominantColor }}
            title={theme.name}
            onClick={() => {
              onThemeChange(theme);
              setIsOpen(false);
            }}
            aria-label={theme.name}
          />
        ))}
      </div>
      <button
        className="canopy-theme-trigger"
        onClick={() => setIsOpen((o) => !o)}
        aria-label="Choose visual theme"
      >
        <Palette size={18} />
      </button>
    </div>
  );
}
