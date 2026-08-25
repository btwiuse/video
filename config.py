"""Configuration loaded from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # DeepSeek
    DEEPSEEK_API_KEY: str = os.getenv("DEEPSEEK_API_KEY", "")
    DEEPSEEK_BASE_URL: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    DEEPSEEK_MODEL: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")  # V3 for faster response
    DEEPSEEK_REASONING_MODEL: str = os.getenv("DEEPSEEK_REASONING_MODEL", "deepseek-reasoner")  # R1
    DEEPSEEK_TIMEOUT: int = int(os.getenv("DEEPSEEK_TIMEOUT", "600"))  # seconds
    DEEPSEEK_USE_REASONING: bool = os.getenv("DEEPSEEK_USE_REASONING", "false").lower() == "true"
    # Step 1 sends a request for each character/scene concurrently.  Keeping
    # this modest avoids intermittent malformed streamed tool calls on long
    # scripts when the upstream service is under load.
    DEEPSEEK_MAX_CONCURRENCY: int = max(1, int(os.getenv("DEEPSEEK_MAX_CONCURRENCY", "4")))
    # A tool-call response can be interrupted or contain malformed JSON even
    # when the HTTP request itself succeeded. Retry the complete request in
    # that case; never accept a repaired/truncated tool payload.
    DEEPSEEK_TOOL_MAX_ATTEMPTS: int = max(1, int(os.getenv("DEEPSEEK_TOOL_MAX_ATTEMPTS", "3")))
    DEEPSEEK_RETRY_BASE_DELAY_SEC: float = max(
        0.0, float(os.getenv("DEEPSEEK_RETRY_BASE_DELAY_SEC", "1"))
    )

    # Image generation — see src/step2_visual_assets.py for all providers
    IMAGE_PROVIDER: str = os.getenv("IMAGE_PROVIDER", "null")
    IMAGE_API_KEY: str = os.getenv("IMAGE_API_KEY", "")       # Shared image API key (Replicate, Ark, StepFun, etc.)
    STEPFUN_API_KEY: str = os.getenv("STEPFUN_API_KEY", "") or os.getenv("IMAGE_API_KEY", "")
    COMFYUI_URL: str = os.getenv("COMFYUI_URL", "http://localhost:8188")

    # Video generation — see src/step3_video_generation.py for all providers
    VIDEO_PROVIDER: str = os.getenv("VIDEO_PROVIDER", "tokenvoke")
    VIDEO_API_KEY: str = os.getenv("VIDEO_API_KEY", "") or os.getenv("IMAGE_API_KEY", "")

    # TokenVoke Seedance (https://tokenvoke.com/docs/seedance-video)
    TOKENVOKE_BASE_URL: str = os.getenv("TOKENVOKE_BASE_URL", "https://overseas.tokenvoke.com")
    # Tokease Seedance (https://tokease.cn, tokenvoke-compatible API)
    TOKEASE_BASE_URL: str = os.getenv("TOKEASE_BASE_URL", "https://tokease.cn")
    TOKEASE_API_KEY: str = os.getenv("TOKEASE_API_KEY", "") or os.getenv("VIDEO_API_KEY", "")
    VIDEO_MODEL: str = os.getenv("VIDEO_MODEL", "doubao-seedance-2-0-fast-260128")
    TOKENVOKE_MAX_DURATION_SEC: int = int(os.getenv("TOKENVOKE_MAX_DURATION_SEC", "15"))
    TOKENVOKE_MAX_IMAGES: int = int(os.getenv("TOKENVOKE_MAX_IMAGES", "9"))
    PUBLIC_URL: str = os.getenv("PUBLIC_URL", "")  # e.g. https://xxx.ufo.k0s.io, Go server behind ufo tunnel

    # Audio generation — see src/step4_audio.py for all providers
    AUDIO_PROVIDER: str = os.getenv("AUDIO_PROVIDER", "null")
    AUDIO_API_KEY: str = os.getenv("AUDIO_API_KEY", "")

    # Output
    OUTPUT_DIR: str = os.getenv("OUTPUT_DIR", "./output")

    # Skills — external domain knowledge and prompt templates
    SKILLS_DIR: str = os.getenv("SKILLS_DIR", "./skills")

    # Limits
    MAX_SCENE_DURATION_SEC: int = 600  # 10 min per scene

    # StepFun image generation
    STEPFUN_MODEL: str = os.getenv("STEPFUN_MODEL", "step-image-edit-2")
    STEPFUN_BASE_URL: str = os.getenv("STEPFUN_BASE_URL", "https://api.stepfun.com")


config = Config()
