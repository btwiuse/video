# Quirks

## StepFun content moderation blocks certain character names

**Step**: Step 2 — start frame generation via StepFun API

**Symptom**: HTTP 451 `"内容审核未通过"` on start frame prompts that contain specific character names. Other prompts (character portraits, scene refs) with the same names pass fine.

**Root cause**: StepFun's name-based keyword filter. Verified:
- `"鲍勃"` alone → 451
- `"安娜"` → OK
- `"鲍勃坐在沙发上看报纸"` → 451
- `"男人坐在沙发上"` → OK

**Investigated but rejected fix**: Replacing character names with `"某人"` in the prompt before sending to StepFun. Too aggressive — degrades prompt quality and breaks name-specific visual descriptions (clothing, hair, features tied to a named character).

**Status**: unresolved. Options for future:
1. Map character names to generic descriptors per character (e.g. "中年男人" / "年轻女人") using gender/age from character .md files
2. Replace only known-blocked names (not all names)
3. Switch to a different image provider without name-based filtering
