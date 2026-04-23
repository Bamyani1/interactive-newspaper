"use client";

import React from "react";

const CATEGORIES = ["Campus News", "News", "Sports", "Opinion", "Arts & Entertainment"] as const;

interface SearchFiltersProps {
  category: string;
  onCategoryChange: (category: string) => void;
  startDate: string;
  onStartDateChange: (date: string) => void;
  endDate: string;
  onEndDateChange: (date: string) => void;
}

const selectStyle: React.CSSProperties = {
  backgroundColor: "var(--color-bg-secondary)",
  color: "var(--color-text-primary)",
  border: "1px solid var(--color-border-default)",
  borderRadius: "4px",
  fontFamily: "var(--font-body)",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  colorScheme: "dark",
};

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  category,
  onCategoryChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="px-3 py-2 text-base"
        style={selectStyle}
      >
        <option value="">All Categories</option>
        {CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={startDate}
        onChange={(e) => onStartDateChange(e.target.value)}
        placeholder="From date"
        className="px-3 py-2 text-base"
        style={inputStyle}
      />

      <input
        type="date"
        value={endDate}
        onChange={(e) => onEndDateChange(e.target.value)}
        placeholder="To date"
        className="px-3 py-2 text-base"
        style={inputStyle}
      />
    </div>
  );
};
