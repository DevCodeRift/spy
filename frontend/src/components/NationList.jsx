import React from 'react';
import './NationList.css';

function NationList({ nations, onSelect, selectedNation }) {
  const formatLastActive = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  return (
    <div className="nation-list">
      <h2>Search Results</h2>
      {nations.length === 0 ? (
        <p className="no-results">No nations found. Try searching for a nation or leader name.</p>
      ) : (
        <div className="nations">
          {nations.map((nation) => (
            <div
              key={nation.id}
              className={`nation-item ${selectedNation?.id === nation.id ? 'selected' : ''}`}
              onClick={() => onSelect(nation)}
            >
              <div className="nation-header">
                <h3>{nation.nation_name}</h3>
                <span className="nation-id">#{nation.id}</span>
              </div>
              <div className="nation-details">
                <p><strong>Leader:</strong> {nation.leader_name}</p>
                <p><strong>Last Active:</strong> {formatLastActive(nation.last_active)}</p>
                {nation.reset_time ? (
                  <p className="reset-time">
                    <strong>Reset Time:</strong>
                    <span className="time">{nation.reset_time}</span>
                  </p>
                ) : (
                  <p className="no-reset">Reset time not detected</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NationList;