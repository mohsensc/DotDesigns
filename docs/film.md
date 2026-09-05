# The film, two ways

Same flight, two cuts. Desktop 16:9, mobile a native 9:16 chain — not a crop.
Each ships two candidate encodes; the frontend picks one and deletes the loser.

## Desktop — `vid/<id>.mp4`

Never regenerated, only upscaled: `bytedance_video_upscale --resolution 4k
--model_version pro --fps 24` → 3882x2160, frame counts intact. At a
native-pixel crop the 4K really does resolve relief texture and marble veining
the source mushes, so no `unsharp` on top.

```
ffmpeg -i <4k>.mp4 -an -r 24 -frames:v <N> -vf "scale=1920:-2" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart <id>.mp4
```

Frames and duration match the originals to the frame, so the DECK's
`settle`/`range` numbers still land. Height is 1068, not 1072: the upscale's
aspect is 1.7972 against the source's 1.7985. A 1440p encode was measured and
lost on frame time (docs/site.md), so it was deleted.

## Mobile — `vid/<id>-m.mp4`

Four `kling3_0 --mode pro --aspect_ratio 9:16 --duration 10 --sound off` legs,
native 1076x1928, chained: each `--start-image` is the previous leg's actual last
frame (`-sseof -0.15`). Leg 0 starts from a portrait recompose of `arrival.webp`
via `nano_banana_pro`. No connectors — one forward take. Encoded with the line
above but `scale=720:-2`, `crf 20`, `-g 4 -keyint_min 4` (1080 wide lost on
tail latency, deleted). Posters are frame 0 at `cwebp -q 82`, plus `studio-m.webp` cut
from the atelier split frame.

## Numbers for the config

Every leg is 10.041667s / 241 frames. GOP 4, so the picture steps every 0.1667s;
both settles sit mid-step.

- `atelier-m` doorway split **0.5477** (t=5.500s, last frame before the doorframe).
- `atelier-m` studio settle **0.8631**, a fraction of the `[0.5477, 1]` window
  (t=9.42s) — same convention as the desktop `0.86`.
- `gallery-m` settle **0.8216** (t=8.25s, monolith left of centre, gold wall behind).

## Broken

`materials-m` has a soft dissolve near t=4.75s between the wide studio and the
low worktable. Same room and light, so it reads as a blended push-in, but it
isn't a true unbroken move — and it was the better of two takes. `atelier-m`
needed a re-roll; the first stopped at the threshold. Nothing has been scrubbed
on a real phone yet.

Credits: 984 → 845.06.
