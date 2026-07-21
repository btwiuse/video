---
name: cinematic-music-sound-design
description: Music and sound-design helper for AI video, film prompts, action scenes, character PVs, trailers, emotional scenes, ads, generated-video review, Suno/Udio-style music prompts, rhythm cues, ambience, foley, impact sound, silence, and sound-image relationships. Use when music, BGM, sound effects, dialogue clarity, impact timing, emotional pacing, or audio direction affects the scene.
---

# Cinematic Music Sound Design

## Core Role

Treat audio as part of the scene, not decoration. Music and sound should clarify story, material, space, motion, scale, emotion, and timing.

## Audio Workflow

```text
scene function -> emotional curve -> cue map -> music language -> sound layers -> sync points -> mix perspective -> prompt
```

## Scene Function First

Define what audio does:

```text
build tension
mark action rhythm
reveal scale
support emotion
contrast the image
make material feel real
guide a transition
hold aftermath
```

## Music Controls

Use concrete controls:

```text
tempo: slow / medium / fast / accelerating / halftime
rhythm: sparse pulse / driving percussion / syncopated hits / steady ostinato
harmony: warm / cold / unresolved / heroic / tragic / eerie
melody: absent / simple motif / lyrical line / fragmented phrase
texture: thin / dense / airy / metallic / granular / orchestral / synth
shape: gradual build / sudden drop / swell / hit-stop / final decay
```

## Sound Layers

Layer by physical cause:

```text
ambience: room tone, wind, crowd, city, machinery, forest, rain
foley: footsteps, cloth, leather, breath, hand movement
props: blade ring, gun mechanism, cable tension, glass, metal, ceramic
body: effort breath, impact grunt, armor compression
impact: hit, boom, crack, slam, thud, scrape
space: echo, reverb tail, distance, muffling
silence: shock, decision, awe, aftermath
```

## Action Sound Timing

```text
pre-action breath -> foot plant -> weapon/cloth whoosh -> impact hit -> debris or ring tail -> recovery silence
```

For heavy action, add low-frequency weight and delayed decay. For agile action, use short crisp transient sounds.

## Character PV Audio

```text
identity motif -> detail cue -> action cue -> final signature sound
```

Keep the sound palette tied to the character's material, power, culture, or world.

## Emotional Scene Audio

- Do not over-score every second.
- Use silence or room tone before important lines or decisions.
- Let music change when the character internally changes.
- Keep dialogue readable.

## AI Music Prompt Template

```text
A [duration] cinematic cue for [scene]. Emotional function: [function]. Tempo [tempo], rhythm [rhythm], harmony [harmony], instrumentation [instruments], texture [texture]. Key hit points: [time/action]. Leave space for [dialogue/silence/impact]. End with [decay/final motif].
```

## AI Video Sound Direction Template

```text
Sound design: [ambience] establishes the space. [Foley] follows the body movement. [Prop/material sound] marks the key object. The strongest impact lands at [time] with [sound], followed by [tail/silence/reaction]. Music [builds/drops/holds] to support [emotion/action].
```

## Common Fixes

- **Wall-to-wall music**: add silence, dynamic contrast, and cue boundaries.
- **Action has no weight**: add foot plants, material hits, low-frequency impact, debris tail.
- **Scene feels small**: add room/landscape ambience and reverb scale.
- **Emotion feels generic**: define motif, harmony, and where music changes.
- **Dialogue unclear**: reduce music density and leave frequency space.

## Output Shape

```text
Audio function:
Cue map:
Music language:
Sound layers:
Hit points:
Mix perspective:
Prompt-ready audio block:
Negative constraints:
```

## Negative Constraints

```text
no constant loud music, no generic epic trailer sound by default, no impact without tail, no music covering dialogue, no unrelated sound effects, no rhythm that contradicts action timing, no missing ambience, no overcompressed audio feel
```
