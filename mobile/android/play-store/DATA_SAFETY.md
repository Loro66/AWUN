# AWUN — Google Play Data safety draft

This file is a prepared answer sheet for the AWUN Android build with application
ID `com.loro66.awun`. Re-check the deployed app and all enabled provider SDKs
before submitting the form; the Play Console account owner is responsible for
the final declaration.

## Top-level answers

| Play Console question | Prepared answer |
|---|---|
| Does the app collect or share any required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes — application traffic is HTTPS-only |
| Can users request data deletion? | No remote account exists. Explain that local data is deleted through AWUN controls, Android **Clear storage**, or uninstall |
| Does the app support account creation? | No |
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
- Retained in an AWUN user database: **No**

### Other user-generated content

This covers a public playlist URL explicitly pasted by the user.

- Collected: **Yes**
- Shared: **No** for the Play form under the user-initiated-action exception.
- Processed ephemerally: **Yes**
- Required or optional: **Optional**
- Purpose: **App functionality**
- Retained in an AWUN user database: **No**

## Not collected by the Android app

- name, email, phone number, address, user IDs;
- precise or approximate location;
- contacts, calendar, messages, photos or videos;
- payment or financial information;
- health or fitness data;
- installed-app list;
- advertising ID or other app-specific device identifier;
- crash analytics or behavioral analytics.

Standard IP address, User-Agent and request timestamps may be present in
infrastructure security logs. The privacy policy discloses this. If analytics,
crash reporting, authentication, payments, ads or push notifications are added,
this sheet and the Play form must be updated before releasing that build.

## In-app and public privacy policy

Use the deployed HTTPS URL:

`https://awun-1.onrender.com/privacy`

Do not submit the public listing until that URL returns HTTP 200 without login.
The same policy is linked inside the app and its offline error screen.
