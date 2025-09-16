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