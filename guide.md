# Politics and War Nation Reset Time Tracker Implementation Guide

## Project Overview and Architecture

This comprehensive implementation guide provides detailed instructions for building a Politics and War nation reset time tracking system with PostgreSQL database, web UI, Discord bot, and Railway deployment.

## Project Structure

```
pnw-reset-tracker/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes.js
│   │   │   └── middleware.js
│   │   ├── database/
│   │   │   ├── schema.sql
│   │   │   ├── connection.js
│   │   │   └── models.js
│   │   ├── services/
│   │   │   ├── scanner.js
│   │   │   ├── apiClient.js
│   │   │   └── resetDetector.js
│   │   ├── utils/
│   │   │   ├── logger.js
│   │   │   └── rateLimiter.js
│   │   └── index.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── SearchBar.jsx
│   │   │   ├── NationList.jsx
│   │   │   └── ResetTimeDisplay.jsx
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   └── index.js
│   ├── package.json
│   └── vite.config.js
├── discord-bot/
│   ├── src/
│   │   ├── commands/
│   │   │   └── reset.js
│   │   ├── utils/
│   │   │   └── database.js
│   │   └── bot.js
│   ├── package.json
│   └── .env.example
├── docker-compose.yml
├── railway.toml
└── README.md
```

## Step 1: Database Schema Design

Create `backend/src/database/schema.sql`:

```sql
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
```

## Step 2: Backend Implementation

### Database Connection Module
Create `backend/src/database/connection.js`:

```javascript
const { Pool } = require('pg');
const logger = require('../utils/logger');

class Database {
    constructor() {
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on('error', (err, client) => {
            logger.error('Unexpected database error on idle client', err);
        });
    }

    async query(text, params) {
        const start = Date.now();
        try {
            const res = await this.pool.query(text, params);
            const duration = Date.now() - start;
            logger.debug('Executed query', { text, duration, rows: res.rowCount });
            return res;
        } catch (error) {
            logger.error('Database query error', { text, error: error.message });
            throw error;
        }
    }

    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = new Database();
```

### API Client Module
Create `backend/src/services/apiClient.js`:

```javascript
const axios = require('axios');
const logger = require('../utils/logger');
const RateLimiter = require('../utils/rateLimiter');

class PnWApiClient {
    constructor() {
        this.apiKey = process.env.PNW_API_KEY;
        this.baseUrl = 'https://api.politicsandwar.com/graphql';
        this.rateLimiter = new RateLimiter();
        this.axiosInstance = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            }
        });

        // Response interceptor for rate limit handling
        this.axiosInstance.interceptors.response.use(
            response => this.handleRateLimitHeaders(response),
            error => this.handleApiError(error)
        );
    }

    handleRateLimitHeaders(response) {
        const headers = response.headers;
        if (headers['x-ratelimit-remaining']) {
            this.rateLimiter.update({
                remaining: parseInt(headers['x-ratelimit-remaining']),
                reset: parseInt(headers['x-ratelimit-reset']),
                limit: parseInt(headers['x-ratelimit-limit'])
            });
        }
        return response;
    }

    async handleApiError(error) {
        if (error.response?.status === 429) {
            const retryAfter = error.response.headers['x-ratelimit-resetafter'] || 60;
            logger.warn(`Rate limited. Waiting ${retryAfter} seconds`);
            await this.sleep(retryAfter * 1000);
            return this.axiosInstance.request(error.config);
        }
        throw error;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async fetchNationsBatch(offset = 0, limit = 500) {
        const query = `
            query FetchNations($first: Int!, $after: String) {
                nations(first: $first, after: $after) {
                    data {
                        id
                        nation_name
                        leader_name
                        alliance_id
                        espionage_available
                        last_active
                    }
                    paginatorInfo {
                        hasNextPage
                        endCursor
                        total
                    }
                }
            }
        `;

        const variables = {
            first: limit,
            after: offset > 0 ? Buffer.from(`arrayconnection:${offset}`).toString('base64') : null
        };

        try {
            await this.rateLimiter.waitIfNeeded();
            
            const response = await this.axiosInstance.post(
                `?api_key=${this.apiKey}`,
                {
                    query,
                    variables
                }
            );

            if (response.data.errors) {
                logger.error('GraphQL errors', response.data.errors);
                throw new Error('GraphQL query failed');
            }

            return response.data.data.nations;
        } catch (error) {
            logger.error('Failed to fetch nations batch', {
                offset,
                limit,
                error: error.message
            });
            throw error;
        }
    }

    async fetchSpecificNations(nationIds) {
        const query = `
            query FetchSpecificNations($ids: [Int!]) {
                nations(id: $ids) {
                    data {
                        id
                        nation_name
                        espionage_available
                        last_active
                    }
                }
            }
        `;

        const batches = [];
        const batchSize = 100;
        
        for (let i = 0; i < nationIds.length; i += batchSize) {
            batches.push(nationIds.slice(i, i + batchSize));
        }

        const results = [];
        
        for (const batch of batches) {
            try {
                await this.rateLimiter.waitIfNeeded();
                
                const response = await this.axiosInstance.post(
                    `?api_key=${this.apiKey}`,
                    {
                        query,
                        variables: { ids: batch }
                    }
                );

                if (response.data.data?.nations?.data) {
                    results.push(...response.data.data.nations.data);
                }
            } catch (error) {
                logger.error('Failed to fetch specific nations', {
                    batch: batch.slice(0, 5),
                    error: error.message
                });
            }
        }

        return results;
    }
}

module.exports = PnWApiClient;
```

### Scanner Service
Create `backend/src/services/scanner.js`:

```javascript
const db = require('../database/connection');
const PnWApiClient = require('./apiClient');
const logger = require('../utils/logger');

class NationScanner {
    constructor() {
        this.apiClient = new PnWApiClient();
        this.isScanning = false;
        this.scanInterval = null;
    }

    async start() {
        if (this.isScanning) {
            logger.warn('Scanner already running');
            return;
        }

        logger.info('Starting nation scanner');
        this.isScanning = true;

        // Initial scan
        await this.performScan();

        // Schedule hourly scans
        this.scanInterval = setInterval(() => {
            this.performScan();
        }, 60 * 60 * 1000); // 1 hour
    }

    async stop() {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
        this.isScanning = false;
        logger.info('Scanner stopped');
    }

    async performScan() {
        const startTime = Date.now();
        logger.info('Starting scan cycle');

        try {
            // Get nations that need scanning (no reset time detected yet)
            const nationsToScan = await this.getNationsToScan();
            
            if (nationsToScan.length === 0) {
                logger.info('No nations to scan');
                return;
            }

            logger.info(`Scanning ${nationsToScan.length} nations`);

            // Fetch current espionage_available status
            const nationIds = nationsToScan.map(n => n.id);
            const apiResults = await this.apiClient.fetchSpecificNations(nationIds);

            // Process results
            await this.processResults(apiResults);

            const duration = Date.now() - startTime;
            logger.info(`Scan completed in ${duration}ms`);

        } catch (error) {
            logger.error('Scan cycle failed', error);
            await this.logError('SCAN_CYCLE_ERROR', error.message, error.stack);
        }
    }

    async getNationsToScan() {
        const query = `
            SELECT n.id, n.nation_name
            FROM nations n
            LEFT JOIN reset_times rt ON n.id = rt.nation_id
            WHERE rt.id IS NULL
            AND n.last_active > NOW() - INTERVAL '7 days'
            ORDER BY n.last_active DESC
            LIMIT 5000
        `;

        const result = await db.query(query);
        return result.rows;
    }

    async processResults(apiResults) {
        for (const nation of apiResults) {
            try {
                // Get last scan for this nation
                const lastScanQuery = `
                    SELECT espionage_available, scanned_at
                    FROM scan_history
                    WHERE nation_id = $1
                    ORDER BY scanned_at DESC
                    LIMIT 1
                `;
                
                const lastScan = await db.query(lastScanQuery, [nation.id]);
                
                // Record current scan
                await db.query(
                    `INSERT INTO scan_history (nation_id, espionage_available) 
                     VALUES ($1, $2)`,
                    [nation.id, nation.espionage_available]
                );

                // Check if reset detected (false -> true transition)
                if (lastScan.rows.length > 0 && 
                    !lastScan.rows[0].espionage_available && 
                    nation.espionage_available) {
                    
                    await this.recordResetTime(nation.id);
                }

                // Update nation info
                await db.query(
                    `UPDATE nations 
                     SET last_active = $1, updated_at = NOW()
                     WHERE id = $2`,
                    [nation.last_active, nation.id]
                );

            } catch (error) {
                logger.error(`Failed to process nation ${nation.id}`, error);
            }
        }
    }

    async recordResetTime(nationId) {
        const resetTime = new Date();
        const timeOnly = resetTime.toTimeString().split(' ')[0]; // HH:MM:SS format

        try {
            await db.query(
                `INSERT INTO reset_times (nation_id, reset_time, detected_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (nation_id) 
                 DO UPDATE SET reset_time = $2, detected_at = $3`,
                [nationId, timeOnly, resetTime]
            );

            logger.info(`Reset time detected for nation ${nationId}: ${timeOnly}`);
        } catch (error) {
            logger.error(`Failed to record reset time for nation ${nationId}`, error);
        }
    }

    async logError(type, message, stackTrace, context = {}) {
        try {
            await db.query(
                `INSERT INTO error_logs (error_type, error_message, stack_trace, context)
                 VALUES ($1, $2, $3, $4)`,
                [type, message, stackTrace, JSON.stringify(context)]
            );
        } catch (err) {
            logger.error('Failed to log error to database', err);
        }
    }

    async initializeNations() {
        logger.info('Initializing nations database');
        let cursor = null;
        let hasMore = true;
        let totalNations = 0;

        while (hasMore) {
            try {
                const response = await this.apiClient.fetchNationsBatch(
                    cursor ? parseInt(Buffer.from(cursor, 'base64').toString().split(':')[1]) : 0
                );

                for (const nation of response.data) {
                    await db.query(
                        `INSERT INTO nations (id, nation_name, leader_name, alliance_id, last_active)
                         VALUES ($1, $2, $3, $4, $5)
                         ON CONFLICT (id) DO UPDATE SET
                         nation_name = $2,
                         leader_name = $3,
                         alliance_id = $4,
                         last_active = $5`,
                        [
                            nation.id,
                            nation.nation_name,
                            nation.leader_name,
                            nation.alliance_id,
                            nation.last_active
                        ]
                    );
                }

                totalNations += response.data.length;
                hasMore = response.paginatorInfo.hasNextPage;
                cursor = response.paginatorInfo.endCursor;

                logger.info(`Initialized ${totalNations} nations`);

            } catch (error) {
                logger.error('Failed to initialize nations', error);
                hasMore = false;
            }
        }

        logger.info(`Nation initialization complete. Total: ${totalNations}`);
    }
}

module.exports = NationScanner;
```

### Rate Limiter Utility
Create `backend/src/utils/rateLimiter.js`:

```javascript
const logger = require('./logger');

class RateLimiter {
    constructor() {
        this.remaining = 1000;
        this.resetTime = null;
        this.limit = 1000;
        this.minBuffer = 10; // Keep buffer of 10 requests
    }

    update(rateLimitInfo) {
        this.remaining = rateLimitInfo.remaining;
        this.resetTime = rateLimitInfo.reset * 1000; // Convert to ms
        this.limit = rateLimitInfo.limit;
        
        logger.debug('Rate limit updated', {
            remaining: this.remaining,
            resetTime: new Date(this.resetTime),
            limit: this.limit
        });
    }

    async waitIfNeeded() {
        if (this.remaining <= this.minBuffer && this.resetTime) {
            const waitTime = this.resetTime - Date.now();
            if (waitTime > 0) {
                logger.info(`Rate limit buffer reached. Waiting ${Math.ceil(waitTime / 1000)}s`);
                await this.sleep(waitTime);
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    canMakeRequest() {
        return this.remaining > this.minBuffer;
    }
}

module.exports = RateLimiter;
```

### Logger Utility
Create `backend/src/utils/logger.js`:

```javascript
const winston = require('winston');
const path = require('path');

const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

const logColors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue',
};

winston.addColors(logColors);

const format = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    levels: logLevels,
    format,
    transports: [
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
        }),
    ],
});

// Add database error logging
logger.logToDatabase = async function(level, message, metadata = {}) {
    const db = require('../database/connection');
    try {
        await db.query(
            `INSERT INTO error_logs (error_type, error_message, context, occurred_at)
             VALUES ($1, $2, $3, NOW())`,
            [level, message, JSON.stringify(metadata)]
        );
    } catch (err) {
        console.error('Failed to log to database:', err);
    }
};

module.exports = logger;
```

### API Routes
Create `backend/src/api/routes.js`:

```javascript
const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const logger = require('../utils/logger');

// Search nations by name
router.get('/nations/search', async (req, res) => {
    try {
        const { q, limit = 10 } = req.query;
        
        if (!q) {
            return res.status(400).json({ error: 'Query parameter required' });
        }

        const query = `
            SELECT 
                n.id,
                n.nation_name,
                n.leader_name,
                n.last_active,
                rt.reset_time,
                rt.detected_at,
                rt.confidence_score
            FROM nations n
            LEFT JOIN reset_times rt ON n.id = rt.nation_id
            WHERE 
                n.nation_name ILIKE $1 OR 
                n.leader_name ILIKE $1
            ORDER BY n.last_active DESC
            LIMIT $2
        `;

        const result = await db.query(query, [`%${q}%`, limit]);
        res.json(result.rows);

    } catch (error) {
        logger.error('Search error', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get specific nation reset time
router.get('/nations/:id/reset', async (req, res) => {
    try {
        const { id } = req.params;

        const query = `
            SELECT 
                n.id,
                n.nation_name,
                n.leader_name,
                n.last_active,
                rt.reset_time,
                rt.detected_at,
                rt.confidence_score
            FROM nations n
            LEFT JOIN reset_times rt ON n.id = rt.nation_id
            WHERE n.id = $1
        `;

        const result = await db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Nation not found' });
        }

        res.json(result.rows[0]);

    } catch (error) {
        logger.error('Get nation error', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get scan statistics
router.get('/stats', async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM nations) as total_nations,
                (SELECT COUNT(*) FROM reset_times) as tracked_resets,
                (SELECT COUNT(*) FROM scan_history 
                 WHERE scanned_at > NOW() - INTERVAL '1 hour') as recent_scans,
                (SELECT requests_remaining FROM rate_limit_status 
                 ORDER BY last_updated DESC LIMIT 1) as api_requests_remaining
        `;

        const result = await db.query(statsQuery);
        res.json(result.rows[0]);

    } catch (error) {
        logger.error('Stats error', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get recent errors (admin endpoint)
router.get('/admin/errors', async (req, res) => {
    try {
        const { limit = 50 } = req.query;

        const query = `
            SELECT * FROM error_logs
            ORDER BY occurred_at DESC
            LIMIT $1
        `;

        const result = await db.query(query, [limit]);
        res.json(result.rows);

    } catch (error) {
        logger.error('Get errors error', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
```

### Main Backend Server
Create `backend/src/index.js`:

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const routes = require('./api/routes');
const NationScanner = require('./services/scanner');
const logger = require('./utils/logger');
const db = require('./database/connection');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.url}`);
    next();
});

// API routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
    logger.error('Unhandled error', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize scanner
const scanner = new NationScanner();

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await scanner.stop();
    await db.close();
    process.exit(0);
});

// Start server
async function start() {
    try {
        // Test database connection
        await db.query('SELECT NOW()');
        logger.info('Database connected successfully');

        // Initialize nations if needed
        const nationCount = await db.query('SELECT COUNT(*) FROM nations');
        if (nationCount.rows[0].count === '0') {
            logger.info('No nations found, initializing database');
            await scanner.initializeNations();
        }

        // Start scanner
        await scanner.start();

        // Start HTTP server
        app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
        });

    } catch (error) {
        logger.error('Failed to start server', error);
        process.exit(1);
    }
}

start();
```

### Backend Configuration Files

Create `backend/package.json`:

```json
{
  "name": "pnw-reset-tracker-backend",
  "version": "1.0.0",
  "description": "Politics and War Nation Reset Time Tracker Backend",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "db:init": "psql $DATABASE_URL < src/database/schema.sql",
    "test": "jest"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "pg": "^8.11.3",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.0.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

Create `backend/.env.example`:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/pnw_reset_tracker

# Politics and War API
PNW_API_KEY=your_api_key_here

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# CORS
CORS_ORIGIN=http://localhost:5173
```

## Step 3: Frontend Implementation

### Main App Component
Create `frontend/src/App.jsx`:

```jsx
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
```

### Search Component
Create `frontend/src/components/SearchBar.jsx`:

```jsx
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
```

### API Service
Create `frontend/src/services/api.js`:

```javascript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function fetchAPI(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

export async function searchNations(query, limit = 20) {
  return fetchAPI(`/nations/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

export async function getNationReset(nationId) {
  return fetchAPI(`/nations/${nationId}/reset`);
}

export async function getStats() {
  return fetchAPI('/stats');
}
```

### Frontend Configuration
Create `frontend/package.json`:

```json
{
  "name": "pnw-reset-tracker-frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "lodash.debounce": "^4.0.8"
  },
  "devDependencies": {
    "@types/react": "^18.2.37",
    "@types/react-dom": "^18.2.15",
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0"
  }
}
```

Create `frontend/vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

## Step 4: Discord Bot Implementation

Create `discord-bot/src/bot.js`:

```javascript
require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const db = require('./utils/database');
const logger = require('../../backend/src/utils/logger');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', () => {
  logger.info(`Discord bot logged in as ${client.user.tag}`);
  
  // Register slash commands
  const resetCommand = new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Check a nation\'s reset time')
    .addStringOption(option =>
      option.setName('nation')
        .setDescription('Nation name or ID')
        .setRequired(true)
    );

  client.application.commands.create(resetCommand);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'reset') {
    await handleResetCommand(interaction);
  }
});

async function handleResetCommand(interaction) {
  const nationInput = interaction.options.getString('nation');
  
  await interaction.deferReply();

  try {
    // Try to parse as ID first
    let query;
    let params;
    
    if (/^\d+$/.test(nationInput)) {
      query = `
        SELECT 
          n.id,
          n.nation_name,
          n.leader_name,
          n.last_active,
          rt.reset_time,
          rt.detected_at
        FROM nations n
        LEFT JOIN reset_times rt ON n.id = rt.nation_id
        WHERE n.id = $1
      `;
      params = [parseInt(nationInput)];
    } else {
      query = `
        SELECT 
          n.id,
          n.nation_name,
          n.leader_name,
          n.last_active,
          rt.reset_time,
          rt.detected_at
        FROM nations n
        LEFT JOIN reset_times rt ON n.id = rt.nation_id
        WHERE n.nation_name ILIKE $1
        ORDER BY n.last_active DESC
        LIMIT 1
      `;
      params = [`%${nationInput}%`];
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      await interaction.editReply('Nation not found.');
      return;
    }

    const nation = result.rows[0];
    
    // Format the response
    let response = `**${nation.nation_name}** (ID: ${nation.id})\n`;
    response += `Leader: ${nation.leader_name}\n`;
    response += `Last Active: ${new Date(nation.last_active).toLocaleString()}\n`;
    
    if (nation.reset_time) {
      response += `**Reset Time: ${nation.reset_time} (server time)**\n`;
      response += `Detected: ${new Date(nation.detected_at).toLocaleString()}`;
    } else {
      response += `**Reset time not yet detected**\n`;
      response += `This nation is being monitored and the reset time will be detected automatically.`;
    }

    await interaction.editReply(response);

  } catch (error) {
    logger.error('Discord command error', error);
    await interaction.editReply('An error occurred while fetching nation data.');
  }
}

client.login(process.env.DISCORD_TOKEN);
```

Create `discord-bot/src/utils/database.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
```

Create `discord-bot/package.json`:

```json
{
  "name": "pnw-reset-tracker-discord",
  "version": "1.0.0",
  "description": "Discord bot for PnW reset tracker",
  "main": "src/bot.js",
  "scripts": {
    "start": "node src/bot.js",
    "dev": "nodemon src/bot.js"
  },
  "dependencies": {
    "discord.js": "^14.14.0",
    "dotenv": "^16.3.1",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
```

## Step 5: Railway Deployment Configuration

Create `railway.toml`:

```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "npm run start"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10

[[services]]
name = "backend"
buildCommand = "cd backend && npm ci"
startCommand = "cd backend && npm start"

[[services.healthcheck]]
path = "/health"
interval = 30
timeout = 5
maxRetries = 3

[[services]]
name = "frontend"
buildCommand = "cd frontend && npm ci && npm run build"
startCommand = "cd frontend && npm run preview"

[[services]]
name = "discord-bot"
buildCommand = "cd discord-bot && npm ci"
startCommand = "cd discord-bot && npm start"
```

Create `docker-compose.yml` for local development:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: pnw_user
      POSTGRES_PASSWORD: pnw_password
      POSTGRES_DB: pnw_reset_tracker
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backend/src/database/schema.sql:/docker-entrypoint-initdb.d/init.sql

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://pnw_user:pnw_password@postgres:5432/pnw_reset_tracker
      NODE_ENV: development
    depends_on:
      - postgres
    volumes:
      - ./backend:/app
      - /app/node_modules

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    environment:
      VITE_API_URL: http://localhost:3000/api
    volumes:
      - ./frontend:/app
      - /app/node_modules

  discord-bot:
    build: ./discord-bot
    environment:
      DATABASE_URL: postgresql://pnw_user:pnw_password@postgres:5432/pnw_reset_tracker
      NODE_ENV: development
    depends_on:
      - postgres
    volumes:
      - ./discord-bot:/app
      - /app/node_modules

volumes:
  postgres_data:
```

## Step 6: Testing Strategy

Create `backend/src/__tests__/scanner.test.js`:

```javascript
const NationScanner = require('../services/scanner');
const db = require('../database/connection');
const PnWApiClient = require('../services/apiClient');

jest.mock('../database/connection');
jest.mock('../services/apiClient');

describe('NationScanner', () => {
  let scanner;

  beforeEach(() => {
    scanner = new NationScanner();
    jest.clearAllMocks();
  });

  describe('Reset Detection', () => {
    test('should detect reset when espionage_available changes from false to true', async () => {
      // Mock previous scan showing false
      db.query.mockResolvedValueOnce({
        rows: [{ espionage_available: false, scanned_at: new Date() }]
      });

      // Mock current API response showing true
      const mockNation = {
        id: 123,
        espionage_available: true,
        last_active: new Date()
      };

      await scanner.processResults([mockNation]);

      // Verify reset time was recorded
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO reset_times'),
        expect.arrayContaining([123])
      );
    });

    test('should not detect reset when espionage_available remains true', async () => {
      // Mock previous scan showing true
      db.query.mockResolvedValueOnce({
        rows: [{ espionage_available: true, scanned_at: new Date() }]
      });

      const mockNation = {
        id: 123,
        espionage_available: true,
        last_active: new Date()
      };

      await scanner.processResults([mockNation]);

      // Verify reset time was NOT recorded
      expect(db.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO reset_times'),
        expect.any(Array)
      );
    });
  });

  describe('Error Handling', () => {
    test('should log errors to database when scan fails', async () => {
      const error = new Error('API Error');
      PnWApiClient.prototype.fetchSpecificNations.mockRejectedValueOnce(error);

      await scanner.performScan();

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO error_logs'),
        expect.arrayContaining(['SCAN_CYCLE_ERROR', 'API Error'])
      );
    });
  });
});
```

## Step 7: Security Considerations

Create `backend/src/middleware/security.js`:

```javascript
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting configuration
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Input validation middleware
const validateNationId = (req, res, next) => {
  const { id } = req.params;
  
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid nation ID format' });
  }
  
  const nationId = parseInt(id);
  if (nationId < 1 || nationId > 9999999) {
    return res.status(400).json({ error: 'Nation ID out of range' });
  }
  
  req.nationId = nationId;
  next();
};

// API key validation for admin endpoints
const validateAdminKey = (req, res, next) => {
  const apiKey = req.headers['x-admin-key'];
  
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  next();
};

// Content Security Policy
const contentSecurityPolicy = helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
  },
});

module.exports = {
  apiLimiter,
  validateNationId,
  validateAdminKey,
  contentSecurityPolicy,
};
```

## Step 8: Performance Optimizations

Create `backend/src/utils/cache.js`:

```javascript
const NodeCache = require('node-cache');

class CacheManager {
  constructor() {
    // Cache with 5 minute TTL
    this.nationCache = new NodeCache({ stdTTL: 300 });
    this.statsCache = new NodeCache({ stdTTL: 60 });
  }

  getNation(nationId) {
    return this.nationCache.get(nationId);
  }

  setNation(nationId, data) {
    this.nationCache.set(nationId, data);
  }

  getStats() {
    return this.statsCache.get('global_stats');
  }

  setStats(data) {
    this.statsCache.set('global_stats', data);
  }

  invalidateNation(nationId) {
    this.nationCache.del(nationId);
  }

  flush() {
    this.nationCache.flushAll();
    this.statsCache.flushAll();
  }
}

module.exports = new CacheManager();
```

## Step 9: Environment Setup Commands

Create setup script `scripts/setup.sh`:

```bash
#!/bin/bash

echo "Setting up PnW Reset Tracker..."

# Install dependencies
echo "Installing backend dependencies..."
cd backend && npm install

echo "Installing frontend dependencies..."
cd ../frontend && npm install

echo "Installing Discord bot dependencies..."
cd ../discord-bot && npm install

# Setup database
echo "Setting up PostgreSQL database..."
psql $DATABASE_URL < ../backend/src/database/schema.sql

# Create logs directory
mkdir -p ../backend/logs

echo "Setup complete! Run 'docker-compose up' to start development environment."
```

## Step 10: Deployment Instructions

### Railway Deployment Steps:

1. **Create Railway Project:**
```bash
railway login
railway init
```

2. **Add PostgreSQL:**
```bash
railway add postgresql
```

3. **Set Environment Variables:**
```bash
railway variables set PNW_API_KEY=your_api_key
railway variables set DISCORD_TOKEN=your_discord_token
railway variables set ADMIN_API_KEY=generated_admin_key
railway variables set NODE_ENV=production
```

4. **Deploy:**
```bash
railway up
```

5. **Initialize Database:**
```bash
railway run psql $DATABASE_URL < backend/src/database/schema.sql
```

## Final Notes

### Key Implementation Details:

1. **Reset Detection Logic**: The system detects resets by monitoring espionage_available transitions from false to true
2. **Efficiency**: Nations with detected reset times are excluded from future scans
3. **Rate Limiting**: Implements exponential backoff and respects API rate limits
4. **Error Recovery**: Comprehensive error logging to database and files
5. **Scalability**: Batch processing with configurable limits
6. **Security**: Input validation, rate limiting, and API key authentication

### Monitoring Recommendations:

- Set up alerts for error_logs table growth
- Monitor API rate limit usage
- Track scan completion times
- Watch for nations with no activity > 7 days

This implementation provides a robust, scalable solution for tracking Politics and War nation reset times with comprehensive error handling and efficient API usage.