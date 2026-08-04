"""Regression tests for streamed DeepSeek function-call recovery."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from config import config
from src.step1_script_breakdown import StoryboardGenerator


TOOL = {
    "type": "function",
    "function": {
        "name": "define_character",
        "parameters": {
            "type": "object",
            "required": ["ref_id", "name"],
        },
    },
}


def _stream_for_arguments(arguments: str):
    """Return a minimal OpenAI-compatible stream split over two deltas."""
    midpoint = len(arguments) // 2
    pieces = (arguments[:midpoint], arguments[midpoint:])
    return [
        SimpleNamespace(
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(
                        content=None,
                        reasoning_content=None,
                        tool_calls=[
                            SimpleNamespace(
                                index=0,
                                function=SimpleNamespace(
                                    name="define_character" if i == 0 else None,
                                    arguments=piece,
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        for i, piece in enumerate(pieces)
    ]


class _Completions:
    def __init__(self, streams):
        self.streams = iter(streams)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return next(self.streams)


class Step1ToolCallResilienceTests(unittest.TestCase):
    def _generator(self, streams):
        completions = _Completions(streams)
        generator = object.__new__(StoryboardGenerator)
        generator.model = "test-model"
        generator.client = SimpleNamespace(
            chat=SimpleNamespace(completions=completions),
        )
        return generator, completions

    def test_retries_malformed_stream_and_preserves_raw_payloads(self):
        generator, completions = self._generator([
            _stream_for_arguments('{"ref_id":"秦泰"'),
            _stream_for_arguments('{"ref_id":"秦泰","name":"秦泰"}'),
        ])

        with TemporaryDirectory() as temp_dir, \
             patch("src.step1_script_breakdown.ensure_output_dir", return_value=Path(temp_dir)), \
             patch.object(config, "DEEPSEEK_TOOL_MAX_ATTEMPTS", 2), \
             patch.object(config, "DEEPSEEK_RETRY_BASE_DELAY_SEC", 0):
            result = generator._call_tool("system", "user", TOOL, "秦泰")

            self.assertEqual({"ref_id": "秦泰", "name": "秦泰"}, result)
            self.assertEqual(2, len(completions.calls))
            self.assertEqual(
                {"type": "function", "function": {"name": "define_character"}},
                completions.calls[0]["tool_choice"],
            )
            raw_files = sorted(Path(temp_dir).glob("*.json"))
            self.assertEqual(2, len(raw_files))
            self.assertIn('"ref_id":"秦泰"', raw_files[0].read_text(encoding="utf-8"))

    def test_incomplete_tool_json_is_never_repaired(self):
        self.assertIsNone(
            StoryboardGenerator._parse_complete_tool_arguments('{"ref_id":"秦泰"')
        )


if __name__ == "__main__":
    unittest.main()
