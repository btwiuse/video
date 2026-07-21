# IM2 Material + Clean Prompt Recipes

Use these recipes as prompt-ready patterns. Keep the user's concept intact; modify the material, texture, lighting, exposure, and artifact-control layer.

## Universal material-clean pass

Positive layer:

```text
physically distinct material classes, protected highlight texture, smooth cinematic highlight rolloff, readable shadow-side structure, localized contact shadows, distance- and roughness-correct reflections, motivated grazing light, restrained atmosphere, subtle finishing, clean rendering, balanced detail, realistic detail only, natural texture only, controlled material rendering, clean gradients, soft diffused lighting, controlled highlights, subtle reflections only, matte or natural surfaces, clean blurred background, minimal repetitive patterns
```

Avoid layer:

```text
no watermark, no signature, no ghost texture, no latent artifacts, no repetitive micro-pattern noise, no hidden marks, no low-contrast residual textures, no dirty texture buildup, no muddy shadows, no noisy bokeh, no uniform plastic gloss, no pasted-on texture, no dirty AO halos, no milky reflections, no clipped highlights, no crushed blacks
```

## Portrait recipe

```text
[subject and identity], [pose/expression], [wardrobe/environment/style]. Natural facial planes, clean eye highlights, matte skin with soft specular highlights, subtle pore texture and peach fuzz only where visible, hair grouped into readable strands, fabric weave only on close visible cloth, protected highlight texture, smooth highlight rolloff, soft diffused key light with gentle bounce, clean rendering, balanced detail, controlled material rendering, clean gradients, controlled highlights, clean blurred background, minimal repetitive patterns.
Avoid: waxy skin, dirty pore noise, hidden face marks, ghost texture, latent artifacts, noisy bokeh, low-contrast residual textures, watermark-like marks, uniform plastic gloss.
```

## Dark scene recipe

```text
[subject and action] in [dark environment]. Smooth dark tones with readable shadow floor, clean value separation around the silhouette, low texture background, controlled rim light, localized contact shadows, protected highlight texture, subtle reflections only on intended surfaces, clean rendering, balanced detail, natural texture only, controlled highlights, minimal repetitive patterns.
Avoid: muddy shadows, noisy bokeh, background artifacts, ghost texture, latent artifacts, hidden marks, low-contrast residual textures, over-sharpened grime, dirty AO halos, crushed blacks.
```

## Fantasy / dense scene recipe

```text
[hero subject] in [fantasy environment], large readable shape groups, detail reserved for focal architecture and hero props, physically distinct stone/metal/fabric/skin responses, clean atmospheric depth, protected highlight texture, localized contact shadows in seams and overlaps, natural texture only where the camera can read it, clean gradients, soft diffused lighting, controlled highlights, minimal repetitive patterns.
Avoid: repeated micro ornaments, random tiny symbols, dirty texture buildup, hidden marks, ghost texture, latent artifacts, low-contrast residual textures, muddy background noise, identical roughness across all surfaces.
```

## Painterly / ink / NPR recipe

```text
[subject], [composition], [chosen painterly or ink style]. Intentional brush edges, clean negative space, controlled pigment texture, readable silhouette, material response preserved through value and edge behavior, selective fine detail on focal forms only, smooth tone transitions, controlled highlights, clean rendering, balanced detail.
Avoid: random speckle, muddy texture buildup, repeated micro-patterns, dirty ink residue, ghost texture, latent artifacts, hidden watermark-like marks, pasted texture.
```

## Product / poster / cover recipe

```text
[product or poster subject], clean silhouette, protected text/logo area, polished spacing, smooth gradients, physically distinct product materials, distance- and roughness-correct reflections, protected highlight texture, controlled material rendering, realistic detail only on the hero surface, soft diffused lighting, controlled highlights, subtle reflections only, minimal repetitive patterns, premium clean finish.
Avoid: faux watermark, hidden lettering, dirty texture buildup, random micro-pattern noise, ghost texture, latent artifacts, low-contrast residual textures, messy background artifacts, milky reflections, clipped highlights.
```

## Vehicle / hard-surface recipe

```text
[vehicle or hard-surface object] in [environment]. Intact readable silhouette, matte and satin panels separated by roughness and highlight width, worn edges only where hands, boots, airflow, or road contact would touch, micro-scratches and dust trapped in seams only, localized contact shadows under tires and panels, protected highlight texture, controlled reflections obeying distance and roughness, clean rendering, balanced detail, natural texture only.
Avoid: random damage, chaotic grime everywhere, uniform glossy metal, showroom-plastic surface, dirty AO halos, ghost texture, latent artifacts, repeated micro-pattern noise.
```

## Same-color / monochrome recipe

```text
Although the palette is restrained, every major surface remains distinct through physical response: [surface A] is [value/temperature/material/roughness], [surface B] is [different response], and [surface C] is [different response]. Separate them with grazing light, controlled highlight width, contact shadows, edge response, and depth-dependent contrast rather than new colors or heavy outlines. Add clean rendering, balanced detail, natural texture only, minimal repetitive patterns.
Avoid: objects merging into one plastic mass, identical roughness, identical highlight width, random accent colors, black outlines around every object, dirty texture buildup, latent artifacts.
```

## Cleanup rewrite pattern for a dirty output

When the user says an output is dirty, do not ask the model to only "remove the dirt from this image." Build a new clean-slate prompt:

```text
Regenerate the same concept as a clean-slate image: [lock subject, pose, composition, style, palette]. Preserve the main design and mood, but rebuild the rendering with physically distinct material classes, clean material separation, protected highlight texture, smooth highlight rolloff, localized contact shadows, balanced detail, realistic detail only, natural texture only, controlled highlights, clean gradients, smooth background tones, and minimal repetitive patterns.
Avoid: ghost texture, latent artifacts, hidden watermark-like marks, dirty texture buildup, repeated micro-pattern noise, muddy shadows, noisy bokeh, low-contrast residual textures, uniform plastic gloss, pasted-on texture, dirty AO halos.
```
