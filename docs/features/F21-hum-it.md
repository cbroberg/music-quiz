# F21: Hum It / Sing It

**Status:** Idea

## Summary

Spillerne synger eller nynner en sang ind via telefonens mikrofon. De andre spillere hører klippet på host-skærmen og skal gætte hvilken sang det er. Ingen Apple Music involveret — ren menneskelig underholdning og garanteret grinefest.

## How It Works

1. En tilfældig spiller bliver valgt som "performer" (roterer per runde)
2. Performeren ser sangtitel + artist på sin telefon (kun synligt for dem)
3. Performeren har 15 sekunder til at nynne/synge ind via mikrofonen
4. Optagelsen streames til host-skærmen og afspilles for alle
5. De andre spillere gætter sangtitlen (free-text + AI evaluation)
6. Performeren får bonus-points baseret på hvor mange der gættede rigtigt

## Technical

- **Optagelse:** Web Audio API + `MediaRecorder` API i player PWA
- **Format:** WebM/Opus (nativt i MediaRecorder), 48kHz mono
- **Varighed:** 10-15 sekunder max
- **Streaming:** Base64-encode audio chunks, send via WebSocket til server, broadcast til host
- **Afspilning:** Host modtager chunks, decoder via `AudioContext.decodeAudioData()`
- **Alternativ:** Upload komplet optagelse som blob efter 15s timer, afspil som `<audio>` element
- **Permissions:** Kræver `navigator.mediaDevices.getUserMedia({ audio: true })` — browser viser mikrofon-permission dialog

## Player PWA Changes

- Ny screen: "Din tur! Nyn denne sang:" + titel/artist
- Record-knap med pulserende animation
- Waveform-visualisering under optagelse (AnalyserNode)
- Countdown timer (15s)
- "Send" knap eller auto-send ved timeout

## Host UI Changes

- "Lyt og gæt!" screen med højtaler-animation
- Afspil modtaget audio med waveform
- Replay-knap (kan afspilles igen)
- Vis performer-navn: "[Spiller] synger..."

## Scoring

- Gættere: Normal points (tid-baseret) for korrekt gæt
- Performer: 200 points per spiller der gættede rigtigt
- Bonus: Hvis ALLE gætter rigtigt → performer får 500 ekstra ("Standing Ovation")

## Edge Cases

- Spiller nægter mikrofon-permission → skip til næste spiller
- Ingen lyd optaget (stille) → auto-skip med besked
- Dårlig mikrofon-kvalitet → det er en feature, ikke en bug (gør det sjovere)

## Dependencies

- Browser MediaRecorder API (supported i alle moderne browsere)
- WebSocket binary/base64 transport (allerede i brug)
