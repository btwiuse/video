"""
Skill loader: reads domain knowledge and prompt templates from external .md files.

Two sources:
  1. SKILL.md files (domain knowledge, e.g. from ../video-skills/)
  2. _pipeline/ templates (prompt templates with {placeholder} variables)

Usage:
    sm = SkillManager()
    sm.load()
    system_prompt = sm.inject("cinematic-audiovisual-language")
    prompt = sm.get_template("image", "portrait_front").format(name="安娜", ...)
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("skills")


class Skill:
    """A single skill: domain knowledge body + optional named templates."""

    def __init__(self, name: str, description: str = "", body: str = "",
                 templates: dict[str, str] | None = None):
        self.name = name
        self.description = description
        self.body = body
        self.templates = templates or {}


class SkillManager:
    """Load, query, and inject skills from a directory of .md files."""

    def __init__(self, skills_dir: str | None = None):
        self.skills_dir = Path(skills_dir or "../video-skills").resolve()
        self._skills: dict[str, Skill] = {}

    def load(self) -> "SkillManager":
        """Scan for SKILL.md and _pipeline/ templates. Idempotent."""
        self._skills = {}
        self._load_knowledge_skills()
        self._load_pipeline_templates()
        loaded = [s for s in self._skills.values() if s.body or s.templates]
        logger.info("Loaded %d skills from %s", len(loaded), self.skills_dir)
        return self

    # ------------------------------------------------------------------
    # Internal loaders
    # ------------------------------------------------------------------

    def _load_knowledge_skills(self) -> None:
        """Scan **/SKILL.md, parse frontmatter, store body."""
        for md_path in sorted(self.skills_dir.rglob("SKILL.md")):
            text = md_path.read_text(encoding="utf-8")
            name = md_path.parent.name
            description = ""
            body = text

            if text.startswith("---"):
                end = text.find("---", 3)
                if end != -1:
                    front = text[3:end].strip()
                    body = text[end + 3:].strip()
                    for line in front.split("\n"):
                        if ":" in line:
                            key, val = line.split(":", 1)
                            k = key.strip()
                            if k == "name":
                                name = val.strip()
                            elif k == "description":
                                description = val.strip()

            self._skills[name] = Skill(
                name=name, description=description, body=body,
            )

    def _load_pipeline_templates(self) -> None:
        """Load _pipeline/<group>/<name>.md as templates."""
        pipeline_dir = self.skills_dir / "_pipeline"
        if not pipeline_dir.is_dir():
            return
        for group_dir in sorted(pipeline_dir.iterdir()):
            if not group_dir.is_dir():
                continue
            group = group_dir.name
            for file in sorted(group_dir.iterdir()):
                if file.suffix != ".md":
                    continue
                tpl_name = file.stem
                text = file.read_text(encoding="utf-8")
                if group not in self._skills:
                    self._skills[group] = Skill(name=group,
                                                description=f"{group} templates")
                self._skills[group].templates[tpl_name] = text

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def get(self, name: str) -> Optional[Skill]:
        return self._skills.get(name)

    def get_template(self, skill_name: str, template_name: str) -> str:
        """Return raw template text (with {placeholders})."""
        skill = self.get(skill_name)
        if skill and template_name in skill.templates:
            return skill.templates[template_name]
        available = list(skill.templates) if skill else []
        raise KeyError(
            f"Template '{template_name}' not found in skill "
            f"'{skill_name}'. Available: {available}"
        )

    # ------------------------------------------------------------------
    # Prompt injection
    # ------------------------------------------------------------------

    def inject(self, skill_name: str) -> str:
        """Return the full body of a skill for use in system prompts."""
        skill = self.get(skill_name)
        if skill is None:
            logger.warning("Skill '%s' not found", skill_name)
            return ""
        return skill.body

    def inject_all(self) -> str:
        """Concatenate all knowledge-skill bodies (no templates)."""
        parts = []
        for s in self._skills.values():
            if s.body:
                parts.append(f"## {s.name}\n\n{s.body}")
        return "\n\n".join(parts)

    def inject_matching(self, keywords: list[str]) -> str:
        """Inject skills whose name or description matches any keyword."""
        parts = []
        kw_lower = {k.lower() for k in keywords}
        for s in self._skills.values():
            if not s.body:
                continue
            text = (s.name + " " + s.description).lower()
            if any(k in text for k in kw_lower):
                parts.append(f"## {s.name}\n\n{s.body}")
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Convenience: replace placeholders in a template
    # ------------------------------------------------------------------

    def render_template(self, skill_name: str, template_name: str,
                        **kwargs) -> str:
        return self.get_template(skill_name, template_name).format(**kwargs)


# ------------------------------------------------------------------
# Global singleton (lazy-loaded on first access)
# ------------------------------------------------------------------

_skill_manager: Optional[SkillManager] = None


def get_skill_manager() -> SkillManager:
    """Return the global SkillManager singleton, loading on first call."""
    global _skill_manager
    if _skill_manager is None:
        from config import config
        _skill_manager = SkillManager(config.SKILLS_DIR).load()
    return _skill_manager
