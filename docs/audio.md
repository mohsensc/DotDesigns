# The ambient track

`client/public/audio/dot-ambient.mp3` — 11:36, 2.7 MB, mono, 32 kbps, 22.05 kHz.
It loops. Off by default; the visitor turns it on with the sound toggle.

## What's in it

Three Pablo Casals cello recordings, crossfaded, in order:

| Piece | Composer | Recorded | Source |
|---|---|---|---|
| Salut d'Amour | Elgar | 1915 | archive.org `salut-d-amour` |
| Träumerei | Schumann | 1909 | archive.org `Traunerei` |
| Serenade / The Swan | Toselli, Saint-Saëns | ~1915 | archive.org `TwoPabloCasalsAcousticalRecordingsSerenadeTheSwan` |

All public domain. Pre-1923 US sound recordings entered the public domain in 2022
under the Music Modernization Act, and the archive.org items are marked CC0 or
PD-Mark. No attribution is required and no royalties are owed. This table is here
so the next person doesn't have to re-derive that.

## How it was made

These are acoustic-era 78s. The music sits below ~2.5 kHz and the surface noise
runs 2–12 kHz, so cutting the top takes the hiss and leaves the cello alone.

```
ffmpeg -i <each source> -af "adeclick,highpass=f=75,\
lowpass=f=4000,lowpass=f=4000,lowpass=f=4000,\
afftdn=nr=22:nf=-38,loudnorm=I=-24:TP=-6:LRA=7" -ac 1 q_N.wav
```

Three cascaded lowpasses, not one. A single 2-pole filter is only 12 dB/oct, which
still left an audible carpet out to 8 kHz and — worse — left it at a *different*
level on each of the three transfers, so the hiss stepped at every crossfade.
Cascading gets ~36 dB/oct and everything above 5.5 kHz is just gone.

Then chained `acrossfade=d=8` between the three, a 6s fade at each end so the
loop seam is a dip rather than a click, and encoded mono at 22.05 kHz — the
content is band-limited well under 4 kHz, so a higher rate would only store silence.

Normalised to -24 LUFS, and the player sets volume 0.28 on top. It's meant to sit
under the room, not fill it.

## Rebuilding

Sources aren't in the repo, only the finished mp3. Re-download from the archive.org
identifiers above if you need to change the cut.
