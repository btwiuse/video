1. 你最终想要的完整主链路
比如：
剧本 ->分析风格（【风格：都市 古风 仙侠 萌宠 搞笑 穿越 后宫 异世界....等 风格提示词完全指南（AI导演必备）
风格提示词是AI生成中控制视觉调性的核心指令。它决定画面的美术归属、渲染质感、光影氛围、细节层次，是区分“廉价AI感”与“电影级正片”的关键。以下从六个维度详细拆解。
一、风格提示词的六大核心维度
维度作用关键要素示例关键词
1. 渲染引擎/技术基底 奠定画面基础质感，决定光照算法和材质表现 渲染器、着色模型、光照技术 虚幻引擎5、Octane渲染、Arnold、V-Ray、Cycles、PBR材质、光线追踪、全局光照、次表面散射(SSS) 
2. 美术风格归属 定义视觉流派，建立文化/时代/艺术特征 风格标签、文化元素、时代特征 3D国风CG、赛博朋克、水墨风、厚涂、二次元、吉卜力、写实、超现实主义、废土、蒸汽波 
3. 材质与细节 描述物体表面的微观质感，增强真实感或风格化 皮肤、布料、金属、毛发、磨损 真实皮肤SSS克制、发丝束各向异性高光、织物纤维清晰、刺绣金线可读、金属微磨损划痕、哑光/亮光、法线贴图、置换贴图 
4. 光影与色彩 控制情绪基调、空间深度、视觉焦点 主光方向、光质、色温、对比、特效 电影灯光、三点布光、冷暖对比、主光方向明确、轮廓光抠边、体积雾、DOF景深、Bloom克制、暗部层次、大气透视、全局光 
5. 构图与画面结构 安排视觉元素，引导视线，创造美感 构图法则、层次、空间关系 三分法、引导线、框景、对称、负空间、前中后景层次、剪影、黄金分割 
6. 纯净度与成像质量 排除技术缺陷，保证画面干净 分辨率、噪点、压缩伪影、UI 8K、超高清、无噪点、无颗粒、无压缩伪影、无水印、无文字UI、无畸变、无反光/眩光干扰 
二、详细关键词库（可组合使用）
2.1 渲染引擎/技术基底
引擎类：Unreal Engine 5， Unity， CryEngine， NVIDIA Omniverse
渲染器：Octane Render， Redshift， Arnold Renderer， V-Ray， Cycles， RenderMan
材质技术：PBR (Physically Based Rendering)， SSS (Subsurface Scattering)， Anisotropic (各向异性)， Displacement， Normal map， Metallic/Roughness workflow
光照技术：Ray tracing， Global illumination， Path tracing， HDRI lighting， Image-based lighting， Volumetric lighting
2.2 美术风格归属
国风：3D国风CG， 水墨风， 工笔重彩， 丹青， 敦煌壁画风， 武侠风， 仙侠风， 古风
写实：Photorealistic， Hyperrealistic， Cinematic， Live-action质感
幻想/科幻：Cyberpunk， Steampunk， Dieselpunk， Fantasy， Dark fantasy， Science fiction
卡通/风格化：Anime， Cel-shaded， Toon， Ghibli style， Disney style， Pixar style， Comic book style， Manga
其他：Minimalist， Surrealism， Baroque， Rococo， Art Deco， Art Nouveau
2.3 材质与细节
皮肤：Realistic skin， Pore details， SSS， Skin texture， Wrinkles， Goosebumps， Sweat， Oiliness， Makeup
毛发：Individual hair strands， Anisotropic highlights， Flyaway hairs， Fur， Lash details， Eyebrow hairs
布料：Fabric weave， Silk satin， Linen， Wool， Leather， Velvet， Embroidery， Brocade， Damask， Ripped
金属：Metallic shine， Polished， Brushed， Scratches， Patina， Rust， Worn edges， Gold， Silver， Copper
环境：Pebbles， Moss， Wood grain， Tree bark， Water ripples， Refraction， Caustics
2.4 光影与色彩
光质：Hard light， Soft light， Diffused light， Rim light， Backlight， Key light， Fill light 色温：Warm tones， Cool tones， Golden hour， Blue hour， Twilight， Neon， Monochrome， Sepia
对比：High contrast， Low contrast， Chiaroscuro， Silhouette
特效：Lens flare， God rays， Volumetric fog， Mist， Dust particles， Rain， Snow， Fireflies， Bokeh
景深：Depth of field， Shallow DOF， Focus on eyes， Background blur
2.5 构图与画面结构
构图法则：Rule of thirds， Golden ratio， Symmetry， Leading lines， Frame within frame， Negative space， Center composition， Diagonal lines
层次：Foreground， Midground， Background， Layered composition， Atmospheric perspective (大气透视)
视角：Bird's-eye view， Worm's-eye view， Over-the-shoulder， Dutch angle (倾斜镜头)
2.6 纯净度与成像质量
分辨率：4K， 8K， Ultra HD， High resolution
降噪：Noiseless， Clean image， Low noise， Grain-free
抗锯齿：Smooth edges， Anti-aliasing
无干扰：No watermark， No text， No UI， No logo， No distortion， No lens aberration
三、风格提示词的权重分配与组合技巧
3.1 权重金字塔（优先级）
层级权重内容说明
核心风格 30% 渲染引擎 + 美术风格 决定整体基底，必须放在开头或加重 
质感细节 25% 材质、毛发、皮肤 决定真实感/风格化程度 
光影氛围 25% 灯光、色彩、特效 决定情绪与空间感 
构图画面 15% 景别、构图、层次 决定视觉引导 
纯净度 5% 分辨率、去噪 保证输出质量 
3.2 权重写法示例（可灵/Pika风格）
高权重：(Unreal Engine 5:1.4)， ((3D国风CG:1.5))， [photorealistic:1.3]
中权重：PBR materials， realistic skin SSS， volumetric fog
低权重/可选：8K， no noise (通常默认即可)
3.3 组合公式
text
风格锁定 = 
【引擎基底】 + 【美术归属】 + 【材质细节】 + 【光影氛围】 + 【构图】 + 【纯净度约束】
示例（3D国风CG）：
text
Unreal Engine 5， 3D国风CG， PBR materials， realistic skin with subtle SSS， individual hair strands with anisotropic highlights， silk fabric with embroidery details， cinematic lighting with warm key light and cool fill， volumetric fog， depth of field focused on eyes， rule of thirds composition， 8K， no noise no watermark 四、负面风格提示词（必须包含）
负面提示词用于排除不想要的效果。常见的负面关键词：
text
2D， cel-shaded， anime， cartoon， painting， illustration， sketch， line art， 
lowres， blurry， pixelated， jpeg artifacts， 
distorted face， deformed， bad anatomy， extra limbs， mutated， 
watermark， signature， text， ui， 
overexposed， blown out， harsh shadows， grainy， noisy， 
cluttered background， inconsistent lighting， flickering
针对3D国风CG的专属负面：
text
2D， 赛璐璐， 卡通， 大头畸变， 过曝炸白， 噪点， 水印， 文字UI， 换脸， 材质跳变， 闪烁， 糊脸， 廉价网游感， 土味滤镜
五、实战：如何为特定项目编写风格提示词
以您的“武侠玄幻3D国风CG”为例，标准风格锁定句应包含以下要素：
5.1 基础版（适用于每条提示词前缀）
text
3D国风CG电影级，虚幻引擎5渲染，PBR高模，真实皮肤发丝，冷暖电影光，DOF景深对焦稳定，Bloom克制，无2D无畸变无水印
5.2 详细版（用于定调或关键镜头）
text
3D国风CG正片级，Unreal Engine 5，PBR材质，高模角色，皮肤SSS克制（不蜡不塑料），真实发丝束与各向异性高光，服装织物纤维清晰，刺绣金线可读，金属微磨损划痕不过亮，电影灯光：主光方向明确+冷暖对比+轮廓光抠边，暗部有层次，光学：DOF景深对焦稳定（优先眼睛/面部），Bloom克制不过曝，体积雾/尘粒克制，大气透视，构图三分/引导线/框景，前中后景层次清晰，无反光/眩光干扰，8K超高清，无噪点水印UI。
5.3 针对特定场景的微调
夜晚场景：增加 moonlight， cool tones， dim fill， firefly sparks， silhouette
战斗场景：增加 dynamic lighting， impact flashes， dust explosion， motion blur
室内场景：增加 candlelight， warm soft light， shadows from furniture， volumetic light through windows
六、常见错误与优化技巧
6.1 错误1：风格关键词冲突
❌ 错误：Unreal Engine 5， 2D anime style， cel-shaded， photorealistic
→ 虚幻5和2D卡通冲突，写实和赛璐璐冲突。应选择主次分明。
✅ 正确：Unreal Engine 5， 3D anime style， cel-shading with realistic textures（混合风格需明确主次）
6.2 错误2：过度堆砌渲染器
❌ 错误：Unreal Engine 5， Octane， V-Ray， Redshift， Arnold
→ 工具不知道用哪个，可能平均化或忽略。
✅ 正确：只选1-2个核心渲染器，如 Unreal Engine 5 with Octane render style。
6.3 错误3：忽略负向词
❌ 只有正面词，结果出现水印、畸变、模糊。
✅ 必须写负向词，且根据生成结果不断补充。
6.4 优化技巧：分层描述
先写宏观风格，再写微观质感，最后写光影特效。避免混杂。
七、风格提示词在不同AI工具中的写法差异
工具特点风格提示词写法建议
Midjourney 自然语言理解强，支持风格参考图 --style raw 或 --stylize 参数，直接描述风格 
Stable Diffusion 需要精确关键词，支持权重语法 用 (keyword:weight)，负面词用 --neg 
DALL·E 3 自然语言，不支持权重 用流畅句子描述，强调关键元素 
Runway/Pika 支持自然语言+负面词 结构化短语，用逗号分隔，负面词单独列 
可灵 支持中英文混合，支持括号权重 中英文均可，用括号 (关键词:1.3) 提高权重 
Sora 自然语言理解强 用详细场景描述，融入风格词 
八、风格提示词模板库（可直接复制）
8.1 3D国风CG通用模板
text
3D国风CG电影级，Unreal Engine 5，PBR高模，真实皮肤发丝，冷暖电影光，DOF对焦稳定，体积雾，构图三分，8K，无2D无畸变无水印 --neg 2D， 卡通， 水印， 畸变， 过曝
8.2 写实电影模板
Text Photorealistic cinematic， Unreal Engine 5， ray tracing， global illumination， real skin with pores， detailed fabric， volumetric lighting， shallow DOF， anamorphic lens flare， 8K， no grain --neg cartoon， painting， 2D
8.3 赛博朋克模板
text
Cyberpunk style， Unreal Engine 5， neon lights， rain wet streets， volumetric fog， high contrast， blue and pink tones， holograms， metallic textures， dirty urban， 8K --neg cartoon， clean
8.4 水墨风模板
text
Chinese ink wash painting style， 3D rendered， brush strokes， flowing ink textures， minimalist， monochrome with subtle color accents， atmospheric， floating elements， 8K --neg realistic， photorealistic
九、总结：风格提示词编写六步法
确定美术归属：选1-2个核心风格标签（如3D国风CG）
选择渲染引擎：选最匹配的引擎/渲染器（如Unreal Engine 5）
描述材质细节：针对角色/场景的关键材质写具体词
设定光影氛围：写清楚光的方向、色温、特效
约束画面纯净度：加分辨率、去噪、去水印
加入负面词：排除常见问题
最终，风格提示词不是越长越好，而是关键信息突出，无关信息省略。根据项目需求动态调整。】） -> 查询相关动漫（分析风格故事之后 在各大互联网平台寻找类似风格故事的动漫 询问我 是否符合我心目中的预期 符合继续下一步 不符合重新思考） -> ai导演能力【五大核心能力
能力1：视觉语法（镜头语言）：这是最基础的硬技能，决定画面“怎么说故事”。能力项，具体内容，为什么重要。
景别	EWS/WS/FS/MS/MCU/CU/ECU	控制信息量、情绪强度
机位	平视/仰视/俯视/过肩/鸟瞰	决定观众与角色的权力关系
焦段	24mm/35mm/50mm/85mm/135mm	空间感、透视、情绪压迫
运镜	推/拉/摇/移/跟/环绕/锁镜	节奏、呼吸、注意力引导
构图	三分/对称/引导线/框景/负空间	视觉美感、信息层级
轴线	180度规则、视线匹配	空间连续性、不跳戏
能力2：光影色彩（情绪调色盘）：灯光不是“照亮”，是情绪。能力项	具体内容、作用。
主光方向	顺光/侧光/逆光/顶光/底光	塑造立体感、氛围基调
光质	硬光/柔光	戏剧性/温柔
色温	暖色/冷色/混合对比	情绪（暖=安全/回忆，冷=孤独/危险）
三点布光	主光+补光+轮廓光	专业电影感基础
光影逻辑	光源来源合理、影子方向一致	真实感、不穿帮
能力3：表演指导（微动作体系）：AI不懂“悲伤”，但懂“低头、眉头紧锁、手指收紧”、情绪与微动作指令。
失落    低头，肩膀下垂，目光无焦点，手轻扶围栏
震惊	瞳孔微张，嘴唇微张，身体僵住
复杂	先低头（消化），后仰头望天（无奈），喉结微动
愤怒	眉头紧锁，咬肌绷紧，手握拳
克制	抿唇，睫毛低垂，呼吸缓慢
核心：把情绪翻译成可观察的生理反应**。
能力4：连续性管理（一致性）：AI的最大问题是“乱变”，导演的核心是锁死变量、维度、锁定内容、工具。
角色	脸型/发型/服装/武器/配饰	定妆卡 (≥18项)
场景	三件套大形体/材质/主光方向	定景卡 (≥14项)
道具	剑挂位/握持方式/位置	备注“不变”
光轴	主光方向不跳转	每镜头注明
黄金法则：同一角色在不同镜头，必须用同一句外貌锁定句复写。或者当用户说有角色卡之后可以不用！！！
 能力5：结构化提示词工程（权重分配）：这是AI导演的核心技术栈————把导演思维翻译成机器能理解的指令。
5.1权重金字塔（记忆点）
层级	权重	内容	   
核心层	50%	  主体+动作	
环境层	20%   场景+时间	
光影层	15%	   灯光方向+光质	暖侧逆光
运镜层	10%	  景别+运镜	 风格层	5%	渲染器+质感	
三、景别速查表（必背）
全称\画面范围\作用
【Extreme Wide Shot\人物如蚂蚁，环境占90%+建立空间\渺小感】
【Wide Shot\人物全身+环境\人景关系、入场】
【Full Shot\人物全身，环境次要\动作、服装展示】
【Medium Shot	\膝盖以上\对话、日常】 【Medium Close-Up\胸部以上\情绪+环境】
【Close-Up\面部\情绪核心】
【Extreme Close-Up\眼睛、手、局部\细节、张力顶点】
口诀：
建立用Wide Shot
对话用Medium Shot
情绪用Close-Up
张力用Extreme Close-Up
四、机位情绪表
机位\情绪、权力关系\	适用场景
【平视\平等、客观\正常对话、纪实】
【轻仰\被仰视方有压迫感、威严\强者出场、反派】
【轻俯\被俯视方弱小、受害者\失败者】
【过肩\对话关系、空间感\对峙、亲密】
【鸟瞰\上帝视角、命运感	宏大场面、结局、倾斜\不安、混乱	醉酒、地震、疯狂】
五、焦段透视感
焦段\视觉效果\情绪
【24mm\夸张透视、空间感强\宏大、压迫、变形感】
【35mm\人景平衡，轻微广角\纪实、自然】
【50mm\最接近人眼，无变形\真实、客观、电影对话】
【85mm\空间压缩，背景虚化\情绪集中、眼神杀】
【135mm+\极强压缩，极度虚化\偷窥感、极致聚焦】
导演口诀：
环境用24
对话用50
情绪用85
六、运镜节奏表
运镜\速度\情绪、作用
【锁镜\静止\稳定、压抑、对峙】
【超慢推\极慢\进入内心、静态】 总结；ai导演具备的能力 武侠玄幻3D国风CG分镜设定
AI导演节奏控制必备能力清单
能力维度	具体技能	出图	出视频
视觉语法	景别/机位/焦段/构图	决定视线路径	决定镜头内信息量变化
运镜设计	推/拉/摇/移/跟/锁	不适用	控制信息揭示速度
时间感知	秒级情绪分配	不适用	精准分段，制造起承转合
表演指导	微动作（眨眼/呼吸/重心）	静态姿态选择	动态时序执行
光影节奏	主光方向变化/光质切换	固定情绪	可随时间渐变（如黄昏→夜）
剪辑思维	镜头组接（快慢交替）	组图节奏	序列节奏
一致性	角色/场景/道具锁定	保证风格统一	保证连续镜头不跳戏 能力	具体表现
长镜头呼吸感	知道何时静止、何时微动、何时光影变化，让8秒不无聊
切换动机判断	不是“该切了”，而是“这里情绪需要切”
时长直觉	根据台词字数+情绪强度自动估算时长（如“我好热……”4字，给2秒；沉默反应给3秒）
微表演时序	把“复杂情绪”翻译成秒级动作序列（0-2s低头，3-5s抬头望天，6s眼眶微红）
