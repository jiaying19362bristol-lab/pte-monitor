# Local-first uploads and auto cloud sync

This enables **local-first storage for all task types**, then auto-syncs new files to Supabase.

## What it does

- On upload, the browser sends file to local server `http://localhost:18787/api/upload`
- The server saves files first to:
  - `local-uploads/RA/<questionId>/...`
  - `local-uploads/RS/<questionId>/...`
  - `local-uploads/DI/<questionId>/...`
  - ...and all other task types
- The same server then syncs new files to Supabase automatically.
- It also rescans every 30s, so manually copied files are also synced.

## 1) Configure server env

Create `.env` from `.env.example` and fill:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only key)
- `SUPABASE_BUCKET` (default `ra-audios`)

## 2) Start local upload server

In project root:

```bash
npm install
npm run start:local-upload
```

After startup, check:

- `http://localhost:18787/api/health`

## Important note

- Local folder saving works on the device that runs this server.
- If you upload from phone, it cannot write directly to your PC local folder unless your phone can access your PC server over LAN and firewall/network are configured.
