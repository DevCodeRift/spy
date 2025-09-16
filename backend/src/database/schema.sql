-- Create database
CREATE DATABASE IF NOT EXISTS pnw_reset_tracker;

-- Nations table to store basic nation info
CREATE TABLE nations (
    id INTEGER PRIMARY KEY,
    nation_name VARCHAR(255),
    leader_name VARCHAR(255),
    alliance_id INTEGER,
    last_active TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reset times table to track detected reset times
CREATE TABLE reset_times (
    id SERIAL PRIMARY KEY,
    nation_id INTEGER NOT NULL,
    reset_time TIME NOT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confidence_score DECIMAL(3,2) DEFAULT 1.00,
    FOREIGN KEY (nation_id) REFERENCES nations(id),
    UNIQUE(nation_id)
);

-- Scan history table for tracking espionage_available changes
CREATE TABLE scan_history (
    id SERIAL PRIMARY KEY,
    nation_id INTEGER NOT NULL,
    espionage_available BOOLEAN NOT NULL,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (nation_id) REFERENCES nations(id)
);

-- Error logs table for debugging
CREATE TABLE error_logs (
    id SERIAL PRIMARY KEY,
    error_type VARCHAR(100),
    error_message TEXT,
    stack_trace TEXT,
    context JSONB,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API rate limit tracking
CREATE TABLE rate_limit_status (
    id SERIAL PRIMARY KEY,
    requests_remaining INTEGER,
    reset_time TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_nations_last_active ON nations(last_active);
CREATE INDEX idx_reset_times_nation_id ON reset_times(nation_id);
CREATE INDEX idx_scan_history_nation_scanned ON scan_history(nation_id, scanned_at);
CREATE INDEX idx_error_logs_occurred_at ON error_logs(occurred_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for nations table
CREATE TRIGGER update_nations_updated_at BEFORE UPDATE
ON nations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();