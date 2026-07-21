---
name: ai-material-realism
description: Material realism and clean rendering helper for AI image/video prompts, character design, product shots, cinematic scenes, action videos, and generated-output diagnosis. Use when a prompt needs believable materials, lighting, contact shadows, surface roughness, optics, texture control, anti-plastic/anti-muddy rendering, or when results look dirty, overexposed, waxy, fake, mushy, or AI-generated.
---

# AI Material Realism

## Core Role

Make images and videos feel physically believable. Define material, light, shadow, lens, texture, and contact before adding decorative style words.

## Material Stack

For each important object, define:

```text
base material: ceramic, metal, fabric, leather, skin, glass, stone, plastic, wood
surface finish: matte, satin, glossy, brushed, polished, rough, worn, wet, dusty
edge behavior: chipped, beveled, sharp, worn, glowing, scratched
reflection: none, soft, sharp, anisotropic, mirror-like, diffused
transparency: opaque, translucent, frosted, clear, subsurface
contact: shadow, compression, dust, reflection, occlusion, footprint, indentation
```

## Lighting Rules

- White objects need shadow and roughness to avoid becoming blank.
- Black objects need edge light and texture to avoid becoming flat holes.
- Glossy surfaces need controlled highlights, not random shine everywhere.
- Metal should reflect environment color and have stronger edge highlights.
- Fabric should show weave, folds, compression, and thickness.
- Glass needs refraction, reflection, edge visibility, and background distortion.
- Skin needs subtle variation, pores, subsurface softness, and correct contact shadows.

## Clean Render Checklist

```text
subject silhouette is readable
main material has named finish
highlights are controlled
shadows touch the ground or surrounding objects
texture scale matches object scale
motion blur does not erase identity
no random grime unless story requires it
color palette is limited and intentional
```

## Prompt Pattern

```text
Materials: [main object] is made of [material] with [surface finish], [edge behavior], and [highlight behavior]. Lighting is [soft/hard/directional] with clear contact shadows and controlled reflections. Texture remains clean and scale-accurate; no muddy noise or random stains.
```

## Action Material Notes

- Add dust, sparks, cracks, cloth pull, armor compression, or blade vibration only where contact happens.
- Motion blur should follow the moving part, not smear the whole frame.
- Heavy impacts need debris or deformation; light contacts need smaller material response.
- Do not use particles to hide unclear action.

## Common Fixes

- **Muddy image**: reduce palette, remove random dirt, define material finish.
- **Plastic skin/armor**: add roughness, edge wear, subsurface or brushed highlight.
- **Overexposed white**: add satin roughness, ambient occlusion, bevel shadows.
- **Flat black**: add rim light, subtle texture, narrow highlights.
- **Fake glass**: add reflections, refraction, edge lines, and background distortion.
- **AI noise**: request clean surfaces, large simple forms, controlled detail density.

## Negative Constraints

```text
no muddy texture, no random grime, no plastic skin, no waxy surface, no overexposed whites, no crushed blacks, no noisy micro-detail, no shapeless reflections, no floating objects without contact shadow, no motion blur hiding the subject
```
