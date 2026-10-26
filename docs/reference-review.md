# 大屏白板改版的实现依据

本文件记录参考项目的历史实现依据。原出厂 APK 的实际行为、本轮修正和未完成项以 [HWhiteBoard 5.42 对齐记录](apk-alignment.md) 为准，不能将 Excalidraw 原能力等同于原出厂白板全部功能已对齐。

## 语言笔与学习卡片

2026-10-25 通过 GitHub MCP 核对 Read Frog 固定提交 `8dd8e35cc68051a2a0ea7ac64dff57c9f5ff2283` 的 [custom-action-templates.ts](https://github.com/mengxi-ream/read-frog/blob/8dd8e35cc68051a2a0ea7ac64dff57c9f5ff2283/src/utils/constants/custom-action-templates.ts)（文件 SHA `9bd4e6cd75f60e1fffe67ef638d425c68f26346d`）。其词典 / 句子模板将原文、目标语言、语音信息、含义和译文作为结构化字段，卡片按字段呈现；本项目复用已有 `languageStudy` 验证器和笔迹识别链路，没有引入浏览器扩展或第三方页面。

语言笔放在原画笔菜单。停笔后用原始轨迹识别，要求完整 JSON 和原文逐字一致，目标语言在请求开始时取界面语言；原文保留，译文沿用共享字体测量、附近空位与屏幕边界规则，以可编辑手写对象插在下方。原文 / 译文元数据在同次场景更新中保存，课件写当前批注页，单步撤销 / 重做。默认自动源语言使用已有英语轨迹模型，显式中 / 英设置仍受尊重；没有宣称内置识别器支持所有语言或识别率已验收。

双击原文打开 MUI 学习卡片，包含释义、发音 / 音节、结构 / 用法与例句；双击卡片隐藏，保留白板内容。缓存数据随对象持久化，移动 / 缩放后仍可用，轨迹变化 / 删除 / 换页使旧卡片失效，复制重映射双语组。切换界面语言后在下次打开时重新解释，加载可取消，迟到结果不重开。旧 `language.explain` 与单个外文词劫持普通 AI 问答的分支已移除；菜单主题入口关闭，没有删除仍在使用的编辑器包别名。

## 教学实验控件与 Agent

2026-10-25 继续通过 GitHub MCP 读取 LiveKit Agents 固定提交 `1f514fdec6dadd47c50a028b9d2c0f6fc432707a` 的 [tool_executor.py](https://github.com/livekit/agents/blob/1f514fdec6dadd47c50a028b9d2c0f6fc432707a/livekit-agents/livekit/agents/voice/tool_executor.py)（文件 SHA `72ce6d854ae6df132cfaabca4347b4ab4649df41`），核对工具归属、实际返回 / 异常、取消与终态；同时追踪用户本地 `ss/whiteboard-teacher-main/public/app.js` 的 play / playStep 和 `docs/SCRIPT_API.md` 的步骤顺序。仅采用当前 React 架构可落实的生命周期，没有导入 Python 服务或将普通 STT + TTS 声称为完整实时语音服务。

课程步骤现在允许 `tools`，先串行完成本步原有工具操作，再开始该步播报和绘图。生成 / 检查资源的准备循环提供真实对象、控件 ID 和版本，播放时复用；只读检查可声明 `expect` 的字段路径和标量值。结果不符或操作失败暂停，不先讲预设答案；继续时只重试未完成项，先前成功的插入不会重做。只接收 JSON 数据，不允许任意宿主代码、私有路由或递归启动课程 / 播报。每步最多 20 次、每课最多 60 次工具调用。

`commands` 为语音 Agent 与课程统一透传可取消命令的 AbortSignal。暂停取消支持该信号的请求；已发出但无法取消的操作等待完成，阻止后续步骤而不误重发。主课和追问分别归属请求，取消 / 替换后不启动旧播报；可见目标包含文档身份 / 页或白板身份。保存工具游标，恢复时跳过已完成写入，并重查末尾连续的只读后置条件；teacher 状态向助手提供实际结果和错误。固定实验回归覆盖 4 N → 10 N 后先确认 5 m/s² 再播报 / 板书、失败 / 暂停 / 续课 / 保存重开 / 追问替换与同名课件隔离，三分辨率生产页面只交 CI。

课程续修另通过 GitHub MCP 核对同一 LiveKit 提交的 [agent_activity.py](https://github.com/livekit/agents/blob/1f514fdec6dadd47c50a028b9d2c0f6fc432707a/livekit-agents/livekit/agents/voice/agent_activity.py)（SHA `18578f80570a2b87fc4313ab9118c2e382211175`）4089–4176：实际工具输出进入上下文后才生成后续响应。现在每步工具完成后、讲述 / 板书之前，教师读取当前可见状态和真实 iframe 输出，可调整未完成教案后缀；成功的工具游标不重放，失败可依据实际状态修复，三轮未收敛则暂停。规划只允许已有只读命令，修改仍走原执行器。模型等待中控件变化会拒绝旧观察；暂停 / 取消释放请求，迟到结果不继续写板。真实 MessageChannel 牛顿实验回归验证用户将 10 N 改为 12 N 后，重新观察 6 m/s² 并修复教案，不重复 setter。

仍是有边界的课程执行器：跨会话的实验状态与旧控件版本不会被猜测恢复；分支课暂保留失败暂停，全部原生工具取消、长时间异步实验观察和真实语音回声仍需完成。讲课文字 / 公式已接源坐标和字号布局，真实大屏阅读效果仍待验收。

课程记录移除原有 400 ms 卸载丢失窗口：步骤、已完成工具游标与测验进度变化立即进入共享写队列，重复字幕 / 语音边界不触发写入；读取等待已排队写入，避免多次保存互相覆盖。课件目标只保存名称 / 页元数据，不复制整页板书快照。组件与真实 IndexedDB 适配回归验证即时读回游标、并发保存不丢记录。

2026-10-25 通过 GitHub MCP 读取 MDN dom-examples 固定提交 `03ae1ffb325a9202d3a64f26ab5b8361392a5368` 的 [主页面](https://github.com/mdn/dom-examples/blob/03ae1ffb325a9202d3a64f26ab5b8361392a5368/channel-messaging-multimessage/index.html)和[子页面](https://github.com/mdn/dom-examples/blob/03ae1ffb325a9202d3a64f26ab5b8361392a5368/channel-messaging-multimessage/page2.html)，核对 iframe load 后转移 MessagePort 与读取回复的实际代码，并结合 [postMessage 文档](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)核对 opaque origin 必须使用通配目标。仓库的 `ss/agentboard-main/src/agent/prompts.ts` 和 `src/engine/validation.ts` 提供结构化动作、稳定对象 ID 与操作前验证依据；没有引入其独立页面或执行模型脚本的宿主入口。

`InteractiveResourceFrame` 按实际对象 ID 注册独立通道。固定 iframe bootstrap 只读取原生 input / select / button 与 output / status，设值或点击时校验类型、范围、步长、可选项、禁用和显示状态。`resources.inspect` 返回本次页面版本与控件 ID；`resources.interact` 必须携带该版本，返回事件执行后的实际 DOM 输出。生成 / 复用返回插入对象 IDs，主板和当前课件分别路由；等待加载、卸载 / 重载取消、切页 / 切板 / 删除和任务取消均有检查。消息只包含该实验的操作与回复，生成页面不能反向调用白板命令。

固定牛顿第二定律实验通过真实 JS / DOM 事件和 MessageChannel，验证 4 N → 10 N 时输出 2 → 5 m/s² 与图形位置变化；Agent 回归先读取控件再选择动作并观察结果。CI 三分辨率用真实助手和 iframe，仅在语音 / 模型供应商边界提供测试结果。本地不启动构建或服务，浏览器 sandbox 与原生 WebView 仍待 CI / 设备；DOM 输出并不认证生成的科学内容，任意自定义控件与异步实验的持续观察尚未实现。

## 录制窗口与后台小控件

2026-10-24 通过 GitHub MCP 读取 Meetily 固定提交 `a2cb62e827da7ef59f65064c97233efb2313878e` 的实际实现。它是用户指定的录制交互参考，白板工具与对象仍以原 APK 为主要依据。

| 参考文件 | 对应实现与验证边界 |
| --- | --- |
| [RecordingControls](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/RecordingControls.tsx)，文件 SHA `2a4c720f08cd6833e17599f5d83a70c625f65338`；[RecordingStatusBar](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/RecordingStatusBar.tsx)，`057f8d2883081da9524539ae603676f999a8172e` | 录制模式与开始操作集中显示，暂停 / 继续、停止、活动时长独立；Fcboard 使用现有 MediaRecorder，暂停期间排除时长且停止 ASR，继续复用录音会话与麦克风。没有复制 Tauri 接口。 |
| [TranscriptPanel](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/app/_components/TranscriptPanel.tsx)，`793f25505fb77ee82895e586448a6cf536c76dad`；[TranscriptView](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/TranscriptView.tsx)，`5d3ff5e2a846f535753e5b8821904db539f56808` | 文稿独立滚动，时间戳单列；向上查看时不强行拉回底部。显示原始最终转写，不复制会改写原文的词语清理和逐字装饰。 |
| [MeetingDetailsSplitView](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/MeetingDetails/MeetingDetailsSplitView.tsx)，`f4577c82a77bb2637be9963ed9e677b0a85cc33e`；[TranscriptPanel](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/MeetingDetails/TranscriptPanel.tsx)，`3770693f917746adece44e5a0f712e03dc634978` | 录后宽屏显示文稿 / 总结双栏，窄屏切换页签；时间戳定位真实媒体播放位置，编辑与删除收进 MUI 菜单。保留总结全屏、联合保存、二维码分享。 |
| [SummaryGeneratorButtonGroup](https://github.com/Zackriya-Solutions/meetily/blob/a2cb62e827da7ef59f65064c97233efb2313878e/frontend/src/components/SummaryGeneratorButtonGroup.tsx)，`dc7f24b3ff17a537344639caca64dd7b7869c9bd` | 总结使用真实处理状态；未有文稿时禁用生成，失败保留已有媒体与文稿。未引入其模板服务或后台任务接口。 |

用户要求录制时继续操作白板，因此开始后自动收起窗口，显示可拖动的 MUI 小控件；拖动只由时间区发起，按钮分别执行暂停 / 继续、停止和恢复窗口。位置限制在视口，取消手势回滚，恢复再收起保留位置；停止立即回到收尾窗口并等待最后转写。这里的后台运行指同一应用内使用白板，Android 切出应用 / 锁屏录制尚未验收。

依据已安装 DOM 类型、[MediaRecorder.pause](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/pause) 和 [MUI Tabs](https://mui.com/material-ui/react-tabs/)；组件与生命周期回归覆盖单一会话、排除暂停时长、尾句收集、拖动与恢复。新增 1440 / 3080 / 390 宽度生产页面测试使用 Chromium 实际 MediaRecorder 和模拟 ASR，只交 CI 执行，不代表真机麦克风准确率。

本次按目录检查了用户提供的七个参考项目，阅读各自 README，再追踪与选区、画板命令、工具带、语音和浮层相关的实现。参考目录 `ss/` 保持用户原样，不提交项目副本或其中的依赖。

当前交互以用户最新要求为准：保留原圈选操作，仅增加一个 AI 操作，点击后识别并按内容路由；普通书写和选择变化不会请求模型。圈选、截图和回答位置使用同一组区域边界；OCR、本地数学、文字问答及视觉理解按任务分工，详见 [AI 效率与验证记录](ai-performance.md)。函数生成后仍可直接调参，坐标轴与曲面共用投影。

| 参考目录 | 检查的主要代码 | 用在 Fcboard 中的行为 |
| --- | --- | --- |
| ai-math-tutor-main | `apps/web/components/math-tutor/math-tutor-workspace.tsx`、`lib/math-tutor/canvas-context.ts`、`apply-tutor-actions.ts`、`tutor-action-layout.ts`，以及 agent 的 `canvas_vision.ts` | 优先使用选区，截图和结构化文字一起交给视觉模型；返回对象写入画板，计算结果放在输入旁边。 |
| ai-tutor-main | `frontend/web/components/Whiteboard.tsx`、`components/whiteboard/SketchBoard.tsx`、`lib/voice.ts`、`lib/useVoiceDirector.ts` | 图形与说明使用各自适合的呈现方式；播报只有一个播放者，关闭、重新播放和语音输入均可停止播报。 |
| ai-whiteboard-main | `client/src/pages/whiteboard.tsx`、`whiteboard/commandTypes.ts`、`ScriptRunner.ts` | AI 输出先转换为受验证的命令，再写入对象；操作状态、失败和可中断操作明确呈现。沿用当前画板元素 API，不运行模型生成的任意脚本。 |
| InkTeach-main | `src/InkUi/FullUi.cs`、`src/InkEngine/Ui.cs`、`Selection.cs`、`ScreenCapture.cs` | 一条底部工具带，保持工具顺序；属性按需展开；选区操作依附现有选择工具。Windows 屏幕抓取 API 不适用于安卓，截图继续使用画板导出接口。 |
| teach-learn-whiteboard-main | `src/main.ts` 的 `captureSnapshot/sendTurn`、`ai/context.ts`、`agent.ts`、`tools.ts`、`ui/transcriptPanel.ts` | 截图和提问绑定，避免显示旧截图却发送新画面；白板写入与文字浮层分开；持久化原始对象，可撤销、擦除和重新编辑。 |
| whiteboard-teacher-ai-main | `src/components/Whiteboard.tsx` 的 GraphWidget、拖动和图表层，`src/lib/gemini.ts` | 函数生成后直接提供参数调节，参数随图形对象保存。当前项目使用可编辑坐标轴与线条，而不是额外 DOM 图表覆盖画板。 |
| whiteboard-teacher-main | `public/board.js`、`listen-worker.js`、`backends/listening/browser-transcribe.js`、`README.md` | 本机语音与系统语音分成可选后端；识别处理不阻塞画笔。安卓使用 Moonshine 原生库和 AudioWorklet，共用录制音轨。 |

## 语音依赖与边界

语音打断续修依据同一 LiveKit agent_activity.py 第 2362 行起中断当前播报 / 生成及文本证据门控，详见[云端语音记录](cloud-speech.md)。复用原三秒分句、AbortSignal、命令路由和 narrator.finished；没有导入独立语音服务或复制 Python 音频管线。

- 已核对 Moonshine 官方文档、Maven Central 0.1.5 元数据及 sources JAR 中的 `Transcriber`、`MicTranscriber`、`TranscriptLine`、`JNI`、`ModelSpec` 和 `Models`。
- 官方 AAR 的最低系统为 API 26，Android 最低版本同步为 8.0；没有绕过库的 Manifest 兼容性检查。
- APK 内置 `ai.moonshine:moonshine-voice:0.1.5` 和中文 Tiny Streaming `quantized_26_08_24`，不调用系统识别服务，不在运行时下载模型。模型文件大小及 CRC32C 来自官方固定提交 `234f60faa0eb388b01cdf7e60aca232af37aefda`。打包时验证全部八个文件；发行包包含 MIT 声明。
- WebAudio 的同一麦克风音轨用于录制与离线转写，AudioWorklet 在音频线程采样，原生单线程队列运行识别。取消后的结果不会继续执行指令。
- 核对 IndexTTS 官方 `pyproject.toml`、`indextts/infer_v2.py` 及 `tests/test_v2.py`。官方 IndexTTS 是 Python/PyTorch 语音合成库，没有官方安卓嵌入接口。因此提供真实可选的局域网播报适配器；未把远程服务称作内置安卓模型。
- Astryx MCP 的 ButtonGroup 文档、Swift MCP 的工具栏规范用于核对分组和交互；CLI 的实际 manifest/discover 已核对。该仓库没有 Astryx Core，CLI 的 `build` 返回缺少包，保留既有 React/SCSS 组件体系。

## 验证策略

本地仅安装依赖并运行 test、check、lint、格式检查和 Python 适配器测试。Web 打包、浏览器生产页面检查和安卓打包全部放在 GitHub Actions。浏览器检查覆盖 1920、1280、800、390 宽度，验证单一底栏、上弹菜单、选区函数参数和自动等号补全，并保存截图及失败追踪。

## 本轮完整教学流程的实现映射

继续沿各项目 README 追踪了实现，而非按介绍添加并列按钮：

| 参考项目与代码 | 落地行为与当前实现 |
| --- | --- |
| ai-math-tutor：`canvas-protocol.ts`、`apply-tutor-actions.ts`、workspace 的选区 / 图像上下文 | `Teacher.tsx` 读取当前选区、图像、文字和教学步骤；`lesson.ts` 在共享画板逐步写推导，AI 擦除只作用于本课内容，保留学生笔迹。 |
| ai-tutor：`lessonMachine.ts`、`useTeacherQuiz.ts`、`useConfusionRadar.ts`、`useVoiceDirector.ts` | `teaching.ts` 的课程 / 暂停 / 追问 / 测验状态；`narration.ts` 单一播报所有者；答错和明确反复追问影响速度与提示词。提供字幕、图形语音描述、易读和短步骤设置，不推断残障或虚构学习诊断。 |
| ai-whiteboard：`commandTypes.ts`、`ScriptRunner.ts` | `lesson.ts` 严格验证命令后逐字写文本、生成 MathJax 公式、按距离展开线条与路径、画箭头和批注，支持局部擦除 / 清批注 / 等待；动画可暂停、取消并尊重减少动态效果设置，用户修改后不补回该笔画。 |
| InkTeach：`FullUi.cs`、`Selection.cs`、`ScreenCapture.cs` | `FilePreview.tsx` 课件上覆盖透明板书层，关闭开关后直接操作课件；按页保存、圈选、橡皮、撤销 / 重做。`TeachingTools.tsx` 提供量角器、直尺和立体几何。使用安卓 PixelCopy 捕获本应用窗口，未移植 Windows GDI。 |
| teach-learn-whiteboard：`main.ts` 白板管理、`ai/tools.ts`、docRAG | `boards.ts` / `BoardSwitcher.tsx` 保存图片、视图与各板内容，切换前持久化，失败保留原板；`commands.ts` / `canvasCommands.ts` 将语音、文字与手动组件操作接到同一条命令路由；`materials.ts` 本机分页原文检索与真实页码引用。 |
| whiteboard-teacher-ai：`Whiteboard.tsx` 的 GraphWidget / 动态组件 | 函数二维 / 三维图形和参数保存为可编辑对象；`widgets.ts` 的旋转几何、计时器、单摆与抛体计算使用实际参数和时间，主白板和课件透明层共用。 |
| whiteboard-teacher：`docs/SCRIPT_API.md`、`public/app.js`、`board.js` | 每个教学步骤的讲述与板书完成后才进入下一步；触碰 / 语音暂停，追问独立回答后显式续课，课程末尾测验。使用现有模型接口，不复制参考项目的服务端部署或额外账号体系。 |

课堂功能沿原菜单和工具操作进入；圈选后的唯一 AI 操作点击后才识别并执行；教学和工具属性仅按上下文出现，没有叠加第二条常驻工具栏。课件打开后命令写入当前可见透明层，避免操作背后的白板。低级绘制命令不向模型暴露任意脚本执行权限。

新文档依赖核对了 GitHub 官方代码、Web-PPT 文档和**实际安装的 0.4.5 类型**，以及 OpenDocument WASM README / **7.5.2 类型**；未套用最新主分支的不同 API。文档解析在线程执行，输出放在无同源权限的 sandbox iframe；不引入云端 Office 预览。AI 只引用确实提取的原文，不把未做 OCR 的扫描页当作可检索文字。浏览器 Office 的视觉上下文为文本加独立板书，安卓使用真实窗口截图。Office 排版和媒体兼容性仍由解析引擎决定，不能等同桌面 Office 全兼容。

本轮增加课程状态机、语音所有权、白板持久化失败、文档可见层命令路由、工具物理参数、逐步渲染和公式测试；浏览器 CI 下载固定提交与 SHA256 校验的 Apache POI / PDF.js 样本，实际打开 PPT、PPTX、DOC、DOCX、XLS、XLSX、PDF。Android CI 使用真实 PixelCopy 桥接截图和内置 Moonshine 模型。模拟识别文本仅验证指令路由，不被当作目标大屏麦克风或中文识别准确率验收。

图形双击续修：`WhiteboardTools` 的选择入口实际进入 lasso，原 `App.handleCanvasDoubleClick` 在该模式提前返回，导致主板立方体 / 圆柱双击无法到达 `app/App.tsx` 已有 `tools.configure` 动画。本轮在旧编辑入口之前仅转交语言对象和这两类图形，普通圈选对象保持原行为；编辑器回归覆盖回调与不进入内部路径，生产页面三分辨率改为双击实际着色面展开 / 合起，尚待 CI 运行。

## 原设置与助手共用配置

`canvas.configure` 的字段来自当前 `BoardSettings` / `FactoryPenSettings` / `WhiteboardTools` 和已安装的 `AppState`：背景色 / 0–13 图案、细粗笔档、自动笔尖与接触阈值、0–50 笔锋变化、橡皮大小 / 模式、手背阈值、主板多点和工具栏方向。复用 `switchWhiteboardTip` 保存 / 恢复颜色、笔型和笔宽，使用 `canvasStrokeColor` 保留原背景对比色行为。手动设置与命令共用整批校验和同次更新，没有任意状态写入入口，也不暴露密钥。

`canvas.inspect.configuration` 与命令结果提供实际配置 / CSS 像素单位，设备默认值沿已有 App 校准属性传入。自动笔尖必须有显式或原设备阈值。命令等待真实 React 提交，取消 / 卸载 / 目标失效释放等待；宿主未提交不得返回成功。课件检查只读取 FilePreview 自己提供的实时配置快照，不新增背后画板读取。课件当前不支持背景、多点笔与对象橡皮，命令明确拒绝这些参数，其他共享笔 / 手背 / 橡皮尺寸作用于下一笔。

背景回归实测发现原图案未加入历史观察，原 CaptureUpdateAction 不能单独使其可撤销；现把 whiteboardBackground 加入既有独立背景快照及 delta，与颜色同次撤销 / 重做。普通书写偏好仍按原规则保存，既有笔迹不被配置修改。真实编辑器 / MUI / Agent / 课件回归覆盖这些行为，物理双尖校准仍需真机。
