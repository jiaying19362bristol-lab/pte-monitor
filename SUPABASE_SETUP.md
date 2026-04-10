# Supabase setup (cross-device sync)

This project now stores RA audio and comments in Supabase so student and teacher can see the same data on different devices.

## 1) Create Supabase project

1. Open [https://supabase.com](https://supabase.com)
2. Create a new project
3. In project settings, copy:
   - Project URL
   - `anon` public key

## 2) Create storage bucket

In Supabase dashboard:

1. Go to `Storage`
2. Create bucket named `ra-audios`
3. Set it to `Public` (for direct audio playback by URL)

## 3) Create tables (SQL editor)

Run this SQL:

```sql
create table if not exists public.ra_recordings (
  id uuid primary key default gen_random_uuid(),
  question_id text not null,
  file_name text not null,
  file_path text not null unique,
  public_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ra_comments (
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.ra_recordings(id) on delete cascade,
  author text not null,
  content text not null,
  created_at timestamptz not null default now()
);
```

## 4) Disable RLS for quick demo

For fast setup, open each table in table editor and disable RLS.

If you want safer production setup later, enable RLS and add policies.

## 5) Fill config

Edit `supabase-config.js`:

```js
window.SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_ID.supabase.co",
  anonKey: "YOUR_ANON_KEY",
  bucket: "ra-audios"
};
```

## 6) Push and refresh site

Commit and push to GitHub. Refresh GitHub Pages site and test:

- Upload audio on one device
- Open same question on another device
- Audio and comments should be shared
