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

- Live public feed with search, lost/found filters, category, date, building and sort filters
- Google OAuth sign-in with verified MSU Gensan email-domain enforcement
- Create listings with up to five photos, building/landmark and a claim-verification question
- Claims, private conversations and realtime notifications
- Two-party handover confirmation
- Student reputation points for completed returns
- Recently viewed listings and personal report history
- Admin listing/report moderation, student suspension controls, configurable listing expiry, activity history and CSV export
- Light, dark and system appearance preferences
- Listing expiry runs daily through Supabase pg_cron

The frontend is plain HTML, CSS and JavaScript. Open `index.html` through a local web server for local testing.
