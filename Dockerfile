FROM node:18-alpine

WORKDIR /app

# Copy all package.json files first for better caching
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/
COPY discord-bot/package*.json ./discord-bot/
COPY package.json ./

# Install root dependencies first
RUN npm install

# Install all service dependencies
RUN cd backend && npm install --only=production
RUN cd frontend && npm install
RUN cd discord-bot && npm install --only=production

# Copy all source code
COPY . .

# Build frontend
RUN cd frontend && npm run build

# Create logs directory
RUN mkdir -p backend/logs

# Expose port for backend
EXPOSE 3000

# Use the npm start script which handles concurrency properly
CMD ["npm", "start"]