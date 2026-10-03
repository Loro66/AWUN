# User accounts and cross-device library sync

SONGVALE has optional email accounts. The Settings panel shows sign-in and
registration only when the hosted service is connected to persistent Supabase
Auth and Postgres. Otherwise guest mode and file transfers keep working.

## Move a library without an account

Open **Settings → Move between devices → Download library** on the first
device, then open SONGVALE on the second device and choose **Open library file**.
Review the track and playlist counts, then explicitly combine or replace the
library on that device. The portable JSON contains favorites and named playlists
only; no passwords, session cookies, listening history, settings, temporary
stream/download URLs or in-progress imports. The file is parsed locally and
limited to 4 MB. Keep a copy before replacing data. Existing full-device
backups remain under Diagnostics and serve a different purpose.

## Activate on the hosted service

1. Create a Supabase project. In its SQL editor run
   [`backend/accounts/schema.sql`](../backend/accounts/schema.sql). The table
   has row-level security: authenticated users can only select, insert and
   update their own row. Keep the secret key on the server.
2. In Supabase Auth, enable email confirmations and set **Site URL** to the
   public SONGVALE origin, for example `https://awun-1.onrender.com`.
   Configure **custom SMTP** before inviting real users: Supabase's default
   sender does not deliver confirmation messages to arbitrary addresses.
3. Set these deployment environment variables in the server's secret settings,
   then redeploy. Set `AWUN_ACCOUNTS_ENABLED=true` only after the SQL table and
   email delivery are verified:

   ```text
   AWUN_ACCOUNTS_SUPABASE_URL=https://<project-ref>.supabase.co
   AWUN_ACCOUNTS_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   AWUN_ACCOUNTS_SUPABASE_SECRET_KEY=sb_secret_...
   AWUN_ACCOUNTS_ENABLED=true
   ```

   Do not put the secret key in the repository, frontend, iOS/Android bundle or
   a public issue. The endpoint `GET /api/v1/account/config` should return
   `{"enabled":true}` after configuration. If the SQL table or email sender is
   missing, leave the account service disabled rather than advertise sync.
4. Register a test user, confirm the email, sign in on one device, set a
   profile name, merge a
   guest library, and open the same account on a second device. Check that
   favorites and playlists arrive, that a conflicting edit offers an explicit
   choice, and that sign-out clears local account music. Test account deletion
   with a fresh password entry. Check “Forgot password?” from a signed-out
   browser: the email link returns to the Site URL, where SONGVALE removes the
   fragment from the address and prompts for a new password.

## Behavior and limits

- The guest library stays on the device. On first sign-in, choose to combine it
  with the account or replace it with the account copy. If this device holds a
  *different* account's library, SONGVALE does not merge it into the new user.
  Export a backup in Diagnostics before replacing any local copy.
- The service stores only favorite/playlist track metadata and catalog IDs.
  Temporary stream and download URLs are not uploaded. Playback resolves a
  fresh link when needed. Listening history, queue, taste signals, comments,
  search history, settings and in-progress imports remain device-local.
- Changes are saved locally first, then synced with a revision check. Network
  failures leave the copy on the device and retry with bounded backoff. A lost
  save response is reconciled against the cloud copy before showing a conflict.
  If another device changed the cloud
  copy, the user chooses to combine copies or use the current account copy.
  The Sync button and returning to a tab after a minute check for newer data.
- Sign-out requires pending changes to sync first. It clears the account's
  local favorites, playlists, queue, recent listening and active player, while
  leaving the cloud copy intact. Account deletion rechecks the password and
  deletes the Auth user and its cloud library; export anything you need first.
- The account gateway is on the same origin. Session credentials use HTTP-only,
  Secure, SameSite=Strict cookies in production. Mutations check the Origin
  header. Browser storage holds only sync revision/owner metadata, not tokens.
- Confirmation links clear their fragment and ask the user to sign in. Recovery
  tokens are held in memory only until the new password is accepted. Password
  recovery requires working email delivery.
- An optional display name is stored in Supabase Auth user metadata. It is
  presentation data, never used for account isolation or authorization.

The free Render container has ephemeral storage. Its filesystem is not an
account database. For real use, arrange a persistent Supabase plan and monitor
its limits and email delivery. The code can be tested locally without provider
credentials through mocked gateway and browser tests, but real registration and
cross-device delivery require the deployment configuration above.
