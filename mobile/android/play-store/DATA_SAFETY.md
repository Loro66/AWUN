# SONGVALE — Google Play Data safety draft

This file is a prepared answer sheet for the SONGVALE Android build with application
ID `com.loro66.awun`. Re-check the deployed app and all enabled provider SDKs
before submitting the form; the Play Console account owner is responsible for
the final declaration.

## Top-level answers

| Play Console question | Prepared answer |
|---|---|
| Does the app collect or share any required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes — application traffic is HTTPS-only |
| Can users request data deletion? | Yes if accounts are enabled: users can delete an account and cloud library in Settings. Local-only data can be removed through SONGVALE controls, Android **Clear storage**, or uninstall |
| Does the app support account creation? | Conditional: yes only after persistent Supabase Auth/Postgres and email delivery are enabled on the hosted service |
| Does the app contain ads? | No |

## Data types

### App activity → In-app search history

- Collected: **Yes**
- Shared: **No** for the Play form. Provider transfer is initiated by the user
  to complete the requested search; re-check this answer if provider or analytics
  behavior changes.
- Processed ephemerally: **Yes**
- Required or optional: **Required for search**, but the user chooses whether to
  make a search.
- Purpose: **App functionality**
- Retained in a SONGVALE user database: **No**

### Other user-generated content

This covers a public playlist URL explicitly pasted by the user.

- Collected: **Yes**
- Shared: **No** for the Play form under the user-initiated-action exception.
- Processed ephemerally: **Yes**
- Required or optional: **Optional**
- Purpose: **App functionality**
- Retained in a SONGVALE user database: **No**

## Account data when the hosted service enables accounts

Email, optional display name, user ID and saved track/playlist metadata pass
through the SONGVALE backend to Supabase for authentication and synchronization.
Password is used for sign-in and deletion confirmation; SONGVALE does not store
it in its own database. The Play Console declaration must describe this optional
collection and the in-app deletion path before enabling accounts for Play users.
When the account feature flag is off, the registration UI is hidden and no
account data is collected.

## Other data not collected by the Android app

- phone number, address;
- precise or approximate location;
- contacts, calendar, messages, photos or videos;
- payment or financial information;
- health or fitness data;
- installed-app list;
- advertising ID or other app-specific device identifier;
- crash analytics or behavioral analytics.

Standard IP address, User-Agent and request timestamps may be present in
infrastructure security logs. The privacy policy discloses this. If analytics,
crash reporting, payments, ads or push notifications are added,
this sheet and the Play form must be updated before releasing that build.

## In-app and public privacy policy

Use the deployed HTTPS URL:

`https://awun-1.onrender.com/privacy`

Do not submit the public listing until that URL returns HTTP 200 without login.
The same policy is linked inside the app and its offline error screen.
