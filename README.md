# FindIt — MSU Gensan Lost & Found

A campus lost-and-found board for the MSU Gensan community.

## Stack
- HTML, CSS, beginner-friendly JavaScript
- Supabase Auth (Google OAuth), PostgreSQL, Row Level Security, Storage
- Vercel hosting connected to this GitHub repository

## Structure
- `index.html` — homepage and forms
- `css/style.css` — responsive styles
- `js/app.js` — Supabase connection, live listings, Google sign-in, posting, claims
- Database schema and policies are installed in Supabase migrations.

## Finish Google sign-in setup
1. In Supabase, open **Authentication → Sign In / Providers → Google**.
2. Enable Google and add your Google OAuth Client ID and Client Secret from Google Cloud Console.
3. Add this callback URL to the Google OAuth client's authorized redirect URIs:
   `https://bmtearyxlnrzgcuvcepw.supabase.co/auth/v1/callback`
4. In **Authentication → URL Configuration**, set Site URL to:
   `https://findit-msu-gensan.vercel.app`
5. Add redirect URL `https://findit-msu-gensan.vercel.app/**`.

The Google `hd` parameter is only a sign-in hint. A database trigger independently rejects accounts outside the verified `@msugensan.edu.ph` domain.

## Security
- RLS is enabled on all application tables.
- Student profiles are private to their owners.
- Only published listings are public.
- Claim records and conversations/messages are restricted to participants.
- Public item photos: JPG, PNG, WebP, maximum 5 MB.
- Private attachment bucket: PDF/images/videos, maximum 30 MB. Private signed-link workflows are not yet exposed in the UI.
- Never place a Supabase service_role or secret key in frontend code. The publishable key is designed to be public.

## Current feature status
- Live public feed, search and lost/found filters
- Google OAuth frontend (requires provider credentials above)
- Verified school-domain enforcement in the database
- Create listing and upload one item photo
- Submit claim request
- Messaging database tables exist; messaging UI/realtime notifications are not implemented yet
- Admin moderation dashboard is not implemented yet

Open `index.html` through a local web server for local testing.
