"use client";

import { useState } from "react";

interface SearchBarProps {
  initialQuery: string;
  onSearch: (query: string) => void;
}

export function SearchBar({ initialQuery, onSearch }: SearchBarProps) {
  const [value, setValue] = useState(initialQuery);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value.trim());
      }}
    >
      <label htmlFor="search-input" className="sr-only">
        Search articles
      </label>
      <input
        id="search-input"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search articles… (press /)"
        className="w-full max-w-sm rounded border border-border bg-surface px-2.5 py-1 text-sm text-foreground placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      />
    </form>
  );
}
