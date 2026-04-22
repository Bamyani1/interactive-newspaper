"use client";

import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/shared/ui/primitives";

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
        className="absolute left-4 opacity-50 text-[var(--color-text-body)] pointer-events-none"
        size={20}
      />
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search the archive..."
        className="pl-12 pr-10 text-lg"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 opacity-50 hover:opacity-100 transition-opacity text-[var(--color-text-body)] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)] rounded-sm"
          aria-label="Clear search"
        >
          <X size={18} />
        </button>
      )}
      {isLoading && (
        <div
          className="absolute right-10 h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
        />
      )}
    </div>
  );
};
