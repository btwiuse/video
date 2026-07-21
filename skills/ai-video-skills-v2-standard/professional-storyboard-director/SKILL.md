---
name: professional-storyboard-director
description: Storyboard and shot-list director for AI video, film scenes, short videos, character PVs, action beats, commercials, prompt-ready 8s/12s/15s sequences, and script-to-shot planning. Use when the user asks for storyboard, shot list, beat map, 15-second structure, camera plan, scene breakdown, or prompt-ready video segmentation.
---

# Professional Storyboard Director

## Core Role

Convert an idea, script, reference image, or video goal into a sequence of readable shots. A storyboard should show what changes over time, not just list beautiful images.

## Storyboard Modes

Choose one:

```text
narrative scene: character wants something and the scene changes
character PV: identity, attitude, power, detail, final icon
action beat: movement path, impact, reaction, recovery
product / prop reveal: problem, feature, detail, benefit, hero image
atmosphere scene: place, mood, small action, texture, final feeling
reference breakdown: extract transferable mechanism, not copy surface
```

## Workflow

1. State the scene goal.
2. Identify the opening and ending image.
3. Choose 3-6 beats.
4. Assign each beat a shot function.
5. Decide what the viewer must notice first.
6. Keep geography and character identity consistent.
7. Add one clear peak.
8. End with a hold or poster-like image.

## 15-Second Standard Structure

```text
0-3s: establish place, subject, mood, direction
3-6s: first decision, movement, or reveal
6-9s: escalation, obstacle, transformation, or reversal
9-12s: strongest visual/action/emotional peak
12-15s: consequence, recovery, final image
```

## 8-Second Structure

```text
0-1.5s: establish subject and location
1.5-3s: first action or reveal
3-5.5s: main transformation / conflict / peak
5.5-8s: consequence and final hold
```

## Shot Card Template

```text
Shot [number] / [time]
Function:
Visual:
Camera:
Action:
Sound:
Continuity note:
AI prompt sentence:
```

## Character PV Pattern

```text
1. identity reveal: silhouette, face, costume, environment ownership
2. detail proof: hand, weapon, emblem, material, power source
3. movement proof: one signature action, pose, or ability
4. attitude proof: expression, stance, eye line, relationship to camera
5. final icon: clean hero frame, readable silhouette, short hold
```

## Action Storyboard Pattern

Use with action choreography and rhythm:

```text
1. geography and threat
2. preparation / stance
3. movement path
4. peak impact or dodge
5. reaction / consequence
6. recovery / final power relation
```

## Reference Breakdown Pattern

When using a reference video or image:

```text
transfer: shot function, rhythm, camera relation, material idea, color relation, or mood
avoid transferring: exact identity, copyrighted character, random surface details, unclear camera artifacts
adaptation sentence: keep the mechanism but change subject, world, palette, and story function
```

## Quality Checks

- Does every shot have a reason to exist?
- Does each beat change information or power relation?
- Can a viewer understand subject, space, and action without reading the prompt?
- Is there one strongest peak?
- Does the ending hold long enough?
- Are image references assigned to specific roles?
- Is the model asked to do too many actions in one shot?

## Prompt Packaging

After the storyboard, provide a compact prompt block:

```text
Duration:
Reference roles:
Visual style:
Shot-by-shot timing:
Camera and continuity:
Sound:
Negative constraints:
```

## Common Fixes

- **Too flat**: add reversal, reveal, or stronger final image.
- **Too chaotic**: reduce shots and actions.
- **Too generic**: name the shot function and physical detail.
- **No emotional change**: make the final expression or pose different from the opening.
- **Bad AI continuity**: repeat identity, costume, color, and key prop in each important shot.

## Negative Constraints

```text
no unrelated shots, no unreadable sequence, no excessive scene changes, no too many actions in one shot, no missing final hold, no inconsistent character identity, no random camera movement, no prompt that reads like a poster instead of a video
```
