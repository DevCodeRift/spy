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