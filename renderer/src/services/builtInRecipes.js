import { changedBuiltInFields, withBuiltInEntries, withoutBuiltInEntries } from './builtInCatalogStorage.js';

const videoPromptExecutionContract = [
  '视频指令应是一份能逐秒落实的导演执行稿，不得缩成抽象概述，也不能只罗列“电影感、稳定、高清”等质量形容词。',
  '第一部分写全局镜头合同，锁定主体及数量、准确总时长、画幅、视觉风格、时间天气、照明色调、总体摄影策略，以及参考图中必须继承的身份、服装、商品、道具和场景特征。总时长只能来自节点 outputSpec/config 或当前镜头意图，不可擅自改写。',
  '接着以覆盖完整总时长且不重叠、不留空档的时间码组织段落，例如“00:00–00:03”。3–7 秒至少拆为 2 个动作节拍，8–15 秒通常安排 3–5 个节拍。每段交代起始画面与主体位置、动作的发起和演变、表情视线或姿态变化、摄影机位置及运动、焦段和景深变化、光线与环境或物体反馈、声音或台词，以及进入下一段的自然接点。',
  '动作必须具体且有因果：明确行动者、先后次序、速度与方向变化、接触或遮挡位置，以及环境随之产生的反应。不能用“氛围渐强、情绪递进、电影感拉满”等不可见概念替代表演。',
  '默认一个视频节点只完成一个连续镜头。需要过渡时，优先采用动作遮挡、经过暗区、甩镜、推进、同向运动或声音桥等可执行方法；出现真实切镜、换场或非连续时间，而当前模型或模式又不具备明确多镜能力时，应拆成多个节点，禁止硬塞进同一条 prompt。',
  '包含人声时必须标注说话者、逐字台词、开始结束时间、语气、音量，并同步安排口型、呼吸与表情；没有人声时则说明环境声、拟音以及是否无配乐。其他镜头的台词不得重复挪用。',
  '最后一秒要明确主体姿态、视线、道具状态、摄影机景别与构图和环境状态；若要衔接下一个镜头，还需给出延续的运动方向或视觉接点。',
  '最后单列“负面约束”，只列与当前内容有关的身份漂移、人数错误、五官肢体及手部异常、服装/商品/道具改变、空间跳变、动作瞬移、物理失真、镜头抖动、跳帧、闪烁、果冻感、低清模糊、塑料材质、错误文字和违背项目风格的表现，不要机械堆入无关禁词。',
].join('\n');

function recipe({ id, name, generationType, operationTypes, description, requiredElements, guidance, version = 2 }) {
  return {
    id,
    name,
    description,
    generationType,
    operationTypes,
    systemPrompt: [
      `将当前节点的制作意图整理成${generationType === 'image' ? '图片' : generationType === 'video' ? '视频' : generationType === 'audio' ? '音频' : '文本'}模型能够直接执行的完整指令。`,
      generationType === 'video' ? videoPromptExecutionContract : '',
      guidance,
      `最终指令不可遗漏这些信息：${requiredElements.join('、')}。`,
      '仅交付最终提示词；不要说明改写步骤，不要复述节点用途，不要附带候选版本，也不要用空泛质量词充数。',
    ].filter(Boolean).join('\n\n'),
    requiredElements,
    version,
    builtIn: true,
    enabled: true,
  };
}

const generalRecipes = [
  recipe({ id: 'general-image', name: '基础单图编排', generationType: 'image', operationTypes: ['general-image'], description: '当没有更具体的领域策略时，用于组织一次独立图片制作。', requiredElements: ['核心主体', '可见动作或姿态', '所在环境', '镜头构图', '照明与视觉风格'], guidance: '交代主体身份和必须稳定的外观，写清画面正在发生什么、空间位于何处、采用什么景别与视角、各元素如何构图，以及光向、配色和材质表现；若有参考素材，逐项指出必须继承的特征。' }),
  recipe({ id: 'general-video', name: '连续镜头编排', generationType: 'video', operationTypes: ['general-video'], description: '当没有专用领域策略时，用于编写一个连续摄影机镜头。', requiredElements: ['全局镜头合同', '完整分秒时间轴', '动作因果链', '摄影机与焦点演变', '环境物理响应', '对白或声音', '明确收尾状态', '针对性负面约束'], guidance: '每个节点只安排一个能够连续拍完的镜头；把抽象想法落实为从第一秒持续到最后一秒的可见表演、运动与画面变化，不能用情绪概念替代实际动作。', version: 3 }),
  recipe({ id: 'general-audio', name: '声音内容编排', generationType: 'audio', operationTypes: ['general-audio'], description: '在没有领域策略可用时，组织对白、音乐或环境声音的生成指令。', requiredElements: ['主要声音来源', '情绪取向', '速度与节拍', '段落组织', '总时长及制作质感'], guidance: '明确声音以人声、乐器还是环境为核心，并描述音色、速度、节奏、结构、空间位置和持续时间；涉及对白时，必须给出说话者、所用语言、表达语气与逐字内容。' }),
  recipe({ id: 'general-text', name: '结构化文本编排', generationType: 'text', operationTypes: ['general-text'], description: '在没有专用领域策略时，生成边界清楚的结构化文本任务。', requiredElements: ['明确目标', '事实依据', '目标读者与口吻', '篇幅限制', '交付结构'], guidance: '把用户诉求转换为下游模型可直接执行的写作要求，约束可使用的信息来源、读者、语言、长度、章节组织与最终格式，并要求直接给出成品。' }),
];

const ecommerceRecipes = [
  recipe({ id: 'ecommerce-text-plan', name: '商品详情分屏策划', generationType: 'text', operationTypes: ['ecommerce-text-plan'], description: '把商品信息规划为逐屏推进的详情页内容与版式结构。', requiredElements: ['商品定位及人群', '确定屏数', '每屏传播任务', '标题层级', '卖点与信息版位'], guidance: '按屏给出完整结构，每一屏都要列明传播目的、主副标题、可验证卖点、视觉中心、信息摆放方式及其与前后屏的叙事衔接；最终屏数必须服从任务要求。' }),
  recipe({ id: 'ecommerce-style-reference', name: '商品详情视觉总板', generationType: 'image', operationTypes: ['ecommerce-style-reference'], description: '以一张多列总览建立整套商品详情页的视觉规范。', requiredElements: ['商品外观锁定', '3–5 列整体版式', '色彩体系', '文字层级', '模块节奏及留白'], guidance: '制作一张近方形的详情页视觉总板，把移动端长页面切成 3–5 个竖列并由左向右陈列；内容需涵盖首屏、优势、细节、使用情境、参数与品牌收束，所有部分共用同一视觉语言，但该图只作总览而不是最终单屏。' }),
  recipe({ id: 'ecommerce-ad-image', name: '商品详情单页制作', generationType: 'image', operationTypes: ['ecommerce-ad-image', 'product-detail-image'], description: '完成指定详情屏，并准确延续整案视觉总板。', requiredElements: ['商品形象一致', '指定屏文案', '独立单屏版式', '总板风格继承', '竖向成品规格'], guidance: '只制作当前指定的一屏并落实相应分屏策划；沿用视觉总板的配色、字级、圆角、装饰语言和留白比例，不得复制多列总览结构，也不能夹带其他屏的信息。' }),
  recipe({ id: 'ecommerce-scene-image', name: '商品情境展示', generationType: 'image', operationTypes: ['ecommerce-scene-image'], description: '在保持商品外观准确的前提下，将其置于明确的使用或陈列环境。', requiredElements: ['商品身份锁定', '单一具体环境', '商品位置与辅助道具', '光向及色温', '取景与景深'], guidance: '一次只表现一个有明确用途和叙事线索的空间；说明环境材质、2–4 件相关道具、商品摆位、主光方向、色温、构图方式及景深，任何商品造型与包装细节都不可漂移。' }),
  recipe({ id: 'ecommerce-remix-image', name: '商品版式重制', generationType: 'image', operationTypes: ['ecommerce-remix-image'], description: '沿用单张参考详情图的设计骨架，替换为用户自己的商品内容。', requiredElements: ['唯一目标参考', '用户商品一致性', '需继承的版式关系', '新文案内容', '交付尺寸'], guidance: '每次只对应一张参考图，保留其主体位置、色块关系、文字区域与信息层次；把原商品和文案替换为用户提供的商品与真实卖点，不得照搬原品牌，也不能虚构性能参数。' }),
];

const socialRecipes = [
  recipe({ id: 'social-copywriting', name: '跨平台社媒文案', generationType: 'text', operationTypes: ['social-copywriting', 'social-title-copy'], description: '为不同社交平台分别规划标题、正文骨架和视觉起点。', requiredElements: ['发布平台', '目标人群', '多组标题方向', '正文或口播结构', '配套视觉种子'], guidance: '逐个平台确定语气，提供 3–5 个标题角度、正文或口播框架，以及能与各角度对应的视觉提示种子；必须体现真实的平台差异，禁止把同一套文字机械复制到所有渠道。' }),
  recipe({ id: 'social-xiaohongshu-image', name: '小红书视觉封面', generationType: 'image', operationTypes: ['xiaohongshu-cover', 'xhs-image', 'xhs-cover'], description: '制作带自然生活质感的小红书竖版封面或内容配图。', requiredElements: ['清晰内容主体', '可信生活环境', '3:4 竖向画面', '标题留白区', '精致但真实的气质'], guidance: '采用 3:4 竖幅和自然生活审美，确保主体一眼可辨，并在顶部保留约 15–20% 的标题安全区；避免虚构奢华、贴纸堆叠和低价促销视觉。' }),
  recipe({ id: 'social-douyin-cover', name: '短视频竖屏封面', generationType: 'image', operationTypes: ['douyin-cover', 'tiktok-cover', 'reels-cover'], description: '为抖音、TikTok 或 Reels 制作在手机首屏上醒目的竖版封面。', requiredElements: ['视觉核心', '9:16 竖向版式', '首屏注意力钩子', '界面避让区', '易识别的色彩关系'], guidance: '使用 9:16 竖幅，让主体与情绪在缩略尺寸下仍然明确；为底部和右侧平台界面留出安全空间，以构图和配色制造注意力，而不是依赖覆盖全屏的大字。' }),
  recipe({ id: 'social-ig-post', name: 'Instagram 品牌配图', generationType: 'image', operationTypes: ['ig-post', 'instagram-post', 'ig-image'], description: '制作克制、具有编辑审美的方形或 4:5 品牌图片。', requiredElements: ['主要对象', '1:1 或 4:5 比例', '简洁版式', '品牌色彩', '材质照明'], guidance: '选择 1:1 或 4:5 画幅，突出编辑设计感、影棚质感与节制的品牌配色；降低叠字和装饰数量，让主体、表面材质和负空间共同完成构图。' }),
  recipe({ id: 'social-weibo-wechat-image', name: '微博公众号头图', generationType: 'image', operationTypes: ['weibo-image', 'wechat-image', 'article-header'], description: '为微博信息或公众号文章制作便于阅读的横向视觉头图。', requiredElements: ['文章主题主体', '横向信息关系', '16:9 或 1:1 规格', '文案预留区域', '匹配内容的气质'], guidance: '优先使用 16:9 横幅并围绕主题建立横向叙事，在左侧或底部留下 25–30% 的文字空间；图像应帮助读者理解文章，而不是只充当无关装饰。' }),
  recipe({ id: 'social-content-image', name: '信息流通用配图', generationType: 'image', operationTypes: ['social-post-image', 'cover-image'], description: '当渠道尚未指定时，制作适合常见信息流展示的社媒图片。', requiredElements: ['明确的平台前提', '内容焦点', '信息流版式', '标题安全区域', '统一视觉语气'], guidance: '先声明采用的平台和画幅假设，保证主体在信息流缩略图里仍清晰，并于顶部或底部保留至少 15% 的标题空间；视觉风格必须服务具体内容，不套用固定的网红模板。' }),
];

const videoProductionRecipes = [
  recipe({ id: 'narrative-source-analysis', name: '叙事原作解析', generationType: 'text', operationTypes: ['narrative-source-analysis', 'novel-analysis', 'story-source-analysis'], description: '将小说、长故事或章节梳理为忠于原文且能持续支持改编的叙事档案。', requiredElements: ['分析范围和事实边界', '主线及关键事件', '世界规则', '人物关系与成长轨迹', '事件时序、场景及道具', '伏笔与尚缺信息'], guidance: '分析只能使用当前原文与已核验上游材料，并标明本次覆盖段落；必须区分原文事实、合理推断、缺失信息和改编建议。统一人物本名、别称、关系、世界观限制、事件顺序、空间、关键道具状态和待回收伏笔，以支持分批改编的连续性；不要提前写分镜、图片或视频提示词，也不可擅改核心冲突或既定结局。', version: 2 }),
  recipe({ id: 'screenplay-adaptation', name: '影视化剧本转换', generationType: 'text', operationTypes: ['screenplay-adaptation', 'novel-to-screenplay', 'story-to-screenplay'], description: '结合原作解析和成片约束，把小说、章节或故事梗概转换成可拆镜的影视剧本。', requiredElements: ['改编边界与成片规格', '场次编号、时空及内外景', '人物目标和冲突', '能被看见的表演动作', '逐字对白或旁白', '场次转折及连续关系'], guidance: '先确认用户给定的成片类型、总时长或集数、单集时长、受众与改编幅度；任何缺失且会改变结构的规格都应标为待确认，不得自行杜撰。逐场列出场号、内外景、地点、时间、出场人物、场景任务、可见表演、逐字台词或旁白、道具状态、转折与下一场接点。所有压缩、合并和补写都要明确标注为改编处理，不得冒充原作事实；若输入已是完整剧本，只检查并修订必要部分。', version: 2 }),
  recipe({ id: 'video-creative-outline', name: '影像创意框架', generationType: 'text', operationTypes: ['video-creative-outline'], description: '把主题与已有素材归纳为后续制作可直接沿用的影像创意框架。', requiredElements: ['主题主张', '目标观众', '核心传达', '视觉基调', '情绪走势和时长结构'], guidance: '让下游明确主题、观众、核心信息、视觉语言、情绪变化、时间分配、关键场面和交付规格，使其成为分镜阶段唯一的上游创意依据。' }),
  recipe({ id: 'video-storyboard-script', name: '导演镜头清单', generationType: 'text', operationTypes: ['video-storyboard-script'], description: '将内容拆解为逐镜可拍、可生成的导演镜头表。', requiredElements: ['镜头编号', '单镜时长', '画面事件与动作', '景别和机位', '摄影机运动及转场'], guidance: '输出逐镜表格，每一镜必须包含编号、时长、叙事职责、主体行为、场景、景别、机位、唯一主运镜、声音设计，以及与前后镜头的视觉或动作接点。' }),
  recipe({ id: 'video-character-design', name: '跨镜角色视觉档案', generationType: 'text', operationTypes: ['video-character-design', 'character-design'], description: '从叙事文本中建立跨镜复用角色的稳定外观档案和允许变化。', requiredElements: ['角色身份信息', '脸部与体型', '发型、服装和配件', '固定识别点', '剧情允许的状态改变'], guidance: '只为跨镜出现或身份敏感的角色建档；分别记录年龄阶段、脸型五官、肤色发型、体型、基础服装、关键配饰、色彩标签、不可改变的识别特征，以及剧情允许的服装或状态演变。场景构图不能被写入角色档案。' }),
  recipe({ id: 'video-character-turnaround', name: '角色电影开发总板', generationType: 'image', operationTypes: ['video-character-turnaround', 'character-turnaround', 'character-card', 'cinematic-character-board'], description: '在单张电影美术总板中集中呈现跨镜角色的身份、转面、表演和服装依据。', requiredElements: ['单角色主立像', '全身完整转面', '有效头部角度研究', '剧情核心情绪肖像', '服装与配件拆解', '所有区域身份统一'], guidance: '使用横向大画幅电影开发板：以主立像确定轮廓和气质，加入正面、3/4、侧面、背面的完整全身转面，配合少量头部角度研究、一幅核心剧情情绪肖像，并拆解服装层次、材质、配件与关键道具。背景保持中性，使用充足留白、克制的不对称构成和极少短标签，避免规则宫格塞满头像。各区域的脸型五官、体型比例、发型、服装结构、配色与磨损状态必须一致，并继承既定写实、半写实或动画风格；不要默认把风格角色变成真人演员，也不要加入普通杂物、长档案、密集印章、伪文字和重复物件。', version: 3 }),
  recipe({ id: 'video-storyboard-grid', name: '全片分镜总览', generationType: 'image', operationTypes: ['video-storyboard-grid', 'storyboard-grid'], description: '将逐镜脚本汇总为按阅读顺序编号的多宫格视觉总览。', requiredElements: ['脚本对应格数', '清晰宫格结构', '每格镜头编号', '统一视觉基调', '人物与空间连续性'], guidance: '生成一张边界连续的多宫格分镜总览，格数必须与脚本镜头一致并按阅读方向标号；每格只承载一个镜头，人物、商品、场景和画幅在各格之间保持统一。' }),
  recipe({ id: 'video-shot-storyboard', name: '单镜动作构图', generationType: 'image', operationTypes: ['video-shot-storyboard', 'shot-storyboard'], description: '依据镜头脚本及可用身份和场景锚点，为单个镜头确定动作构图。', requiredElements: ['对应镜号', '主体行为和站位', '人物与场景连续', '景别及机位', '最终画幅'], guidance: '画面只能对应镜头表中的一行，要落实动作瞬间、人物位置、视线、道具状态、景别、机位、构图与光线。存在人物或场景参考时应忠实继承；没有兼容视觉输入时，必须完整复述锁定特征并说明这是独立重建，不得伪称从参考图提取。' }),
  recipe({ id: 'video-action-sequence-board', name: '六拍动作连续板', generationType: 'image', operationTypes: ['video-action-sequence-board', 'action-sequence-board', 'action-storyboard'], description: '把同一个复杂连续动作拆为六个空间与因果关系明确的关键节拍。', requiredElements: ['一项连续动作', '2 列×3 行六格顺序', '六个动作关键点', '角色身份与运动轴线连续', '人物和摄影机方向标识'], guidance: '默认用横向 2 列×3 行六格，并按从左到右、从上到下依次展示同一动作的环境与起始状态、意图或察觉、接触点、主动作、结果位移、结束姿态或情绪收束。每格只承载一个节拍，角色身份、服装、道具、左右持物、场景方位和运动轴线必须连续；可按叙事需要切换全景、中近景、手部特写与结果镜头。方向信息只用少量无文字箭头区分人物与摄影机，不生成长句注释、彩色图例、参数表、密集编号或十二格堆叠。只有确需研究复杂打斗或调度时才另做多机位覆盖，而且不能把覆盖方案冒充时间序列。' }),
  recipe({ id: 'video-frame-extraction', name: '镜头高清定帧', generationType: 'image', operationTypes: ['video-frame-extraction', 'frame-extraction'], description: '制作独立高清关键帧；若输入真实多宫格参考，则可重建其中指定镜头。', requiredElements: ['镜头编号或时间点', '动作与画面关系', '主体身份连续', '成品画幅及细节'], guidance: '当真实多宫格以 referenceImage 连接时，只选择目标格并重建为独立高清画面，保持源格中的构图、人物、场景和动作，同时去除宫格边框与标注。没有多宫格输入时，应依据已连接文本或视觉依据独立生成关键帧，并在提示词中完整说明姿态、构图和身份特征，不得声称该画面是从分镜提取。' }),
  recipe({ id: 'video-clip-generation', name: '参考锚点连续镜头', generationType: 'video', operationTypes: ['video-clip-generation', 'clip-generation'], description: '以主关键帧确定起始构图，再依据镜头风险补足身份、空间、道具或动作参考，形成一个连续镜头。', requiredElements: ['主关键帧和起始构图', '各参考输入职责', '身份、场景及道具锁定', '完整分秒时间轴', '主体动作与微表演', '摄影机和焦点演变', '环境物理反馈', '台词及声音同步', '精确结束画面', '内容相关负面约束'], guidance: '主关键帧负责构图和起始状态，但不能替代全部视觉约束。先检查它的真实成品：低风险且融合完整时允许单独使用；如果多角色、身份特写、非人主体、关键产品或道具、严格场景结构、复杂动作仍表达不足，就在模型能力范围内补充对应角色板、场景板、道具板或动作依据。每张视觉输入都要与本镜相关，并在全局镜头合同中写明它约束的主体、身份、材质、场景、道具或动作；提示词还需自包含复述不可变化的五官、脸型、发型、身材比例、服装结构和细节，以及主体、道具与环境的初始空间关系。不要固定参考数量，也不要加入无关、重复或冲突图片。时间轴需要逐段交代人物的视线、呼吸、口型、手部和身体微动作，摄影机移动或变焦，焦点何时转移，以及光线、烟尘、纸张、衣料、毛发和道具的连续物理反馈。写实真人项目才使用真实细腻皮肤纹理、自然微表情、电影级光影和高清摄影质感；其他项目继承原风格和材质，不得把半写实、动画、纸扎或怪物角色真人化。', version: 6 }),
  recipe({ id: 'video-audio-design', name: '影视声音方案', generationType: 'audio', operationTypes: ['video-audio-design', 'soundtrack', 'voiceover'], description: '为画面组织配音、音乐、环境声或拟音的生成提示。', requiredElements: ['声音内容类别', '情绪与速度', '分段结构', '画面同步位置', '时长及制作质感'], guidance: '依照镜头节奏划分声音段落和同步点；配音要给出说话者、语气与逐字稿，配乐要说明乐器、速度和情绪弧线，音效则明确出现时间与空间方位。' }),
  recipe({ id: 'video-audio-production-sheet', name: '声音后期执行单', generationType: 'text', operationTypes: ['video-audio-production-sheet', 'sound-design-sheet'], description: '当没有音频模型或只需要制作规划时，生成可交付声音团队的时间码执行文档。', requiredElements: ['分段时间码', '对白及旁白', '环境声和拟音', '音乐结构', '混音建议与交付规格'], guidance: '沿画面时间线编写声音执行表，逐段列出对白或旁白逐字稿、环境氛围、拟音、关键同步点、音乐进出、声像与动态范围建议；文档开头必须声明这是声音制作方案，而不是已经生成的音频。' }),
];

const shortDramaRecipes = [
  recipe({ id: 'drama-plot-outline', name: '短剧叙事蓝图', generationType: 'text', operationTypes: ['drama-plot-outline'], description: '把初始故事构想整理成能够继续编剧和拆镜的短剧叙事蓝图。', requiredElements: ['主题及世界规则', '核心人物', '主要空间', '剧情推进线', '情绪变化轨迹'], guidance: '围绕用户故事交付主题、人物目标与冲突、场景清单、关键道具、分场概述、主要转折、情绪弧线及总时长；用户已指定的结局必须原样保留。' }),
  recipe({ id: 'drama-character-extraction', name: '短剧角色视觉档案', generationType: 'text', operationTypes: ['drama-character-extraction'], description: '从剧本中整理可在多个镜头重复使用的逐角色视觉档案。', requiredElements: ['人物姓名', '身份与年龄阶段', '外观识别特征', '服饰及配件', '固定不变项'], guidance: '每名角色单独记录，覆盖身份、年龄、脸型五官、发型肤色、体型、服装、配饰、色彩标签、剧情状态变化和不能改变的识别特征。' }),
  recipe({ id: 'drama-scene-extraction', name: '短剧空间连续性档案', generationType: 'text', operationTypes: ['drama-scene-extraction'], description: '从剧本建立可跨镜复用的逐场景空间与连续性档案。', requiredElements: ['空间名称', '平面结构关系', '固定陈设', '光线与色彩', '跨镜连续规则'], guidance: '每个场景独立成段，记录空间结构、出入口、固定道具、表面材质、时间天气、主光方向、色温、色彩关系，以及跨镜头不得改变的环境要素。' }),
  recipe({ id: 'drama-prop-extraction', name: '短剧关键道具档案', generationType: 'text', operationTypes: ['drama-prop-extraction'], description: '识别并记录会影响剧情推进、身份判断或连续性的关键道具。', requiredElements: ['道具称谓', '造型与材质', '尺度比例', '剧情用途', '状态演变'], guidance: '只为真正影响剧情、身份或连续性的物件建档；分别注明外观、材质、大小、标记、持有人、首次出现、叙事作用及其随剧情产生的状态变化。' }),
  recipe({ id: 'drama-shot-planning', name: '短剧逐镜导演表', generationType: 'text', operationTypes: ['drama-shot-planning', 'drama-scene-breakdown'], description: '把剧本转化为能够连续拍摄或生成的逐镜导演清单。', requiredElements: ['镜头序号', '单镜时长', '画面表演动作', '人物、空间与道具', '运镜和衔接关系'], guidance: '每行安排一个 3–15 秒连续镜头，写明镜号、时长、叙事作用、人物站位和表演、台词、场景、道具状态、景别、机位、主要运镜、声音以及镜头首尾接点。' }),
  recipe({ id: 'drama-character-turnaround', name: '短剧角色开发总板', generationType: 'image', operationTypes: ['drama-character-turnaround', 'drama-character-card', 'cinematic-character-board'], description: '将短剧人物的身份、转面、表演状态与服饰信息汇集到一张电影开发总板。', requiredElements: ['人物主立像', '完整全身转面', '必要头部角度研究', '核心剧情情绪', '服装配件拆解', '各区域一致性'], guidance: '采用横向大画幅电影美术开发板：以主立像建立人物轮廓和气质，同时呈现正面、3/4、侧面、背面的完整全身转面、少量头部角度研究、一张核心剧情情绪肖像，以及服装层次、材质、配件与关键道具的拆解。背景保持中性，使用充足留白和克制的不对称编排，只出现人物名与短标签。所有区域的脸型五官、体型、发型、服装结构、配色和状态必须一致，并沿用项目的写实、半写实或动画路线；不要默认真人化，也不要加入普通杂物、长篇档案、密集装饰、伪文字或重复物件。', version: 3 }),
  recipe({ id: 'drama-scene-image', name: '短剧场景视角板', generationType: 'image', operationTypes: ['drama-scene-image'], description: '用全景、中景和细节视角建立没有人物的短剧场景参考。', requiredElements: ['场景身份', '广角空间全貌', '中距离关系', '关键细节角度', '统一空间与照明'], guidance: '在同一张图里展示该场景的广角全貌、中景关系和关键细节三个视角；画面不出现人物，三个视角的结构、陈设、光向、色温和材质必须互相一致。' }),
  recipe({ id: 'drama-prop-image', name: '短剧道具视角板', generationType: 'image', operationTypes: ['drama-prop-image'], description: '为剧情关键道具建立多个角度一致的视觉参考板。', requiredElements: ['道具身份', '正向视图', '3/4 视图', '背面或俯视角度', '表面材质细节'], guidance: '在纯色背景的单张图上并列正面、3/4 侧面以及背面或俯视角度，确保比例、色彩、标记、磨损状态跨视图一致，并清晰表现材质。' }),
  recipe({ id: 'drama-shot-group-storyboard', name: '短剧镜头构图板', generationType: 'image', operationTypes: ['drama-shot-group-storyboard'], description: '为导演镜头表中的一个镜头制作独立构图与动作锚点。', requiredElements: ['对应镜头编号', '主体可见动作', '人物身份锁定', '空间及道具锁定', '交付画幅'], guidance: '只表现导演表中的单行镜头，并使用真正相关的人物模卡、场景图和道具图；清楚规定主体动作、位置、画面构图、景别、机位及照明，使其成为该镜视频的视觉起点。' }),
  recipe({ id: 'drama-shot-video-generation', name: '短剧连续表演镜头', generationType: 'video', operationTypes: ['drama-shot-video-generation', 'short-drama-shot-video', 'short-drama-shot'], description: '结合单镜构图和当前所需身份、空间、道具或动作依据，生成 3–15 秒连续剧情表演。', requiredElements: ['主分镜及起始画面', '参考输入职责说明', '人物、空间和道具连续', '完整分秒时间轴', '人物走位与表演变化', '逐字台词及口型时间', '摄影机调度', '环境和道具反馈', '下一镜视觉接点', '针对性负面约束'], guidance: '内容必须严格对应一个镜头，并把人物目标、可见反应和动作因果落实到完整时间轴。主关键帧只负责构图；若真实成品没有清晰包含每个身份敏感角色、非人主体、服装伤损、关键道具、场景轴线或复杂动作，就应按模型能力加入必要视觉依据。提示词逐项说明每张输入负责约束什么，并自包含地锁定角色五官、脸型、发型、身材比例、服装结构、左右持物、关键道具及场景轴线；不要规定固定参考数量，也不能堆入无关图片。逐字台词只可出现在本镜对应时段，并注明说话者、语气、口型与停顿；没有台词时则写出呼吸、脚步、衣料、环境声或关键拟音。写实真人短剧使用真实皮肤与自然表演；漫剧、动画及风格化角色继承原风格和对应材质，不得真人化。结尾明确可衔接下一镜的视线、姿态、运动方向和道具状态。', version: 5 }),
];

const keyframeRecipes = [
  recipe({ id: 'keyframe-scene-script', name: '关键帧过渡蓝图', generationType: 'text', operationTypes: ['keyframe-scene-script'], description: '规划一组关键画面以及每对相邻画面之间的连续变化。', requiredElements: ['关键帧编号', '各帧视觉状态', '相邻帧过渡动作', '连续性锁定项', '完整时长'], guidance: '以 KF-01 开始列出关键帧，以 T-01 开始列出相邻过渡；每帧描述构图、姿态和状态，每段过渡说明连续动作、摄影机变化与持续时间，整个过程不得引入切镜。' }),
];

const videoAdRecipes = [
  recipe({ id: 'video-ad-creative-outline', name: '广告创意命题', generationType: 'text', operationTypes: ['video-ad-creative-outline'], description: '从商品证据、品牌定位和投放目标中建立视频广告的核心创意命题。', requiredElements: ['品牌与商品定位', '目标消费者', '渠道规格', '可验证核心卖点', '视觉语言和情绪弧线'], guidance: '分析可被证实的商品特征，并给出目标受众、投放平台、核心承诺、开场钩子、真实卖点、视觉母题、情绪走势、时长分配和行动号召。' }),
  recipe({ id: 'video-ad-brief', name: '广告全案拍摄脚本', generationType: 'text', operationTypes: ['video-ad-brief', 'video-ad-script'], description: '产出包含镜头清单、逐字声音内容和技术要求的完整广告制作稿。', requiredElements: ['广告总览', '色彩及视觉规范', '逐镜 Shot List', '旁白与字幕', '技术规格和连续规则'], guidance: '要求下游交付广告概览、商品证据、色彩和材质系统、逐镜 Shot List、逐字旁白或字幕、声音方案、平台画幅、总时长，以及商品跨镜一致性规则。' }),
];

const talkingHeadRecipes = [
  recipe({ id: 'talking-head-creative-outline', name: '口播内容策划', generationType: 'text', operationTypes: ['talking-head-creative-outline'], description: '依据主播人像、传播目标和可选商品信息，规划口播内容方向。', requiredElements: ['主播定位', '受众及平台', '核心表达', '语言风格', '情绪节奏与场景方向'], guidance: '交付主播人设、目标人群、发布平台、内容目的、核心信息或卖点、段落结构、自然口播语气、情绪节拍、场景建议和合理时长。' }),
  recipe({ id: 'talking-head-scene-extraction', name: '口播空间方案', generationType: 'text', operationTypes: ['talking-head-scene-extraction'], description: '把口播策划展开为可以直接生成和复用的空间方案。', requiredElements: ['场景编号', '空间与背景陈设', '主播位置', '商品展示区域', '照明、色彩及机位'], guidance: '逐场景列出空间类型、背景布置、主播站位、商品展示区域、光源方向、色温、配色、机位构图以及需要跨镜保持的连续关系。' }),
  recipe({ id: 'talking-head-script', name: '口播表演镜头表', generationType: 'text', operationTypes: ['talking-head-script', 'talking-head-video-script'], description: '生成同时包含逐字台词与可执行表演提示的口播逐镜表。', requiredElements: ['镜号和时长', '逐字口播', '表情及视线', '手势或商品动作', '景别、运镜与衔接'], guidance: '每个镜头列明编号、持续时间、逐字台词、景别构图、表情视线、手势、商品动作、主要运镜、转场和连续要求；台词应拆成自然、易说的短句。' }),
  recipe({ id: 'talking-head-portrait-optimization', name: '主播出镜形象整理', generationType: 'image', operationTypes: ['talking-head-portrait-optimization'], description: '不改变人物身份，只把原始人像整理为适合口播出镜的形象。', requiredElements: ['人物身份不变', '口播取景', '姿态和视线', '服装及妆容', '自然照明和肤色'], guidance: '唯一视觉依据是主播原始人像；五官、脸型、发型、肤色、年龄感和辨识特征必须严格保持，只允许改善取景、姿态、服装整洁度、光照与清晰度。' }),
  recipe({ id: 'talking-head-scene-image', name: '口播空镜场景板', generationType: 'image', operationTypes: ['talking-head-scene-image'], description: '生成不含主播和商品的稳定口播空间参考。', requiredElements: ['主要空间', '背景布置', '主播预留位置', '商品预留位置', '照明色彩和相机位置'], guidance: '以稳定机位生成空场景，画面中不出现人物，也不凭空复制商品；按照空间方案安排陈设、主播区域和商品展示位，并清晰固定光向、色温和透视。' }),
  recipe({ id: 'talking-head-storyboard-grid', name: '口播镜头总览板', generationType: 'image', operationTypes: ['talking-head-storyboard-grid'], description: '把口播镜头表汇总为主播身份、商品和空间都连续的多宫格总览。', requiredElements: ['宫格顺序', '逐格镜头', '主播身份一致', '商品及场景一致', '全局连续规则'], guidance: '宫格数量必须与脚本 Shot 一致并逐格标号；每格都应是同一主播，服装妆容连续，商品外观忠实于参考，背景与对应场景板一致，而且一格只表达一个 Shot。' }),
  recipe({ id: 'talking-head-clip-generation', name: '口播连续表演镜头', generationType: 'video', operationTypes: ['talking-head-clip-generation'], description: '使用单镜构图及必要的人像、商品和空间参考，生成一个自然连续的口播 Shot。', requiredElements: ['单镜构图锚点', '视觉输入职责说明', '主播、商品和场景锁定', '完整分秒时间轴', '逐字台词时段', '口型、呼吸及停顿', '表情与视线变化', '手势或商品动作', '摄影机和结束状态', '相关负面约束'], guidance: '每次只生成一个 Shot。逐镜高清图确定构图；身份特写要有可靠人像依据，商品展示要有可靠商品依据，空间结构重要时要有场景依据，除非这些约束已在真实关键帧中核验为清晰融合。提示词要逐项写明每张输入分别锁定主播、商品或场景的哪些特征，不设固定数量，也不堆无关参考。先按实际语速校验逐字台词能在目标时长内自然说完，再把开口、重音、停顿、呼吸、视线、微表情、手势和商品动作分配进时间轴；动作服务语义，不能机械重复点头或挥手。提示词需自包含锁定主播五官、脸型、发型、年龄感、服装、商品包装和场景，确保口型与声音同步；摄影机运动保持克制，结尾留出自然停顿和稳定姿态，不能在最后一帧突然截断。', version: 4 }),
];

const builtInRecipes = [
  ...generalRecipes,
  ...ecommerceRecipes,
  ...socialRecipes,
  ...videoProductionRecipes,
  ...shortDramaRecipes,
  ...keyframeRecipes,
  ...videoAdRecipes,
  ...talkingHeadRecipes,
];

export function withBuiltInRecipes(storage = {}) {
  return withBuiltInEntries(storage, 'recipes', builtInRecipes);
}

export function withoutBuiltInRecipes(storage = {}) {
  return withoutBuiltInEntries(storage, 'recipes');
}

export function builtInRecipeChanges(recipe) {
  return changedBuiltInFields(recipe, builtInRecipes);
}

export function getBuiltInRecipe(recipeId) {
  return builtInRecipes.find((recipe) => recipe.id === recipeId) || null;
}

export { builtInRecipes };
