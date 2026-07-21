---
name: im2-clean-image
description: "Default material, clean-rendering, and negative-prompt hygiene layer for IM2 / GPT Image 2 / gpt-image-2 / image_gen image generation and editing. Use for IM2 image output, redraws, clean image, artifact cleanup, negative prompt, avoid list, material quality, texture, lighting, or surface realism; also for Chinese requests meaning shengtu/chutu/bu-zang/qu-zang/fan-zang-tu/fumian-ci/fuxiang-ci/caizhi/guangying. Prevents noise, ghost texture, latent artifacts, repeated micro-patterns, watermark-like marks, muddy dark backgrounds, dirty bokeh, flat fake materials, plastic gloss, pasted textures, bad negative-prompt contamination, and high-frequency grime. Applies a material-light stack, controlled-detail workflow, and targeted avoids while preserving subject and style."
---

# IM2 Clean Image

## Purpose

Apply this as the default finalization layer before any IM2 / gpt-image-2 image prompt. The layer has three inseparable parts:

1. **Material-light layer:** make the image physically believable through hero surfaces, surface response, lighting, exposure, and material separation.
2. **Clean anti-artifact layer:** keep those materials clean and controlled so detail does not turn into dirty latent residue.
3. **Negative-prompt hygiene layer:** keep avoid words targeted and non-contaminating; never let the negative slot become a memory of old failures or a list of concepts that accidentally summon themselves.

Keep the user's subject, composition, style, and mood. Do not simplify the idea just to make it clean. Do not rely on generic `8K`, `high resolution`, `ultra realistic`, or `sharp details` as substitutes for material physics.

## Default Prompt Order

Build IM2 prompts in this order:

1. Subject, identity, pose, action, setting, composition, aspect ratio.
2. Style or medium, if the user requested one.
3. **Material-light layer:** hero surfaces, light behavior, surface response, exposure, contact shadows, and optics.
4. **Controlled-detail clean layer:** clean rendering, balanced detail, natural texture only, controlled highlights, minimal repeated patterns.
5. **Negative hygiene layer:** compact targeted avoid block for broad artifact, style-drift, anatomy/structure, and fake-material failures.

## Required Material-Light Pass

Before adding the anti-dirty phrases, add a compact material layer that answers the following. Keep it proportional: a simple portrait may need one sentence; a complex vehicle, product, fantasy scene, or action still may need several.

- **Hero surfaces:** name the main visible materials: skin, hair, fabric, leather, metal, glass, ceramic, wet ground, dust, smoke, paper, plastic, foliage, etc.
- **Surface response:** define matte, satin, glossy, translucent, rough, worn, wet, dry, dusty, scratched, reflective, or absorbing areas.
- **Light behavior:** define key light direction and color temperature; add rim, bounce, practical, or grazing light only when useful.
- **Material separation:** if surfaces share one color, separate them by value, temperature, roughness, highlight width, edge response, translucency, contact shadows, and depth contrast, not random new colors.
- **Exposure architecture:** protect highlight texture, smooth highlight rolloff, readable shadow floor, and intended accent color without clipping.
- **Grounding:** use localized AO/contact shadows only in true seams, overlaps, creases, and contact zones; avoid dirty AO halos.
- **Optics:** choose restrained depth of field, lens diffusion, reflection, motion blur, or atmosphere only when it supports the image.

Material sentence skeleton:

```text
The [hero material] shows [physical behavior] under [lighting condition], with [local imperfections/topology] visible at [camera scale]; [specific areas] remain [matte/dry/absorbing] while [specific edges/surfaces] catch [soft/sharp/specular/anisotropic] highlights.
```

Universal material quality block:

```text
physically distinct material classes, protected highlight texture, smooth cinematic highlight rolloff, readable shadow-side structure, localized contact shadows, distance- and roughness-correct reflections, motivated grazing light, restrained atmosphere, subtle finishing
```

## Default IM2 Clean Workflow

1. Lock the user's intent. Preserve subject, identity, pose, environment, aspect ratio, style, and key props.
2. Add the material-light layer first. Clean images still need physical material behavior; otherwise they become flat, plastic, or posterized.
3. Scan for dirty-risk wording. Treat these as risk signals: `ultra detailed`, `hyper detailed`, `insanely detailed`, `micro detail everywhere`, `highly textured`, `wet glossy`, `cinematic bokeh everywhere`, dense dark background, busy fantasy architecture, ink/oil hybrid, character sheet, repeated ornaments, or many small marks.
4. Replace risky detail language. Prefer controlled detail phrases instead of stacking more detail.
5. Add the clean rendering layer after material language.
6. Build the avoid block with negative hygiene. Keep it short, targeted, and current-risk based.
7. Use clean-slate regeneration for dirty outputs. If an output already has ghost texture, dark watermark feel, hidden marks, or low-contrast residue, rewrite and regenerate cleanly. Avoid repeated image-to-image cleanup unless the user explicitly asks, because iterative passes often amplify latent grime.

## Negative-Prompt Hygiene

Use this layer every time an IM2 prompt includes an `Avoid`, `Negative prompt`, or `no ...` list.

Core rule: **the negative slot is not a memory of old failures.** It is only a compact constraint slot for likely broad failure classes that cannot be expressed better as positive visible facts.

1. Positive lock first. Before writing `no X`, ask what should visibly appear instead.
2. Keep negatives broad and reusable: artifact classes, extra-body/extra-object failures, style drift, text/watermark, material fake-look, composition clutter.
3. Do not name old failed props, characters, locations, colors, actions, or styles in the negative block. Old-specific negatives can contaminate the new image.
4. Avoid denied nouns that are not part of the target shot. If the forbidden object is not already likely, describing it may summon it.
5. Keep essential negatives in the constraint slot only, never scattered through the positive prompt.
6. Prefer one compact line over a long laundry list. Too many negatives dilute the positive image and create associations.

Safe default avoid block:

```text
Avoid: dirty texture buildup, random micro-pattern noise, hidden watermark-like marks, ghost texture, latent artifacts, muddy shadows, noisy bokeh, low-contrast residual textures, over-sharpened grime, uniform plastic gloss, pasted-on texture, milky reflections, clipped highlights, crushed blacks, dirty AO halos, malformed anatomy when people are present, stray text or logo unless requested.
```

Use narrower blocks when possible:

```text
Avoid: ghost texture, latent artifacts, hidden watermark-like marks, repeated micro-pattern noise, muddy shadows, noisy bokeh, pasted-on texture.
```

## Default Add-ons

Full cleanup add-on:

```text
clean rendering, balanced detail, realistic detail only, natural texture only, controlled material rendering, clean gradients, soft diffused lighting, controlled highlights, subtle reflections only, matte or natural surfaces, clean blurred background, minimal repetitive patterns, no watermark, no signature, no ghost texture, no latent artifacts, no repetitive micro-pattern noise, no hidden marks, no low-contrast residual textures
```

Short cleanup add-on for tight prompts:

```text
clean rendering, balanced detail, realistic detail only, natural texture only, controlled highlights, clean blurred background, minimal repetitive patterns, no watermark, no ghost texture, no latent artifacts, no low-contrast residual textures
```

## Risky Phrase Replacements

Use these substitutions before adding more prompt length:

| Replace | With |
|---|---|
| `ultra detailed` | `balanced detail` |
| `hyper detailed` | `selective fine detail` |
| `insanely detailed` | `realistic detail only` |
| `micro detail everywhere` | `detail concentrated only on meaningful surfaces` |
| `highly textured rendering` | `controlled material rendering` |
| `wet glossy` | `subtle reflections with strict wet/dry boundaries` |
| `glossy reflective` | `controlled highlights and roughness-correct reflections` |
| `cinematic bokeh background` | `clean blurred background` |
| `dark atmospheric background` | `smooth dark tones with low texture background` |
| `beautiful lighting` | `motivated key light, controlled bounce, protected highlight texture` |
| `realistic texture` | `physically distinct material response with natural texture only` |
| `no blur` | `sharp hero silhouette with clean intentional depth of field` |
| `no clutter` | `clean negative space and organized background shapes` |
| `no extra people` | `single clearly framed subject, empty surrounding space` |
| `no weapon` | `empty relaxed hands visible, no held objects` only when weapons are already likely |

## Conditional Material Modules

Add only the modules that match the image:

- Faces / portraits: `natural facial planes, matte skin with soft specular highlights, subtle pores and peach fuzz only where visible, clean eye highlights, no waxy gloss, no dirty pore noise`.
- Fabric / clothing: `geometry-aware weave or knit structure, fibers following folds, grazing light revealing raised texture, no flat printed texture`.
- Metal / weapons / machinery: `roughness variation, worn edges catching narrow anisotropic highlights, oxidized or matte flats absorbing light, no uniform chrome gloss`.
- Glass / water / glossy product: `strict reflection boundaries, distance- and roughness-correct reflections, transparent or glossy surfaces only where physically motivated, no milky global mirror floor`.
- Stone / ceramic / architecture: `matte porous response, chipped or worn edges only where exposed, contact shadows in seams, no random dirty speckle`.
- Wet street / rain: `strict dry/wet boundaries, dry asphalt stays dark and absorbing, shallow puddles carry controlled specular reflections, no global wetness`.
- Dark or black backgrounds: `smooth dark tones, readable shadow floor, clean value separation, low texture background, controlled rim light, no noisy bokeh`.
- Fantasy / dense concept art: `large readable shape groups, detail reserved for focal architecture and hero props, clean atmospheric depth, no repeated micro ornaments`.
- Ink, oil, painterly, NPR: `intentional brush edges, clean negative space, controlled pigment texture, readable silhouette, no random speckle, no muddy texture buildup`.
- Products / posters / covers: `clean silhouette, protected logo/text area, polished spacing, smooth gradients, realistic detail only on hero surface, premium clean finish`.

## Output Shape

For prompt rewrites, return:

```text
Prompt:
[subject/style/composition]
[material-light layer]
[controlled-detail clean layer]

Avoid:
[targeted negative block]
```

For diagnosis or iteration, return:

```text
Material + dirty-risk + negative diagnosis:
- Missing material controls:
- Risk words:
- Negative contamination risk:
- Risk surfaces/background:
- Cleanup strategy:

Rewritten IM2 prompt:
...

Avoid:
...
```

## References

- Read `references/clean-prompt-recipes.md` when doing a substantial IM2 prompt rewrite, building a prompt batch, diagnosing a dirty output, or adapting the material-clean layer to portraits, dark scenes, fantasy scenes, posters, or product images.
- Read `references/negative-prompt-hygiene.md` when a request includes a negative prompt, many `no ...` constraints, a failed-output retry, old project contamination, or any prompt where denied words may summon unwanted content.

