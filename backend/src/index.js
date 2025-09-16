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