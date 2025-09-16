# Politics and War Nation Reset Time Tracker

A comprehensive system for tracking Politics and War nation reset times using espionage availability monitoring.

## Features

- **Automated Reset Detection**: Monitors espionage_available field changes to detect nation reset times
- **Web Interface**: Search and view nation reset times with a modern React frontend
- **Discord Bot**: Query reset times directly from Discord using slash commands
- **PostgreSQL Database**: Robust data storage with comprehensive logging
- **Rate Limiting**: Respects Politics and War API rate limits
- **Real-time Monitoring**: Continuous scanning with efficient batch processing

## Project Structure

```
pnw-reset-tracker/
├── backend/                 # Node.js Express API server
│   ├── src/
│   │   ├── api/            # API routes and middleware
│   │   ├── database/       # Database schema and connection
│   │   ├── services/       # Core business logic
│   │   └── utils/          # Utilities and helpers
│   ├── package.json
│   └── Dockerfile
├── frontend/               # React web application
│   ├── src/
│   │   ├── components/     # React components
│   │   └── services/       # API client
│   ├── package.json
│   └── Dockerfile
├── discord-bot/           # Discord bot
│   ├── src/
│   │   ├── commands/      # Discord slash commands
│   │   └── utils/         # Bot utilities
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml     # Local development environment
└── railway.toml          # Railway deployment configuration
```

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Politics and War API key
- Discord bot token (optional)

### Local Development

1. **Clone and setup**:
   ```bash
   git clone <repository>
   cd pnw-reset-tracker
   ```

2. **Database setup**:
   ```bash
   # Start PostgreSQL with Docker
   docker-compose up postgres -d

   # Initialize database schema
   psql postgresql://pnw_user:pnw_password@localhost:5432/pnw_reset_tracker < backend/src/database/schema.sql
   ```

3. **Backend setup**:
   ```bash
   cd backend
   cp .env.example .env
   # Edit .env with your API keys
   npm install
   npm run dev
   ```

4. **Frontend setup**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

5. **Discord Bot setup** (optional):
   ```bash
   cd discord-bot
   cp .env.example .env
   # Add Discord bot token to .env
   npm install
   npm run dev
   ```

### Using Docker Compose

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Environment Variables

### Backend (.env)
```env
DATABASE_URL=postgresql://user:password@localhost:5432/pnw_reset_tracker
PNW_API_KEY=your_politics_and_war_api_key
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
```

### Discord Bot (.env)
```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://user:password@localhost:5432/pnw_reset_tracker
NODE_ENV=development
```

## API Endpoints

- `GET /api/nations/search?q=nation_name` - Search for nations
- `GET /api/nations/:id/reset` - Get specific nation reset time
- `GET /api/stats` - Get system statistics
- `GET /api/admin/errors` - Get recent errors (admin only)
- `GET /health` - Health check endpoint

## Discord Commands

- `/reset <nation_name_or_id>` - Check a nation's reset time

## How It Works

1. **Data Collection**: The scanner fetches nation data from the Politics and War GraphQL API
2. **Reset Detection**: Monitors the `espionage_available` field for false→true transitions
3. **Time Recording**: When a reset is detected, the current server time is recorded
4. **Continuous Monitoring**: Nations without detected reset times are continuously monitored
5. **Rate Limiting**: Respects API rate limits with intelligent backoff

## Deployment

### Railway (Recommended)

1. **Create Railway project**:
   ```bash
   railway login
   railway init
   ```

2. **Add PostgreSQL**:
   ```bash
   railway add postgresql
   ```

3. **Set environment variables**:
   ```bash
   railway variables set PNW_API_KEY=your_api_key
   railway variables set DISCORD_TOKEN=your_discord_token
   railway variables set NODE_ENV=production
   ```

4. **Deploy**:
   ```bash
   railway up
   ```

5. **Initialize database**:
   ```bash
   railway run psql $DATABASE_URL < backend/src/database/schema.sql
   ```

### Other Platforms

The application can be deployed on any platform supporting Docker containers:
- Heroku
- DigitalOcean App Platform
- AWS ECS
- Google Cloud Run

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issues tracker.

## Security

- Never commit API keys or tokens
- Use environment variables for sensitive data
- Regularly update dependencies
- Follow security best practices for web applications