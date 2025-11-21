# NotionBI Sync & Webhook Service

This is a separate Next.js application that handles all sync and webhook functionality for NotionBI. It has been separated from the main dashboard application to keep concerns separated.

## Features

- **Sync Service**: Syncs data from Notion (Projects, Team Members, Clients, QI Time Tracker)
- **Time Doctor Sync**: Syncs Time Doctor data (Users, Projects, Worklogs)
- **Webhook Handler**: Receives and processes webhooks from Notion
- **Daily Sync**: Automated daily sync endpoint for cron jobs
- **Health Check**: System health and sync status endpoint

## Setup

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. Create `.env.local` file with the following variables:
```
MONGODB_URI=your_mongodb_connection_string
NOTION_API_KEY=your_notion_api_key
NOTION_PROJECTS_DB_ID=your_projects_database_id
NOTION_TEAM_MEMBERS_DB_ID=your_team_members_database_id
TIMEDOCTOR_API_TOKEN=your_timedoctor_api_token (optional)
TIMEDOCTOR_COMPANY_ID=your_timedoctor_company_id (optional)
SYNC_SECRET=your_secret_for_daily_sync_auth (optional)
```

3. Run the development server:
```bash
npm run dev
# or
yarn dev
```

4. Open [http://localhost:3000](http://localhost:3000) to view the sync dashboard.

## API Endpoints

### Sync Endpoints

- `POST /api/sync` - Manual sync (supports `type`, `client_id`, `limit` parameters)
- `GET /api/sync` - Get last sync status
- `POST /api/sync/daily` - Daily automated sync (requires `SYNC_SECRET` if set)
- `POST /api/timedoctor/sync` - Sync Time Doctor data

### Webhook Endpoints

- `POST /api/webhooks/notion` - Notion webhook handler
- `GET /api/webhooks/notion` - Webhook endpoint status

### Health Endpoints

- `GET /api/health` - System health and sync status

## Deployment

This application can be deployed separately from the main dashboard application. Make sure to:

1. Set all required environment variables in your deployment platform
2. Configure webhook URLs in Notion to point to this application's URL
3. Set up cron jobs to call `/api/sync/daily` endpoint

## Notes

- This application shares the same MongoDB database as the main dashboard application
- All sync operations update the same database collections
- The webhook endpoint should be configured in Notion to point to this application's URL

