"""Step 0: Script summarization via DeepSeek.

Generates a short title and summary for a screenplay script.
Used to name pipelines automatically.
"""

from openai import OpenAI
from config import config


class ScriptSummarizer:
    """Summarize a screenplay script into a title and short description."""

    def __init__(self):
        import httpx
        http_client = httpx.Client(
            timeout=config.DEEPSEEK_TIMEOUT,
            limits=httpx.Limits(max_keepalive_connections=5),
        )
        self.client = OpenAI(
            api_key=config.DEEPSEEK_API_KEY,
            base_url=config.DEEPSEEK_BASE_URL,
            http_client=http_client,
        )
        self.model = config.DEEPSEEK_MODEL

    def summarize(self, script_text: str) -> dict:
        """Return dict with 'title' and 'summary'."""
        system_prompt = """你是一位影视剧本分析师。请阅读以下剧本，生成一个简短标题和一段不超过100字的剧情摘要。

输出 JSON 格式（不要用 markdown 代码块包裹）：
{
  "title": "简短标题，不超过20字",
  "summary": "剧情摘要，不超过100字"
}

要求：
1. 标题要能概括剧本核心事件或主题
2. 摘要要简洁，包含主要人物和核心冲突
3. 只输出 JSON"""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": script_text},
            ],
            temperature=0.3,
            max_tokens=200,
            response_format={"type": "json_object"},
        )

        import json
        content = response.choices[0].message.content or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            return {"title": "Untitled", "summary": ""}


def summarize_script(script_text: str) -> dict:
    """Convenience function."""
    return ScriptSummarizer().summarize(script_text)
