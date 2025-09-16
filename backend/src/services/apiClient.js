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