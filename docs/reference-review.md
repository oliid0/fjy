# 大屏白板改版的实现依据

本文件记录参考项目的历史实现依据。原出厂 APK 的实际行为、本轮修正和未完成项以 [HWhiteBoard 5.42 对齐记录](apk-alignment.md) 为准，不能将 Excalidraw 原能力等同于原出厂白板全部功能已对齐。

本次按目录检查了用户提供的七个参考项目，阅读各自 README，再追踪与选区、画板命令、工具带、语音和浮层相关的实现。参考目录 `ss/` 保持用户原样，不提交项目副本或其中的依赖。

当前交互以用户最新要求为准：随手圈选后显示计算、图像、问答三个小按钮，点击才识别；普通书写和选择变化不会请求模型。圈选、截图和回答位置使用同一组区域边界；OCR、本地数学、文字问答及视觉理解按任务分工，详见 [AI 效率与验证记录](ai-performance.md)。函数生成后仍可直接调参，坐标轴与曲面共用投影。

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

课堂功能沿原菜单和工具操作进入；圈选后的三个按钮明确选择计算 / 图像 / 问答，点击后才执行；教学和工具属性仅按上下文出现，没有叠加第二条常驻工具栏。课件打开后命令写入当前可见透明层，避免操作背后的白板。低级绘制命令不向模型暴露任意脚本执行权限。

新文档依赖核对了 GitHub 官方代码、Web-PPT 文档和**实际安装的 0.4.5 类型**，以及 OpenDocument WASM README / **7.5.2 类型**；未套用最新主分支的不同 API。文档解析在线程执行，输出放在无同源权限的 sandbox iframe；不引入云端 Office 预览。AI 只引用确实提取的原文，不把未做 OCR 的扫描页当作可检索文字。浏览器 Office 的视觉上下文为文本加独立板书，安卓使用真实窗口截图。Office 排版和媒体兼容性仍由解析引擎决定，不能等同桌面 Office 全兼容。

本轮增加课程状态机、语音所有权、白板持久化失败、文档可见层命令路由、工具物理参数、逐步渲染和公式测试；浏览器 CI 下载固定提交与 SHA256 校验的 Apache POI / PDF.js 样本，实际打开 PPT、PPTX、DOC、DOCX、XLS、XLSX、PDF。Android CI 使用真实 PixelCopy 桥接截图和内置 Moonshine 模型。模拟识别文本仅验证指令路由，不被当作目标大屏麦克风或中文识别准确率验收。
