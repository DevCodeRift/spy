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