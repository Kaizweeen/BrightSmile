# BrightSmile piece 4: the Play Store app

- **Date:** 2026-09-28
- **Status:** Draft for Kai's review
- **Scope:** Piece 4 of 4 (roadmap in `2026-09-22-brightsmile-core-booking-design.md`, section 3): "Play Store listing as a thin wrapper around the PWA".

Clinic staff can install BrightSmile from Google Play. The app is a Trusted Web Activity: Chrome opens the dashboard full screen with no browser bar, the site proves it owns the app through Digital Asset Links, and web push keeps working. Patients keep booking in their browser; there is no patient app.

---

## 1. Decisions

| Question | Decision |
|---|---|
| Wrapper | A Trusted Web Activity built with Google's Bubblewrap CLI from the site's web manifest. No second codebase (not Capacitor); the app updates whenever the site does. |
| What it opens | The clinic dashboard: the manifest's start URL `/app/requests`, scope `/` (so join links and the patient link also open inside it). |
| Package name and app name | Chosen by Kai when running Bubblewrap and set in Vercel; the code hard-codes neither. Suggested: package `com.brightsmile.clinic` (permanent once published), app name "BrightSmile Clinic". |
| Payments inside the app | Google Play's Payments policy requires Play's own billing for business software sold inside the app, and forbids steering users to another way to pay from inside it. So inside the Play app the dashboard shows no prices, GCash details, Pay online button, or "pay" prompts: the Billing page shows the plan's status only, and the banner states the facts ("Your plan ends Oct 9."). Owners pay on the website in a browser, and BrightSmile may remind them outside the app (texts, email), which the policy allows. |
| Who does what | The code (this piece): the asset links file, the Play-safe mode, the environment checks, and the guide. Kai: the Play developer account, running Bubblewrap (it makes the app's signing key), the store listing and declarations, and the closed test. |

## 2. Goals and success criteria

1. `https://{APP_URL host}/.well-known/assetlinks.json` returns the package and certificate fingerprints Kai set, so the app opens with no browser bar.
2. Inside the Play app no screen shows a price, payment details, a payment button, or a prompt to pay. In a normal browser nothing changes.
3. A wrong or half-set Android variable is refused at server start, naming the variable only.
4. The README takes Kai from nothing to a closed test on Google Play without outside help.

## 3. Components

1. **Asset links** (`src/app/.well-known/assetlinks.json/route.ts`): answers `[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app", "package_name": ..., "sha256_cert_fingerprints": [...]}}]` from `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` (comma separated, so the upload key and Play's app signing key can both be listed), with `Content-Type: application/json` and a one hour public cache. Without the variables it answers 404. Package names and certificate fingerprints are public by design.
2. **Play-safe mode:** Bubblewrap is told to open `/app/requests?source=play` (the twa-manifest start URL). A tiny client script in the dashboard layout remembers `source=play` in `sessionStorage` for that app session (the Trusted Web Activity shares cookies with the phone's Chrome, so a cookie would hide payments in the browser too). The billing banner and the Billing page's payment panel read that flag on the client: in the Play app they render the status only, without prices, GCash details, Pay online, or pay prompts. The server still renders everything for browsers; the flag only removes UI. The plan-ending push stays neutral for every device: "Your BrightSmile plan ends {date}." with no call to pay.
3. **Environment check:** `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_SHA256` are both set or both unset; the package name is a valid Android application id (two or more dot-separated segments, each starting with a letter, letters, digits, and underscores only); each fingerprint is 32 colon-separated pairs of uppercase hex digits. Messages name the variable and rule, never the value.
4. **Guide** (README, "Play Store app"): the Play developer account (a personal account created after 13 Nov 2023 needs a closed test with at least 12 testers opted in for 14 days in a row before it can go to production; an organization account is exempt but needs a D-U-N-S number); Bubblewrap run in a folder outside the repository with the answers to each prompt (start URL with `?source=play`, notifications on, a new signing key whose file and passwords go to Kai's password manager and never into the repository); building the app bundle; the Play Console steps (create the app, closed testing track, Play App Signing, copy the SHA-256 fingerprints into Vercel, redeploy, check the asset links URL, install from the test track and confirm no browser bar); the store listing (icon 512 px from `public/brand/icon-512.png`, a 1024x500 feature graphic Kai provides, phone screenshots, the privacy URL `{APP_URL}/privacy`); the Data safety form and the Health apps declaration (the dashboard shows patients' health information).

## 4. Security and privacy

- Asset links reveal only the package name and certificate fingerprints, which Google publishes anyway.
- The signing key never enters the repository; `.gitignore` covers the usual keystore and Android build file names in case Bubblewrap is run inside it by mistake.
- Play-safe mode removes UI only; it never changes what the server allows.

## 5. Testing

Unit tests: the asset links response (shape, several fingerprints, 404 when unset, content type), the environment rules, the start URL flag (set from `?source=play`, kept for the session, absent in a browser), and that the billing banner and payment panel render no price, payment detail, or pay prompt in Play-safe mode.

## 6. Out of scope

An iPhone App Store app, a patient app, Google Play Billing (owners pay on the website), push via Firebase (web push already works inside the app), offline support.

## Revisions

None yet.
