# Bright Smile Dental Clinic: 40-second promo

- **Format:** 9:16 vertical, 1080 × 1920, 30 fps, 40 s
- **Made for:** TikTok, Facebook Reels and YouTube Shorts. The same file works on all three.
- **Audience:** families and adults in Makati who are scrolling on their phones. Many watch with the sound off, so captions carry the voiceover.
- **Look:** brand teal `#0d8781`, deep navy-teal `#0b3d4a`, logo cream `#fdf5ef`, Figtree type, the tooth emblem. Smooth iris and wipe transitions, with text that pops and slides in.
- **Files:** `brightsmile-promo-9x16.mp4` (picture plus a silent audio track), `promo.html` (the animation source), `render.mjs` (renders the MP4)

## Selling points, and what was left out

The video uses only facts from `PRODUCT.md` and the landing page:

1. **Easy booking:** book online in a minute, and the clinic confirms by text message.
2. **Gentle care for the whole family:** two dentists treat kids and adults. Services run from cleaning, *pasta* and *bunot* to braces and root canal.
3. **Near you:** three clinics in Makati with the same hours at all three, 9:00 AM to 5:00 PM.

**Call to action:** "Book your visit today" with brightsmile.pro, 0956-342-1673, and the booking QR code from the landing page.

These were left out on purpose: "painless", "affordable packages" and "free consultation". `PRODUCT.md` says no prices or claims may be shown that the clinic hasn't confirmed. "Painless" is also a medical claim. If the clinic does offer a free consultation, change the CTA headline in `promo.html` to "Book your FREE consultation", change the last voiceover line to match, and render again.

## Scene by scene

| # | Time | Picture and motion | On-screen text | Voiceover |
|---|---|---|---|---|
| 1 | 0:00–0:03 | **Hook.** Navy screen. The words drop in one by one and a gold "?" bounces in. A teal underline draws, then the screen closes to a dot (iris out). | **When was your last dental check-up?** / *Kailan ka huling nagpa-check-up?* | "When was your last dental check-up?" |
| 2 | 0:03–0:07 | **Brand.** Cream screen. The tooth emblem pops out of the closing dot and two gold sparkles twinkle. The name and a "Makati City" pin pill slide up. | **Bright Smile** · DENTAL CLINIC · 📍 Makati City | "At Bright Smile in Makati, a healthy smile is easy." |
| 3 | 0:07–0:15 | **Point 1: easy booking.** A phone rises into frame and time slots fade in. A tap picks 10:30 AM and a second tap presses "Book my visit". A text notification slides down ("Your visit … is confirmed") and a check badge bounces in. | 01 · Easy booking / **Book in a minute. No calls needed.** | "Book online in a minute. No calls needed. Pick a time, and we'll text to confirm your visit." |
| 4 | 0:15–0:24 | **Point 2: gentle care.** "Kids" and "Adults" badges pop in, then service chips pop in two waves, each with the English name and the word patients search for. | 02 · Gentle care / **Friendly dentists for the whole family.** / Cleaning · Filling *(Pasta)* · Extraction *(Bunot)* · Braces · Whitening · Root canal / + dentures, crowns, veneers and more | "Gentle, friendly care for kids and adults, from cleaning and pasta to braces and root canal." |
| 5 | 0:24–0:32 | **Point 3: near you.** The scene wipes across to white. A Makati map card pops in and three pins drop with ripples at the clinics' real positions (Olympia, Chino Roces Ave., Brgy. Rizal). A clock badge spins to "Open 9 AM – 5 PM". | 03 · Near you / **3 clinics in Makati. Same hours at all three.** | "Three clinics in Makati, open 9 to 5. There's one near you." |
| 6 | 0:32–0:40 | **Call to action.** Navy opens from the bottom (iris). The emblem and headline come in, then the URL pill, which pulses gently, then the phone number and QR code. Hold on the sign-off. | **Book your visit today.** / **brightsmile.pro** / 0956-342-1673 / Scan to book / *Your bright smile starts here.* / 3 clinics in Makati · Open 9 AM – 5 PM | "Book your visit today at brightsmile.pro. Your bright smile starts here." |

Captions for scenes 2–5 sit at 69–77% of the frame height. That is above the TikTok and Reels caption bar and clear of the buttons on the right. Scenes 1 and 6 skip the caption band because the large on-screen text already says the voiceover line.

## Voiceover script (about 75 words)

Read it warm and upbeat with a slight smile, like a friendly front-desk staffer. Speak at a natural pace and leave short pauses at the breaks below. A Filipino-English (Taglish-friendly) accent fits the audience best.

> **[0:00]** When was your last dental check-up?
> **[0:03]** At Bright Smile in Makati, a healthy smile is easy.
> **[0:07]** Book online in a minute. No calls needed. *(beat)* Pick a time, and we'll text to confirm your visit.
> **[0:15]** Gentle, friendly care for kids and adults, from cleaning and *pasta* to braces and root canal.
> **[0:24]** Three clinics in Makati, open nine to five. *(beat)* There's one near you.
> **[0:32]** Book your visit today at brightsmile dot pro. *(beat)* Your bright smile starts here.

**Optional Tagalog hook:** open with "Kailan ka huling nagpa-check-up?" and keep the rest the same. The Tagalog line is already on screen.

## Music

- **Mood:** bright, feel-good, modern. Light pop or tropical-house with a clean beat, about 110–120 BPM.
- **Instruments:** plucked synths or ukulele, soft claps, airy pads, a light marimba or bell motif. Avoid heavy bass drops and vocals, which would compete with the voiceover.
- **Shape:** start right on beat one so the hook lands. Keep the music under the voiceover at about −18 dB to −20 dB, and let it lift at 0:32 for the call to action. Finish on a clean button ending or let it ring out at 0:40.
- **Accents:** a soft "ding" when the check badge lands (0:12), light pops on the chips (0:17–0:20) and the pins (0:25–0:27), and a whoosh on each transition (0:03, 0:15, 0:24, 0:32).
- **Where to get it:** TikTok's and Facebook's own commercial music libraries, YouTube Audio Library, or a licensed stock track. Search terms: "upbeat corporate", "happy ukulele", "fresh tropical pop". A business account must use commercially licensed music.

## Adding the voiceover and music

The MP4 has a silent audio track, so it uploads anywhere. To put the real audio on it, record the voiceover at the times above, choose a track, and run:

```bash
ffmpeg -i brightsmile-promo-9x16.mp4 -i voiceover.wav -i music.mp3 \
  -filter_complex "[2:a]volume=0.18,afade=t=out:st=38.5:d=1.5[m];[1:a][m]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t 40 -shortest brightsmile-promo-final.mp4
```

You can also bring the MP4 into CapCut or the TikTok editor and add the voiceover and music there.

## Posting tips

- **TikTok / Reels:** post it natively; don't share it as a YouTube link. Use the video's own captions and turn auto-captions off so the text doesn't double. Choose 0:33 (the call-to-action screen) as the cover frame. Suggested caption: *"Kailan ka huling nagpa-check-up? 🦷✨ Book online in a minute at brightsmile.pro. 3 clinics in Makati, open 9 AM–5 PM. #MakatiDentist #DentalClinicMakati #BrightSmile"*
- **YouTube Shorts:** keep it under 60 s (it is 40 s) and put brightsmile.pro in the description.
- **Facebook / YouTube feed (16:9):** this cut is vertical. For a landscape version, the scenes can be laid out side by side (headline left, visual right) in a copy of `promo.html` at 960 × 540.

## Changing and rendering

Every motion in `promo.html` is one CSS animation, set with `data-a="name start duration"` (entrance) or `data-o="…"` (exit). Times are in seconds from the start of the video. To preview the animation, open `promo.html` in Chrome; to check a single moment, add `?t=12.5` to the URL. To render:

```bash
npm install                                          # once, from the repo root
node marketing/promo-video/render.mjs --stills 2 10 34   # PNGs of single moments
node marketing/promo-video/render.mjs                # the MP4, about 5 minutes
```

You need ffmpeg and a Chromium: `npx playwright install chromium`, or set `PLAYWRIGHT_CHANNEL=chrome` or `CHROMIUM_PATH`. The QR code on the CTA screen is drawn from the same rows as the landing page (`src/app/clinic/data.ts`), so it opens the real booking page. If the booking link changes, update the rows in both places.
