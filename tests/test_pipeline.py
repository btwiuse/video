"""
Short test script for pipeline validation.

A minimal 2-scene screenplay to test the full pipeline end-to-end.
"""

TEST_SCRIPT = """
场景 1：公寓客厅 - 雨夜

内景，安娜的公寓客厅，晚上 9 点。

窗外下着中雨，雨水顺着玻璃流淌。远处偶尔有车驶过湿路面。

安娜（32 岁，短发深棕，穿灰色羊毛外套）推门进来。她在门口停顿了一下，放下还在滴水的深蓝色雨伞。她的左眉上方有一颗小痣。

安娜走到茶几前，低头看着茶几上的一只空杯子。杯口有淡色唇印。她盯着杯子看了几秒，表情复杂。右手无意识地摩挲着左手腕上的一道旧伤疤。

安娜
（轻声，犹豫）
我不确定我该回来。

鲍勃（41 岁，短发灰白，微胖）坐在沙发上，穿着微皱的藏蓝衬衫，右手戴着银色机械表。他看着安娜，手指在膝盖上轻敲了两下。

鲍勃
（沙哑，语速偏快）
都过去了。坐下吧。

安娜没有坐下。她走向窗边，背对着鲍勃，看着窗外的雨。

安娜
对你来说过去了。对我不是。

鲍勃站起来，走到安娜身后两步的距离，停住。

鲍勃
那你为什么要回来？

安娜转身，面对鲍勃。她的眼睛里有泪光，但语气平静。

安娜
因为我没别的地方可去。

场景切换。淡出。

场景 2：雨后街道 - 深夜

外景，公寓楼下的街道，深夜 11 点。

雨已经停了。湿漉的沥青路面反射着路灯橘黄色的光。梧桐树还在滴水。街边停着几辆车。

安娜独自走出公寓楼门。她站在路边，抬头看了一眼自己公寓的窗户——灯还亮着。然后她转身，沿着街道慢慢走远。

她的背影在路灯下拉出长长的影子，越来越远。画面缓缓定格。

淡出。结束。
"""

# Calculate expected values for tests
EXPECTED_CHARACTERS = ["ANNA", "BOB"]
EXPECTED_SCENES = ["SC_01", "SC_02"]
EXPECTED_MIN_SHOTS_PER_SCENE = 3


def test_storyboard_structure(storyboard: dict) -> None:
    """Validate storyboard output structure."""
    # Characters
    characters = storyboard.get("characters", [])
    char_names = [c.get("name", "").upper() for c in characters]
    for expected in EXPECTED_CHARACTERS:
        assert any(expected in name for name in char_names), \
            f"Expected character {expected} not found in {char_names}"
    print(f"  ✅ Characters: {len(characters)} found ({', '.join(str(c.get('name', '?')) for c in characters)})")

    # Scenes
    scenes = storyboard.get("scenes", [])
    assert len(scenes) >= len(EXPECTED_SCENES), \
        f"Expected at least {len(EXPECTED_SCENES)} scenes, got {len(scenes)}"
    print(f"  ✅ Scenes: {len(scenes)} found")

    # Shots
    shots = storyboard.get("shots", [])
    assert len(shots) >= EXPECTED_MIN_SHOTS_PER_SCENE * len(EXPECTED_SCENES), \
        f"Expected at least {EXPECTED_MIN_SHOTS_PER_SCENE * len(EXPECTED_SCENES)} shots, got {len(shots)}"
    print(f"  ✅ Shots: {len(shots)} total")

    # Check shot structure
    for shot in shots:
        assert "shot_id" in shot, f"Shot missing shot_id: {shot}"
        assert "duration_sec" in shot, f"Shot {shot.get('shot_id')} missing duration"
        assert "transition_type" in shot, f"Shot {shot.get('shot_id')} missing transition_type"
        assert "positive_prompt" in shot, f"Shot {shot.get('shot_id')} missing positive_prompt"
    print(f"  ✅ Shot structure: all shots have required fields")

    # Total duration
    total = sum(s["duration_sec"] for s in shots)
    print(f"  ✅ Total duration: {total:.0f}s ({total/60:.1f} min)")
