---
name: cinematic-audiovisual-language
description: Cinematic audiovisual language helper for AI video, storyboard, image-to-video, prompt-to-video, shot list, generated-video diagnosis, and scene planning. Use for shot function, shot size, camera angle, screen direction, axis, staging, continuity, camera movement, cuts, sound-image relationship, readable geography, and making a video prompt filmable rather than just visually decorative.
---

# Cinematic Audiovisual Language

## Core Role

Make a video prompt filmable. Each shot must have a function, a spatial logic, a subject hierarchy, and a reason to move or cut.

Do this before adding style polish. A beautiful prompt still fails if the viewer cannot understand where the subject is, what changed, or why the camera moves.

## Shot Function First

Use one of these functions for each shot:

```text
establish: show place, scale, direction, relationship
introduce: reveal character, object, threat, or goal
observe: let the audience read behavior or mood
follow: track a movement through space
emphasize: isolate a detail, decision, hand, weapon, face, clue
react: show consequence on character, object, crowd, or environment
transition: connect time, place, or emotional state
resolve: hold the final state so the beat lands
```

## Basic Shot Size Use

- **Extreme wide**: scale, isolation, battlefield, city, monster, journey.
- **Wide**: geography, body movement, group relation, action clarity.
- **Medium**: performance, gesture, dialogue, action with readable torso and hands.
- **Close-up**: decision, emotion, prop detail, material, grip, eye line.
- **Insert**: clue, trigger, device, foot, hand, weapon, screen, impact point.

## Continuity Checklist

Before writing the final prompt, define:

```text
where is the subject?
which direction do they face or move?
what is foreground / midground / background?
what changes from shot to shot?
what motivates each cut?
what does sound carry across the cut?
what must remain visually consistent?
```

## Axis and Screen Direction

- Keep the character's travel direction consistent unless the reversal is the point.
- In fight/chase scenes, establish who is left/right or near/far before cutting closer.
- If switching angle, include a visible bridge: crossing movement, object insert, over-shoulder shot, reaction shot, or wide reset.
- If a character turns around, show the turn rather than teleporting the orientation.

## Camera Movement Contracts

Use one main camera idea per shot:

```text
locked-off: pressure, stillness, comedy timing, objective observation
slow push-in: realization, threat, emotional focus
pull-back: reveal isolation, scale, consequence
tracking: follow travel, chase, partner movement
orbit: power shift, ritual, transformation, character showcase
handheld: urgency, instability, documentary pressure
crane/drone rise: scale reveal, victory, loss, map-like ending
```

Camera movement must be motivated by subject movement, reveal, emotional pressure, or spatial discovery.

## Scene Design Workflow

1. Define the scene goal in one sentence.
2. Choose the beginning image and final image.
3. Identify the main subject and visual hierarchy.
4. Map the space: entrance, exit, obstacles, background, light source.
5. Assign shot functions.
6. Choose camera movements only where needed.
7. Add sound-image bridges.
8. Convert into a compact AI-video prompt.

## AI Video Prompt Pattern

```text
Duration [X] seconds. Start with [shot size] that establishes [space, subject, relation]. Camera [movement] because [subject/action/reveal]. Then [next shot or continuous move] showing [change]. Keep screen direction [left-to-right/right-to-left/toward camera/away from camera]. End by holding [final image] for [time] so the audience reads the consequence.
```

## Sound-Image Relationship

Use sound to clarify time and cause:

- pre-lap: sound begins before the image cuts to its source.
- J-cut/L-cut: dialogue or ambience bridges shots.
- silence: highlights shock, danger, awe, decision, or aftermath.
- impact sync: footstep, door slam, blade hit, explosion, reveal cue.
- ambience continuity: keeps space coherent across cuts.

## Common Fixes

- **Too many shots**: combine to one continuous move or reduce to 3 functions.
- **Confusing geography**: add a wide reset and state screen direction.
- **Unmotivated camera**: tie movement to subject or reveal.
- **Scene feels like image collage**: define change between shots.
- **Action unreadable**: use medium/wide for peak contact.
- **Prompt too abstract**: replace mood words with shot function and visual action.

## Output Shape

```text
Scene goal:
Beginning image:
Final image:
Spatial map:
Shot functions:
Screen direction / axis:
Camera plan:
Sound-image cues:
Prompt-ready sequence:
Negative constraints:
```

## Negative Constraints

```text
no random cuts, no unclear geography, no mismatched screen direction, no excessive camera moves, no cut without new information, no camera shake hiding action, no overpacked shot, no subject drift, no final image without hold
```
