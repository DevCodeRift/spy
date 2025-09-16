import React, { useState, useCallback } from 'react';
import debounce from 'lodash.debounce';
import './SearchBar.css';

function SearchBar({ onSearch }) {
  const [query, setQuery] = useState('');

  const debouncedSearch = useCallback(
    debounce((q) => onSearch(q), 300),
    []
  );

  const handleChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    debouncedSearch(value);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Search by nation or leader name..."
        value={query}
        onChange={handleChange}
        className="search-input"
      />
      <button type="submit" className="search-button">
        Search
      </button>
    </form>
  );
}

export default SearchBar;