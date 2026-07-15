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

export const SearchFilters: React.FC<SearchFiltersProps> = ({
  category,
  onCategoryChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}) => {
  return (
    <fieldset className="flex flex-wrap items-center gap-3">
      <legend className="sr-only">Filter archive search results</legend>
      <div>
        <label htmlFor="search-category" className="sr-only">
          Category
        </label>
        <select
          id="search-category"
          value={category}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="search-filter-control"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="search-start-date" className="sr-only">
          From date
        </label>
        <input
          id="search-start-date"
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="search-filter-control"
        />
      </div>

      <div>
        <label htmlFor="search-end-date" className="sr-only">
          To date
        </label>
        <input
          id="search-end-date"
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="search-filter-control"
        />
      </div>
    </fieldset>
  );
};
