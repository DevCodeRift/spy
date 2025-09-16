const db = require('./connection');
const logger = require('../utils/logger');

const migrations = [
  `-- Nations table to store basic nation info
  CREATE TABLE IF NOT EXISTS nations (
      id INTEGER PRIMARY KEY,
      nation_name VARCHAR(255),
      leader_name VARCHAR(255),
      alliance_id INTEGER,
      last_active TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `-- Reset times table to track detected reset times
  CREATE TABLE IF NOT EXISTS reset_times (
      id SERIAL PRIMARY KEY,
      nation_id INTEGER NOT NULL,
      reset_time TIME NOT NULL,
      detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      confidence_score DECIMAL(3,2) DEFAULT 1.00,
      FOREIGN KEY (nation_id) REFERENCES nations(id),
      UNIQUE(nation_id)
  )`,

  `-- Scan history table for tracking espionage_available changes
  CREATE TABLE IF NOT EXISTS scan_history (
      id SERIAL PRIMARY KEY,
      nation_id INTEGER NOT NULL,
      espionage_available BOOLEAN NOT NULL,
      scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (nation_id) REFERENCES nations(id)
  )`,

  `-- Error logs table for debugging
  CREATE TABLE IF NOT EXISTS error_logs (
      id SERIAL PRIMARY KEY,
      error_type VARCHAR(100),
      error_message TEXT,
      stack_trace TEXT,
      context JSONB,
      occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `-- API rate limit tracking
  CREATE TABLE IF NOT EXISTS rate_limit_status (
      id SERIAL PRIMARY KEY,
      requests_remaining INTEGER,
      reset_time TIMESTAMP,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  `-- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_nations_last_active ON nations(last_active)`,

  `CREATE INDEX IF NOT EXISTS idx_reset_times_nation_id ON reset_times(nation_id)`,

  `CREATE INDEX IF NOT EXISTS idx_scan_history_nation_scanned ON scan_history(nation_id, scanned_at)`,

  `CREATE INDEX IF NOT EXISTS idx_error_logs_occurred_at ON error_logs(occurred_at)`,

  `-- Function to update updated_at timestamp
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
  END;
  $$ language 'plpgsql'`,

  `-- Trigger for nations table
  DROP TRIGGER IF EXISTS update_nations_updated_at ON nations`,

  `CREATE TRIGGER update_nations_updated_at BEFORE UPDATE
  ON nations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`
];

async function runMigrations() {
  logger.info('Running database migrations...');

  try {
    for (let i = 0; i < migrations.length; i++) {
      const migration = migrations[i];
      logger.debug(`Running migration ${i + 1}/${migrations.length}`);
      await db.query(migration);
    }

    logger.info('Database migrations completed successfully');
    return true;
  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    throw error;
  }
}

module.exports = { runMigrations };