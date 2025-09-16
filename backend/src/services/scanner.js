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