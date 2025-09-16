FROM node:18-alpine

WORKDIR /app

# Copy all package.json files first for better caching
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY discord-bot/package*.json ./discord-bot/
COPY package.json ./

# Install all dependencies
RUN cd backend && npm ci --only=production
RUN cd frontend && npm ci
RUN cd discord-bot && npm ci --only=production

# Copy all source code
COPY . .

# Build frontend
RUN cd frontend && npm run build

# Create logs directory
RUN mkdir -p backend/logs

# Expose port for backend
EXPOSE 3000

# Create startup script
RUN echo '#!/bin/sh' > start.sh && \
    echo 'cd /app/backend && node src/index.js &' >> start.sh && \
    echo 'cd /app/discord-bot && node src/bot.js &' >> start.sh && \
    echo 'cd /app/frontend && npm run preview &' >> start.sh && \
    echo 'wait' >> start.sh && \
    chmod +x start.sh

CMD ["./start.sh"]