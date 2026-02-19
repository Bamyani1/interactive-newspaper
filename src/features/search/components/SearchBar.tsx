"use client";

import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  isLoading: boolean;
  autoFocus?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  isLoading,
  autoFocus = true,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="relative flex items-center">
      <Search
        className="absolute left-4 opacity-50"
        size={20}
        style={{ color: "var(--color-text-primary)" }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the archive..."
        className="w-full py-3 pl-12 pr-10 text-lg outline-none transition-colors focus-visible:ring-2"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          color: "var(--color-text-primary)",
          borderRadius: "4px",
          border: "1px solid var(--color-border-default)",
          fontFamily: "var(--font-body)",
        }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-3 opacity-50 hover:opacity-100 transition-opacity"
          aria-label="Clear search"
          style={{ color: "var(--color-text-primary)" }}
        >
          <X size={18} />
        </button>
      )}
      {isLoading && (
        <div
          className="absolute right-10 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
        />
      )}
    </div>
  );
};
