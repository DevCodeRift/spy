import React, { useState, useEffect } from 'react';
import SearchBar from './components/SearchBar';
import NationList from './components/NationList';
import ResetTimeDisplay from './components/ResetTimeDisplay';
import { searchNations, getNationReset, getStats } from './services/api';
import './App.css';

function App() {
  const [nations, setNations] = useState([]);
  const [selectedNation, setSelectedNation] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Update stats every minute
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const data = await getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const handleSearch = async (query) => {
    if (!query) {
      setNations([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await searchNations(query);
      setNations(results);
    } catch (err) {
      setError('Failed to search nations');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleNationSelect = async (nation) => {
    setSelectedNation(nation);
    if (!nation.reset_time) {
      try {
        const details = await getNationReset(nation.id);
        setSelectedNation(details);
      } catch (err) {
        console.error('Failed to fetch nation details:', err);
      }
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Politics and War Reset Time Tracker</h1>
        {stats && (
          <div className="stats">
            <span>Total Nations: {stats.total_nations}</span>
            <span>Tracked Resets: {stats.tracked_resets}</span>
            <span>Recent Scans: {stats.recent_scans}</span>
          </div>
        )}
      </header>

      <main className="app-main">
        <SearchBar onSearch={handleSearch} />

        {error && <div className="error">{error}</div>}

        {loading && <div className="loading">Searching...</div>}

        <div className="content">
          <NationList
            nations={nations}
            onSelect={handleNationSelect}
            selectedNation={selectedNation}
          />

          {selectedNation && (
            <ResetTimeDisplay nation={selectedNation} />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;