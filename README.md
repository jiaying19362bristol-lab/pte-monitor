# PTE Monitor

This project is a static frontend plus an optional local upload server.

For visitor links to work on phones from any network environment, the frontend must be deployed to a public URL such as GitHub Pages. Local addresses like `localhost` or `192.168.x.x` are not enough.

## GitHub Pages

1. Push this project to a GitHub repository.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, choose:
   - `Source`: `Deploy from a branch`
   - `Branch`: `main` or your default branch
   - `Folder`: `/ (root)`
4. Save and wait for GitHub Pages to publish.
5. Open the published URL, for example:
   - `https://<your-user>.github.io/<repo-name>/`
6. Enter the RA page from that deployed site and generate the visitor link there.

The generated visitor link will then use the public GitHub Pages URL automatically.

## Supabase Setup

The deployed visitor page uses cloud mode by default.

Before using visitor comments in cloud mode, apply:

- [supabase-ra-comments-owner-token.sql](./supabase-ra-comments-owner-token.sql)

Run that SQL in the Supabase SQL editor for your project.

This adds `owner_token` to `ra_comments` so a visitor can only delete comments from the same device/browser token.

## Local Server

The local upload server is still available for local-only workflows:

```powershell
npm run start:local-upload
```

But public visitor links should use the deployed frontend and Supabase-backed data flow, not LAN-only local APIs.

## Notes

- `supabase-config.js` is already set to cloud-first with `localMode: false`.
- Do not expose a Supabase service role key in the browser.
- If you use Supabase RLS on `ra_comments`, add matching policies after applying the SQL file.
