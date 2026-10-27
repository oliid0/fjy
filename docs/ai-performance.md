# 圈选、识别与响应效率

圈选沿原操作增加唯一“AI”入口，点击后识别并按内容分流到计算、函数或问答。普通书写、停笔和选择变化不请求模型，旧 `autoMath: true` 不启动自动补全。显式选择文字 / 函数 / 算式 / 语言笔后，停笔才自动识别；数学的结构、求值与本地绘图边界见[手写数学链路](math-pipeline.md)。

## 当前链路

1. 原厂选择工具按手指经过的实际路径逐点显示一条开放线，松手后按圈定区域选择完整对象，不切割原笔迹。新的选择清除旧轨迹；选中框按对象范围显示，内部拖动 / 角点缩放操作对象本身。主板 / 课件共用场景坐标、复合对象归属和单步历史，临时路径不进入持久化。
2. 点击按钮后，完全位于圈选区域内的已有文本与完整 AI 手写字形直接读取文字；部分圈选和其他笔迹优先使用原生 Digital Ink；原生不可用或无纯笔迹输入时，才按配置使用云端专用 OCR 与本地 PaddleOCR。云端优先窗口为 250ms；云端失败时立即采用就绪的有效本地结果，窗口过后采用先通过校验的一方。胜出或取消后取消另一请求；识别文字与计算分开校验，不以能够算出答案为条件改选低排序识别候选。仍保留显式纯本地 / 纯云端设置；未配置密钥时自动本地处理。课件始终裁切实际页面，保留批注下的内容，滚动 / 缩放后更新裁切坐标。相同选区缓存识别文字，重复执行不重复 OCR。改选、修改源笔迹、换页或取消会使旧结果失效。
3. 计算由 MathJS / Nerdamer 本地执行；`y=...`、`f(x)=...`、`x^2` 等函数本地绘制；`fx=y` 插入坐标系。默认只发送确实识别的文字和对象几何；设置启用选区截图后，文字及图形问题均附加当前选区画面并使用视觉模型。不从未附图的对象猜测图示内容。明确的讲课、录制、标注等操作继续进入原命令路由。图像生成使用独立图像模型，生成结果插入当前白板或课件透明层。
4. 默认回答使用手写风格。可用的数字 / 拉丁字符生成普通矢量笔迹，支持局部擦除和撤销；中文等字符使用可编辑的手写字体文本。没有承诺复制用户个人笔迹。

Android 有原始笔迹时优先调用 ML Kit Digital Ink 18.1.0，与 APK 的 `HSlide.createSmaText` 相同，保留采样与笔顺、应用对象旋转和圈选裁切，不先截图。中英文及形状共八个模型文件的 Google 地址、压缩 SHA1、展开 SHA256 与原 APK model.zip 对应。原厂注册元数据的 owner 迁移为本应用包名，不复制 SDK 安装身份；新增 Android 仪器测试检查注册及真实中英文轨迹识别，尚待 CI / 设备执行。

Web / 栅格识别保留官方 `@paddleocr/paddleocr-js@0.4.2`、PP-OCRv5 mobile det / rec，通过 Worker 与单线程 WASM 执行。模型和匹配 Worker 的 ONNX Runtime 1.24.3 随应用打包，空闲时提前加载模型，不截图、不推理、不消耗 token；首次点击不访问模型 CDN。`scripts/ocr-models.json` 固定文件大小、SHA256 和来源；`node scripts/fetch-ocr-models.mjs` 只准备资源，不编译应用。网页按使用缓存这些资源，避免启动时预缓存整个模型。

文字笔复用同一按需识别接口与后端设置。显式选择文字 / 图形 / 魔术 / 函数 / 算式 / 语言笔时才启动该笔型的处理；普通画笔保持纯书写。识别中继续写字会取消旧任务并合并尚未转换的笔画；识别失败保留原笔迹。

## 实测与范围

桌面 Chromium 141，使用真实发布 Worker、模型文件与 WASM，未调用云端：

| 输入 | 准备 / 识别耗时 | 结果 |
| --- | --- | --- |
| 首次初始化 | 约 1.5–1.6 秒 | 两个本地模型加载成功 |
| 斜体 `1+1=` | 首次 166–177ms，复用约 110ms | `1+1=` |
| 单线手写字形 `1+1=`，白底黑字 | 102–103ms | `1+1=` |
| 同样字形，绿底白字 | 98–102ms | `1+1=` |

这些样本是手写风格字形，不能据此保证真实手写识别率、复杂二维公式结构或 RK3576 大屏的耗时。`e2e/ocr.spec.ts` 在 CI 使用真实离线模型，验证点击前零请求、点击后识别并写入矢量答案、全程零方舟请求。复杂公式可在设置选择云端 OCR；OCR 与快速问答支持各自指定模型 ID。

## 方舟与密钥

传输同时支持 `/api/v3/chat/completions` 与 `/api/v3/responses`，转换图片 / 文本输入并读取 `output_text`。默认主模型为 `doubao-seed-2-0-mini-260428`；已有自定义模型保留，空模型配置采用新默认值。Chat 使用 `thinking.type=disabled`，Responses 使用 `reasoning.effort=minimal`；课程规划也不再强制深度思考。方舟请求发送 `service_tier=fast`，优先低延迟在线额度，无额度时服务端按文档回到常规在线推理。OCR 限制输出为数学 256 / 文本 1024 token，云端 OCR 请求最多等待 6 秒；本地并行结果不等待这个超时。图像使用 `/api/v3/images/generations` 和独立的图像模型 ID。

浏览器与新的 Android 桥接都增量读取 SSE，处理任意字节 / UTF-8 / 帧边界、错误与终止事件。问答与总结可以提前显示文字；完整文本验证通过后才写入白板，JSON 工具也只在完整响应后执行。截断、取消与旧选区不会执行半段命令。原生 HTTP 在取消时断开连接并移除监听。

上下文使用方舟隐式前缀缓存：同一端点、密钥、模型、稳定 system 规则绑定进程内不透明 `prompt_cache_key`，最多保留 16 组路由。OCR 的固定规则与动态图片分开，不添加额外缓存创建请求，也不把旧选区 / 旧答案作为新题上下文。命中与实际速度由服务端决定，未测量时不宣称缓存命中或毫秒级大屏响应。

`hs_apikey` 仅供终端诊断读取，可放在被忽略的 `.env.local`。运行 `node scripts/check-ark.mjs` 默认以 Mini 分别流式测试 Chat / Responses，各重复两轮，输出真实首 token / 完成耗时、实际服务档位和 token 用量，隐藏密钥；`ARK_MODEL` 可覆盖模型。短测试不保证达到隐式缓存阈值。该脚本不会进入前端；Android 的实际请求读取应用运行时设置。

本机已读取密钥，但当前网络对方舟域名的 TLS 连接直接关闭。Node、Python、curl、Chromium 及独立解析地址均未取得 HTTP 响应，因此尚无真实模型推理速度或密钥有效性的结论。

## 语音

Android 已有 Moonshine 0.1.5 与固定版本中文 Tiny Streaming 模型。本轮将模型准备改为实际预加载，指令之间复用模型、创建独立音频流；新安装 Android 默认使用本地语音，保留用户已保存的选择。AudioContext 在用户点击时立即恢复，再等待模型准备，避免失去激活时机；12 秒没有收到 PCM 时结束会话并报告真实原因。中文系统服务缺失、空结果、无声音错误或无法启动时，释放系统会话后回退内置中文识别。系统识别跟随当前界面语言；中文离线模型不冒充其他语言模型。音频仍来自共享麦克风与 AudioWorklet。系统适配独立为 `SystemSpeechPlugin` / `systemSpeech.ts`：主线程启动、最终结果、30 秒上限、取消 / 后台释放；静默的连续会话等待终止回调再重启，取消不重新打开离线麦克风。备用 Moonshine 可提前准备，不与系统服务抢占第二个麦克风。

新增的 Android 仪器测试使用中文语音样本，连续两次识别“请帮我画一个圆”，检查关键词；原静音加载测试继续保留。受本轮禁止本机编译的约束，新增 Java 的编译和实际模型语音测试须由 CI 完成，尚未视为真机通过。

## 参考依据

- 本机 `ss/HWhiteBoard-reference/java/com/paike/zjc/tool/HTool.java`、`layer/SelectCacheLayer.java`：真实路径区域命中、选后操作、搜索及缩放。此前 CircleToSearch 截图矩形方案已替换。
- [PaddleOCR 官方浏览器部署文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.md)及本机 `ss/PaddleOCR-main/paddleocr-js`：创建参数、Worker 协议、模型资源、输出文字与置信度。
- [Moonshine 0.1.5](https://repo.maven.apache.org/maven2/ai/moonshine/moonshine-voice/0.1.5/)的 sources JAR 与[上游 Java API](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/language-bindings/android/java/main/java/ai/moonshine/voice/Transcriber.java)：模型加载、独立流、0.5 秒更新与完成事件。
- [HersheyTextJS](https://github.com/techninja/hersheytextjs/tree/262f4782cd412ee539eb43d4d9d9b92562d7590b)：数字 / 拉丁字符的单线字形，保留 MIT 声明。
- [方舟深度思考](https://docs.volcengine.com/docs/ark/deep-thinking?lang=zh)、[图像生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)：请求字段及任务分工。

- [方舟 Chat API](https://docs.volcengine.com/docs/ark/chat-api?lang=en)、[Responses API](https://docs.volcengine.com/docs/ark/create-model-responses-api?lang=en)、[上下文缓存](https://docs.volcengine.com/docs/ark/context-cache?lang=en)：关闭思考、fast、SSE 事件和缓存路由的协议依据。
- [Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer)、[现用社区插件的停止问题](https://github.com/capacitor-community/speech-recognition/issues/127)：最终结果等待与 cancel / destroy 生命周期的依据。

## 语言笔与可复用资源

Read Frog 的固定模板与当前落地依据见[参考记录](reference-review.md)。语言笔沿用轨迹优先识别和现有模型接口，目标语言绑定开始请求时的界面语言，返回完整翻译、词性 / 释义、发音 / 音节、语法 / 用法和例句 JSON；原文逐字校验，不把普通 AI 问答劫持为查词。原笔迹保留，译文作为可编辑手写对象写到原文下方附近空位，使用源字号 / 颜色和共享换行边界。主板 / 当前课件同次保存元数据与译文，支持单步撤销。

双击原文打开保存的学习卡片，双击卡片隐藏，不再把整段学习说明写满白板。重复打开使用有效对象数据；原文改变、删除、换页或取消使旧结果失效。界面语言切换后，下次打开按新语言解释，加载可取消，迟到响应不重开；最多缓存 16 份有效目标语言结果。默认自动源语言用捆绑英语轨迹模型，显式中 / 英设置保留，不宣称任意语言的离线识别已可用。真实识别率和翻译质量仍需样本 / 真机验收。

资源库描述现在生成自包含教学 HTML，保存至独立 IndexedDB，以一个 sandbox iframe 对象插到当前可见白板 / 课件。资源须以可交互 SVG / canvas 图形为主，包含实际输出及说明，禁止用表单或问卷替代演示；固定 MessageChannel 让教师检查 / 操作实际控件，返回真实输出，主页面不执行模型任意命令。取消、换板 / 换页和卸载拒绝旧结果；已有资源可以再次插入和删除。保留原 231 项、网络提供器与 PhET 学科清单；生成实验的科学内容和原厂全部教学资源仍待审核。

## 活动笔迹与工具观察

活动墨迹由独立 NewElementCanvas 承载，只追加当前曲线几何；静态层排除活动对象，移动样本不重播完整场景。提交 / 取消 / 视口变化时完成层间交接。边界计算使用循环，长笔画不通过展开参数调用 min/max；普通笔尾锋、钢笔压力与局部擦除共用实际轮廓，保留真实压力和尾部采样。几何 / 增量复杂度与大点集回归通过不等同教学屏物理延迟通过。

连续任务执行后读取真实画布、可见 UI、HTML 测量输出及动态命令。当前请求自己的文件 / 页 / 板切换可继承目标，手动切换仍取消旧请求。录制可接手当前语音流，停止保存后恢复指令监听；本地 / 云端 / 系统回归只证明生命周期和路由，不能证明真实转写质量。
