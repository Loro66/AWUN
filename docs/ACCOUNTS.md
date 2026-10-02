# User accounts and cross-device library sync

SONGVALE 2.5.4 runs as a guest app. Favorites, playlists, listening history and
the transfer state are stored in the browser on each device. The iPhone Home
Screen installation does not create an account or sync that state. A backup can
be exported and imported manually from Settings.

## Delivery requirements

1. Provision a persistent database and an identity service for the hosted app.
   The current free web container has no durable account database. Never use
   its local filesystem for passwords or libraries. Configure credentials in
   deployment secrets, not the repository.
2. Add verified email sign-in (with an optional Apple sign-in path later),
   sign-out and account deletion. Use short-lived sessions in secure, HTTP-only
   cookies. The frontend must never store a long-lived bearer token in
   `localStorage`.
3. Store favorites and named playlists per account, with a server revision for
   every mutation. Keep only track metadata and catalog identifiers; playback
   URLs expire and must be refreshed on the device. Do not upload listening
   logs or imported file contents without a separate, explicit choice.
4. On first sign-in, show a review of the device library and merge it into the
   account without replacing existing cloud entries. Keep a local copy for
   offline browsing. Multiple devices must handle conflicting edits without
   silently dropping playlist membership or changing playlist order.
5. Test: guest use without an account; verified sign-in and sign-out; two-device
   round-trip; unauthorized access to another user's data; session expiry;
   interrupted writes; conflict resolution; export and deletion. Only expose
   the account controls after persistent storage and these tests are live.

The initial account release can sync favorites and playlists. Listening history,
recommendations, settings and import progress can follow as separately
described features. Until that release, users moving from Windows to iPhone can
use the Settings backup export/import flow.
