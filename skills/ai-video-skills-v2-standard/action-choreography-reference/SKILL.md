---
name: action-choreography-reference
description: Action choreography and movement-physics helper for AI video prompts, fight scenes, weapon scenes, chase scenes, character PV action, stunt-like motion, impact readability, and anti-weightless-action fixes. Use when a scene involves body movement, martial arts, sword or weapon handling, dodging, blocking, running, jumping, falling, collision, recoil, recovery, or when the action feels fake, floaty, chaotic, unclear, or physically disconnected.
---

# Action Choreography Reference

## Core Role

Turn a vague action idea into visible, filmable movement. Build the action from support, center of mass, line of travel, timing, contact, reaction, and recovery before adding style words.

Do not solve action by adding only `fast`, `dynamic`, `powerful`, `cinematic`, or camera shake. Describe what the body and object actually do.

## Movement Construction

For every important action beat, define:

```text
actor: who initiates the movement?
objective: hit, dodge, block, redirect, close distance, escape, reveal, disarm, transform?
support: feet, hand, wall, weapon, ground slide, jump arc, partner, vehicle?
center path: forward, backward, diagonal, circular, rising, dropping, pulled off-axis?
force source: step, hip turn, shoulder torque, falling weight, recoil, elastic pull, engine thrust?
line and angle: direct line, off-line cut, flank, high-low change, inside/outside angle?
contact relation: hit, graze, parry, bind, trap, near miss, push, pull, lock, release?
reaction: body displacement, weapon rebound, stagger, shield deformation, dust, debris, sound?
end state: stable, kneeling, sliding, overextended, recovered, reversed, separated?
```

## Body Mechanics Rules

- A strong attack usually starts from the ground: foot pressure, leg drive, hip turn, torso rotation, shoulder/arm/weapon path.
- A dodge needs an angle, not just speed. State whether it moves off the attack line, drops under it, slips outside it, or pivots around it.
- A block should cost something: arm compression, step back, sliding foot, weapon vibration, sparks, shield dent, shoulder recoil.
- A heavy strike needs preparation and braking. It should not start instantly and stop instantly.
- A light/agile character should win through angle, timing, leverage, or redirection rather than directly stopping a giant force.
- A heavy/armored character may absorb more force, but the impact must travel into stance, feet, ground, armor, or prop.
- Every hit changes both sides or the environment. If nothing changes, the impact will feel fake.

## Weapon Weight Guide

### Light blade / dagger

```text
quick wrist-led path, short acceleration, small recovery, fast re-angle, close-range footwork
```

### Sword / katana / saber

```text
step and hip rotation lead the cut, blade arc remains readable, recovery follows the cut direction
```

### Spear / staff

```text
line control, thrust path, hand spacing, recoil, retraction, distance advantage
```

### Heavy sword / axe / hammer

```text
visible wind-up, two-handed grip or braced stance, body follows weapon inertia, heavy braking and delayed recovery
```

### Chain / whip / cable

```text
anchor point, delayed wave, tension line, wrap or snap, visible pull direction, clear release
```

## Fight Beat Families

### Off-line counter

```text
attacker commits to a straight line -> defender cuts outside the line -> counter lands from the flank -> attacker turns late and loses balance
```

### Heavy impact exchange

```text
wind-up -> braced contact -> compression / slide / recoil -> environment response -> slow recovery
```

### Chase evasion

```text
pursuer owns speed -> target changes level or angle -> obstacle interrupts line -> camera preserves direction -> distance changes clearly
```

### Partner action

```text
partner A creates angle or opening -> partner B uses that window -> both react to the same force -> shared end pose proves cooperation
```

## Prompt-Ready Output Format

```text
Action objective:
Spatial line:
Support and center of mass:
Weapon/body path:
Impact or near miss:
Reaction and consequence:
Recovery / end state:
Prompt-ready sentence:
Negative constraints:
```

## Prompt Sentence Patterns

```text
The fighter plants the rear foot, rotates the hips, and drives the blade in a clear low-left to high-right arc; the opponent's guard absorbs the hit, slides back half a step, the blade vibrates from the contact, dust kicks from both feet, and the attacker finishes in a braced recovery pose.
```

```text
The runner does not outrun the attack directly; she drops her center of mass, cuts diagonally under the swinging arm, lets the strike pass behind her shoulder, then pushes off the wall to exit on the enemy's blind side.
```

```text
The cable weapon anchors around the enemy's wrist first, then tightens as the user circles left; the pull redirects the enemy's shoulder line and forces a stagger before the follow-up strike begins.
```

## Common Failure Fixes

- **Weightless action**: add foot pressure, inertia, recoil, braking, and recovery.
- **Messy fight**: reduce to one main exchange and one reaction.
- **No impact**: specify what moves after contact.
- **Teleporting positions**: keep one screen direction and describe the travel path.
- **Weapon floats**: define hand grip, balance point, arc, and recovery.
- **Character overpowered by mistake**: align success method with strength level.

## Negative Constraints

```text
no random flailing, no teleporting, no unclear contact, no impossible body twist, no weightless weapon, no camera shake hiding the action, no hit without reaction, no impact without environment or body consequence, no action that changes direction without visible support
```
