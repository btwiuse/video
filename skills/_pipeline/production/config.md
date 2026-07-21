# Production Config

## Audio Mixing Levels
dialogue_volume: 0.7
ambience_volume: 0.12
sfx_volume: 0.5
bgm_volume: 0.17

## Video Output
output_fps: 24
output_resolution: 864x480
output_codec: libx264
output_audio_codec: aac
output_bitrate: 8000k

## Subtitle Style
subtitle_fontsize: 48
subtitle_font: Arial-Bold
subtitle_color: white
subtitle_stroke_color: black
subtitle_stroke_width: 2

## Transition Rules
# C (time jump) and D (scene change) → crossfade, others → hard cut
crossfade_types: C, D
crossfade_duration: 0.5

## Scene Type Classification Keywords
action_keywords: "追逐", "战斗", "动作", "chase", "fight"
sad_keywords: "告别", "死亡", "葬礼", "哭", "分手"
happy_keywords: "笑", "聚会", "庆祝"

## Emotion → ElevenLabs Voice Settings
emotion_soft: stability=0.5, similarity_boost=0.7, style=0.2
emotion_loud: stability=0.3, similarity_boost=0.8, style=0.6
