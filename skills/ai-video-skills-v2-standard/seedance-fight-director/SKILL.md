---
name: seedance-fight-director
description: Seedance/Higgsfield fight and action prompt director for AI video generation, including martial arts, sword fights, weapon exchanges, chase scenes, superpower combat, monster fights, character action PVs, and action storyboard prompts. Use when writing, diagnosing, or iterating fight prompts, timing maps, reference-image roles, camera plans, negative constraints, or prompt-ready 8s/12s/15s action sequences.
---

# Seedance Fight Director

## Core Role

Create clear Seedance/Higgsfield fight prompts. Prioritize readable action, simple timing, stable identity, assigned references, physical consequence, and one strong peak.

## Required Output

Unless the user asks for a short answer, output:

```text
Director judgment:
Reference roles:
Action physics:
Timing map:
Camera plan:
Prompt-ready Seedance/Higgsfield block:
Negative constraints:
Generation checklist:
```

## Director Judgment

State:

```text
fight type: duel / chase / ambush / weapon exchange / monster fight / power clash / character PV action
format: T2V / I2V / reference-image video / prompt repair
main risk: chaos / identity drift / no impact / too many actions / weak camera / bad timing
main solution: one sentence
```

## Reference Role Assignment

If images or videos are provided, assign each one a role:

```text
@character: identity, face, outfit, silhouette
@scene: location, layout, lighting, atmosphere
@style: color, render style, lens mood only
@pose: body line or starting pose only
@motion: timing, weight shift, camera rhythm only
```

Bind references explicitly:

```text
Keep the character identity, outfit, and silhouette from @character. Use @scene only for location and lighting. Borrow only the motion rhythm from @motion, not identity or costume.
```

## Fight Construction

Use one main exchange per short clip:

```text
start state -> commitment -> dodge/block/contact -> strongest peak -> reaction -> recovery/end state
```

For complex ideas, split into beats instead of packing all actions into one sentence.

## Timing Templates

### 8 seconds

```text
0-1.5s establish fighters, distance, direction
1.5-3s first attack or approach
3-5.5s dodge/block/counter with clear body path
5.5-8s consequence and final pose
```

### 12 seconds

```text
0-2s wide establishing shot of arena, both fighters, distance, and threat
2-4s first commitment, stance shift, weapon or body preparation
4-7s main exchange, readable path, block/dodge/contact
7-10s strongest impact or reversal, visible reaction and environment response
10-12s recovery and final held image
```

### 15 seconds

```text
0-3s establish space, power relation, and direction
3-6s first action beat
6-9s escalation or mistake
9-12s strongest peak
12-15s aftermath, recovery, final icon
```

## Camera Plan

- Use wide or medium for peak contact.
- Use close-up for preparation, grip, eye, trigger, or injury detail.
- Use one main camera motion per shot.
- Use tracking for chase and travel.
- Use locked-off or slow push-in for tension.
- Avoid shaking the camera during the action peak.

## Prompt Block Template

```text
Duration [X] seconds. [Reference binding sentence if any].
0:00-0:02 [establishing shot and spatial relation].
0:02-0:04 [preparation and body support].
0:04-0:07 [main exchange with clear path].
0:07-0:10 [strongest peak with reaction].
0:10-0:12 [aftermath and final hold].
Camera: [shot size, movement, readability rule].
Motion: [support, weight, recoil, recovery].
Sound: [footstep, weapon, breath, impact, silence].
Style: [visual style, material, lighting, color].
```

## Fight Type Notes

### Sword fight

Mention stance, blade path, parry angle, footwork, rebound, recovery.

### Heavy weapon

Mention wind-up, two-handed grip, body following weapon inertia, delayed braking.

### Martial arts

Mention footwork, hip rotation, level change, contact point, body reaction.

### Chase

Mention travel direction, obstacle, distance change, camera tracking, final escape/catch state.

### Superpower fight

Mention source, buildup, release path, target reaction, environmental consequence, residue.

### Monster / giant fight

Mention scale, threat path, human response angle, ground reaction, debris, final state.

## Iteration Diagnosis

If fixing a failed generation, use:

```text
Observed failure:
Keep:
Change one variable:
New timing:
New camera rule:
New negative constraint:
Next test prompt:
```

Change only one or two major variables per iteration.

## Negative Constraints

```text
no chaotic motion, no unreadable fight, no unclear hit, no broken limbs, no teleporting positions, no random camera shake, no excessive blur, no duplicated weapons, no identity drift, no missing reaction, no weightless impact, no too many attacks in one shot, no final pose missing
```

## Generation Checklist

- Is there one strongest peak?
- Can the viewer understand start, path, and end?
- Is body support visible?
- Does contact create reaction?
- Is the camera stable during the peak?
- Are references assigned to roles?
- Is identity repeated enough?
- Are negative constraints specific?
