---
name: action-rhythm-editing
description: Action timing, editing rhythm, beat map, impact timing, slow motion, hit-stop, recovery, music sync, and pacing helper for AI video action, fight, chase, weapon scenes, character PVs, and action showcases. Use when action is rushed, flat, weightless, too uniform, unreadable, lacking peak, or when a 3s/5s/8s/12s/15s action structure is needed.
---

# Action Rhythm Editing

## Core Role

Make action readable through time. A good action beat is not only movement; it has setup, anticipation, acceleration, peak, reaction, follow-through, braking, and recovery.

Rhythm does not replace choreography. First confirm the body path, then time it.

## Universal Beat Curve

```text
readable setup -> anticipation -> acceleration -> peak / contact / near miss -> reaction -> follow-through -> recovery / hold
```

## Timing Principles

- Give the viewer enough time to read the starting state.
- Put a tiny pause before the strongest attack or reveal.
- Put the fastest motion into the shortest window.
- Put visible reaction after impact.
- Heavy actions need longer anticipation and longer recovery.
- Agile actions can have shorter contact and faster re-angle.
- A final pose needs a hold, even if brief.

## Duration Templates

### 3 seconds: one action only

```text
0.0-0.5s establish stance and direction
0.5-1.1s anticipation
1.1-1.8s peak action
1.8-2.4s reaction / follow-through
2.4-3.0s recovery hold
```

### 5 seconds: one exchange

```text
0.0-0.8s establish distance
0.8-1.6s first commitment
1.6-2.7s main strike / dodge / block
2.7-3.8s reaction and physical cost
3.8-5.0s recovery, new power relation, final image
```

### 8 seconds: setup + reversal

```text
0.0-1.2s establish space and threat
1.2-2.6s first action path
2.6-4.0s opponent response or dodge
4.0-5.8s strongest peak or reversal
5.8-8.0s consequence and final hold
```

### 12 seconds: short fight

```text
0-2s geography, characters, direction, threat
2-4s first commitment
4-7s exchange / dodge / block
7-10s strongest peak
10-12s consequence, recovery, final pose
```

### 15 seconds: mini sequence

```text
0-3s establish world, scale, characters, direction
3-6s first action beat
6-9s escalation or reversal
9-12s strongest action peak
12-15s aftermath, recovery, final icon
```

## Rhythm Families

### Sharp

Fast anticipation, crisp peak, short recovery. Useful for daggers, close counters, snappy anime impacts.

### Heavy

Longer wind-up, slower acceleration at the start, huge contact, delayed recovery. Useful for axes, hammers, giant monsters, armored characters.

### Graceful

Continuous arcs, elegant follow-through, longer body line. Useful for dance-like swordplay, wuxia, character PV.

### Pressure

Short recovery, overlapping threats, repeated forced reactions. Useful for chase, horror pursuit, battlefield pressure.

### Mechanical

Start-up, lock, release, recoil, servo stop. Useful for mecha, exosuits, transforming weapons.

## Editing and Camera Rhythm

- Cut on action only when the next shot continues the same movement direction.
- Use close-up for anticipation or detail, not to hide the main action.
- Use wide/medium shot for contact and body reaction.
- Slow motion should reveal a critical instant: near miss, blade contact, foot slip, grip change, eye decision, final impact.
- Avoid constant high-speed motion. Contrast makes speed feel faster.

## Sound Timing

Map sound to physical cause:

```text
breath before action
foot plant at commitment
cloth/servo/weapon whoosh during acceleration
impact hit at peak
debris / echo / metal ring after contact
silence or bass drop before major reveal
```

## Prompt Output Shape

```text
Duration:
Main peak:
Timing map:
Rhythm family:
Camera rhythm:
Sound / music hit points:
Prompt-ready timing block:
Negative constraints:
```

## Negative Constraints

```text
no constant same-speed motion, no endless spinning, no impact without pause or reaction, no overlong slow motion, no random cuts, no action hidden by blur, no peak before the audience understands the setup
```
