# 大屏白板改版的实现依据

本次按目录检查了用户提供的七个参考项目，阅读各自 README，再追踪与选区、画板命令、工具带、语音和浮层相关的实现。参考目录 `ss/` 保持用户原样，不提交项目副本或其中的依赖。

| 参考目录 | 检查的主要代码 | 用在 Fcdraw 中的行为 |
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
