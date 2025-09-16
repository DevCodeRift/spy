import React from 'react';
import './ResetTimeDisplay.css';

function ResetTimeDisplay({ nation }) {
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const calculateTimeUntilReset = (resetTime) => {
    if (!resetTime) return null;

    const now = new Date();
    const [hours, minutes, seconds] = resetTime.split(':').map(Number);

    // Create reset time for today
    const resetToday = new Date();
    resetToday.setHours(hours, minutes, seconds, 0);

    // If reset time has passed today, calculate for tomorrow
    let targetReset = resetToday;
    if (now > resetToday) {
      targetReset = new Date(resetToday);
      targetReset.setDate(targetReset.getDate() + 1);
    }

    const timeDiff = targetReset - now;
    const hoursLeft = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutesLeft = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

    return `${hoursLeft}h ${minutesLeft}m`;
  };

  const timeUntilReset = calculateTimeUntilReset(nation.reset_time);

  return (
    <div className="reset-time-display">
      <h2>Nation Details</h2>
      <div className="nation-info">
        <h3>{nation.nation_name}</h3>
        <p><strong>Leader:</strong> {nation.leader_name}</p>
        <p><strong>Nation ID:</strong> #{nation.id}</p>
        <p><strong>Last Active:</strong> {formatDate(nation.last_active)}</p>
      </div>

      <div className="reset-info">
        {nation.reset_time ? (
          <>
            <div className="reset-time-section">
              <h4>Reset Time</h4>
              <div className="time-display">
                <span className="reset-time">{nation.reset_time}</span>
                <span className="timezone">(Server Time)</span>
              </div>
            </div>

            {timeUntilReset && (
              <div className="countdown-section">
                <h4>Time Until Next Reset</h4>
                <div className="countdown">
                  {timeUntilReset}
                </div>
              </div>
            )}

            <div className="detection-info">
              <p><strong>Detected:</strong> {formatDate(nation.detected_at)}</p>
              {nation.confidence_score && (
                <p><strong>Confidence:</strong> {(nation.confidence_score * 100).toFixed(0)}%</p>
              )}
            </div>
          </>
        ) : (
          <div className="no-reset-info">
            <h4>Reset Time Not Detected</h4>
            <p>This nation is being monitored and the reset time will be detected automatically when the espionage becomes available.</p>
            <div className="monitoring-status">
              <span className="status-indicator"></span>
              <span>Monitoring Active</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ResetTimeDisplay;