# KidzQueue (Web MVP)

KidzQueue is a parent-controlled, kid-safe YouTube playlist player.

## Features
- Parent and Child entry modes
- Parent PIN gate (4-digit)
- Parent can add approved videos by YouTube URL
- Parent can import a PDF and detect YouTube URLs from assignment sheets
- Child mode uses only approved playlist
- Auto-plays next approved video when current one ends
- Child playback is interaction-locked with:
  - YouTube controls hidden (`controls=0`)
  - Keyboard controls disabled (`disablekb=1`)
  - Fullscreen disabled
  - Transparent touch guard over video to block taps/clicks

## Run
Start a local server:

```bash
cd "/Users/shalini/Documents/New project"
python3 -m http.server 5500 --bind 127.0.0.1
```

Then open:

`http://127.0.0.1:5500`

## Notes
- This is a front-end MVP using browser `localStorage` for playlist and parent PIN.
- Video titles are placeholders in this version; they are not fetched from YouTube metadata APIs.
- PDF URL extraction relies on `pdf.js` loaded from CDN.
