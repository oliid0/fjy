# 大屏白板改版的实现依据

本文件记录参考项目的历史实现依据。原出厂 APK 的实际行为、本轮修正和未完成项以 [HWhiteBoard 5.42 对齐记录](apk-alignment.md) 为准，不能将 Fcboard 原能力等同于原出厂白板全部功能已对齐。

## 2026-10-28 密码开关纠正

逐项读取原版 `java/com/paike/zjc/popu/QRHttpPopu.java` 的 `initView` / `syncPhotoPwdIfReady` / `disablePhotoPwd`、`http/ScreenshotPwdUtils.java`、本地 `SetPwdHandler` / `GetPwdHandler` / `GetPhotoHandler`，以及 `resources-from-unpacked-archive/assets/web/photo.html` / `js/util.js`。原行为为：二维码先生成，保护默认关闭；开启显示可编辑的四位数字，满四位且与上次不同才同步；关闭隐藏密码并将服务端密码清空。保护切换不改变二维码链接。扫码端仅在保护开启时显示密码输入；原网页没有“三次失败断连”规则。

`ShareQRCode.tsx` 依据 `resources/res/layout/http_popu_view.xml` 的 487×380dp 面板、24dp 圆角、147dp 二维码、44×22dp 开关及 `qr_password_switch_on/off.xml` 的原色 / 轨道尺寸移植，窄屏允许描述折行。静态页面分享和本地实时分享共用该控件；实时分享关闭 / 重开浮窗保留同一会话的开关状态。Native 桥在既有 BoardShareServer / LanServer 上更新密码，默认分享不传密码；不是创建分享前增加验证步骤。已有 HTTP / WebSocket 传输继续使用当前项目架构，条件验证沿原网页行为接入；图片也在服务端校验访问。没有照搬原网页将密码下发客户端比较的实现。

此前没有原版依据的 4–128 位密码限制、三次失败断连和未接入的自拟云中继草稿已移除。云端部署及统一云 / 本地入口仍为未完成项，不因本地密码开关接通而报完成。前端回归覆盖默认关闭、四位 / 不满四位、改码、关闭清空、链接不变、失败恢复和浮窗重开；Java 实际网络回归已补，遵守本地禁用构建约束，待 CI 执行。

## 2026-10-28 真机反馈续修

设置继续按用户最新要求移除保存 / 测试按钮，AI / 语音配置修改即保存，密钥仍按“记住”选择保留在会话或本机；URL 在失焦时验证，实际请求沿既有 validateEndpoint 校验。首页 → AI 与语音 → 四组设置使用独立层级与返回，旧 Toolbox 已删除。新增邮件字段使用嵌套语言键，覆盖率按实际缺口重新计算；未翻译的新项沿原 i18n 英文回退，不宣称所有语言新增字段已翻译。

网页额外逐段读取 `ZXStudyFloatingWindow.java` 的 `setupTouchLogic` / `handleDragEvent` / `handleResizeEvent` 与 `zx_study_floating_window.xml`。拖动使用实际 pointer / raw 坐标差，缩放更新同一窗口尺寸；响应式最小尺寸按当前视口限制，未照搬该固件的 2000 / 1000px 下限。网页四个导航图标、缩放图标直接来自原 drawable path。React 资源窗口与原生 WebView 都保留已加载内容；拖动 / 缩放不创建第二个实验。主板窗口松手提交一次可撤销坐标修改，课件更新同一 ink.resource 的位置和尺寸。默认居中来自用户新增要求；原 `showMinWebPopupWindow` 的 8388629 为右侧垂直居中，不写成原版即居中。

教学生成允许 JSON 中的 HTML 或模型直接返回的完整 HTML，仍经既有图形 / 脚本 / sandbox 验证器；无效输出最多一次完整纠正请求，失败不保存。生成 HTML 不走图片文件归一化。前端组件回归已覆盖同一 iframe 在多个缩放下拖动 / 缩放 / 取消，原生 MotionEvent 和“牛顿力学”页面实际交互回归待 CI；安装报告“保存不支持的类型”尚无对应真机堆栈，不将响应格式修复说成已定位其唯一根因。

复核原厂 `HInsertSettingWindow` 的选表后手动放置 / 默认百度图片或 Google 网页入口、`HMindMappingOBject` 的四向动作、`layout_min_web_window.xml` 的 400×600dp 窗口 / 18dp 横向滚动条 / 四按钮，以及 `FitWidthWebView` 的长按导入。当前表格先确认再触控放置并继承笔色，图形支持连续点放 / 拖拽和保留上次宽高；尺规在选择工具下保留命中层，圆规内部可拖。浮动工具 / 节点的手背和笔侧键交回实际画布擦除。主板与课件不再强制手背走局部模式。

手写依据仍为 `ModelManager.recognize` 的 ML Kit 18.1.0 与 `HSlide.createSmaText` 的 1ms 递增时间。候选不自行重排；四线格不再强制英语。`fx` 简写在本地规范化，函数笔按本次相邻笔迹隔离旧失败区域；竖式结合真实横线位置与两行操作数，结果在横线下右对齐。复杂二维除式仍需更多真机样本。

语音逐项阅读 `ss/pipecat-main/src/pipecat/turns/user_turn_controller.py` 及其 function-call mute 策略、`ss/agenticSeek-main/sources` 下 speech_to_text / interaction / echo_filter / memory 代码，采用有界多轮历史、工具真实结果、轮次队列和播放回声检查。继续说话排队，不取消正在进行的工具；明确停止仍可中断。板书更正复用真实 lessonId / tutorId，保留已有位置与样式。Siri 动画使用用户提供 Swift 的原图层和 12 秒旋转 / hue / 3D 参数，暂停五秒内可继续。

本地 ASR 中间事件依据项目实际 Maven 依赖 `ai.moonshine:moonshine-voice:0.1.5` 的 sources.jar 中 `TranscriptEvent` / `TranscriptLine` / `Transcriber`，并核对[官方流式转写文档](https://github.com/moonshine-ai/moonshine/blob/main/docs/using/transcription.md)。本地桥传递 Started / Updated / TextChanged / Completed / Error；云端使用现有已验证的 utterances / definite / start_time。中间稿只显示，不作为指令或持久稿；最终行保留暂停时间修正。无文字稿也允许保存真实媒体，不以摘要作为保存前提。

魔术笔先区分文字与画图，文字转铅笔素描提示词，画图附原图转彩色 3D。输出须有透明背景；无 alpha 的纯白底仅移除与画布边缘相连的白色，保留主体内部白色并裁切透明边缘。不接受彩色不透明矩形；失败保留源笔迹。模型分类、绘图质量、真实候选一致率及硬件声学 / 触感尚不能由模拟测试证明。

## 2026-10-27 原厂交互与全控件操作

本轮依据 `ss/HWhiteBoard-reference/README.md`、`java/com/paike/zjc/tool/HTool.java`、`layer/SelectCacheLayer.java`、`object/HCurveObject.java`、`object/HBezierObject.java`、`object/HShapeObject.java`、`data/HDataSet.java` 及 IMG_1251–1279。HTool 在移动中按接触宽高转为擦除，SelectCacheLayer 保存真实路径、区域和选后操作；CircleToSearch 的截图矩形方案已替换。原背景色、普通笔尾锋与固件开关来自 HDataSet；图形按 IMG_1254 补为 20 项。代码与单测不证明逐像素一致。

主板活动笔迹由独立 NewElementCanvas 增量绘制，静态层排除活动对象；Canvas / SVG / 擦除共用实际笔迹轮廓。长笔画边界移除展开参数，增加大点集与增量复杂度回归。手背在落点或合并采样尺寸变大时切入擦除；没有目标屏崩溃堆栈或物理时延测量，不将这些修复等同整机验收。

AI 控件依据现有组件与真实 DOM：commands.ts 绑定组件操作，uiControls.ts 仅检查当前编辑器及精确 owner 的弹窗，以稳定 ID / 版本执行真实 click、set、key、drag 并重读状态。SVG 尺规手柄、MUI 选项与分页均有回归，不开放任意选择器或脚本，密钥只返回是否设置。languageCommands.ts 读取当前可见选区的文字 / 原始笔迹 / 栅格，复用现有翻译与插入；课件打开时不读取背后白板。

既有 MessageChannel 扩展至实际 SVG / canvas 图形子节点，返回 CSS 像素边界、分页、控件 ID 和真实输出。新增脚本回归拖动牛顿实验质量块后，由页面自身事件计算数值及位置；生成资源以图形交互为主，form 不被当作教学动画。对象 / 页 / 版本 / 取消检查与 iframe sandbox / CSP 保留。

连续任务只继承当前请求自身的开课件、翻页与换板，用户手动切换仍取消旧任务。录制与指令使用既有音轨及队列，停止保存后恢复监听；工具失败只修复剩余操作，不重放成功步骤。教师规划只读：ui.inspect 可检查控件，web.action / signal.action 仅 action=read 可在规划阶段执行，修改保留在正式步骤。

原生信号源依据 [TvInputManager](https://developer.android.com/reference/android/media/tv/TvInputManager)、[TvView](https://developer.android.com/reference/android/media/tv/TvView)、[TvContract](https://developer.android.com/reference/android/media/tv/TvContract) 使用真实 passthrough 输入及 tune 回调，OEM 外部兜底明确区分。WebView 固定运行时使用真实 ID / 版本，关闭或导航取消等待。版本三击使用 [DEVELOPMENT_SETTINGS_ENABLED](https://developer.android.com/reference/android/provider/Settings.Global#DEVELOPMENT_SETTINGS_ENABLED) 和 [ACTION_APPLICATION_DEVELOPMENT_SETTINGS](https://developer.android.com/reference/android/provider/Settings#ACTION_APPLICATION_DEVELOPMENT_SETTINGS)，写入受实际系统权限控制。PDF 使用真实 [PdfDocument](https://developer.android.com/reference/android/graphics/pdf/PdfDocument)，系统分享附件不等同已发送邮件。

本轮本地不运行构建、开发服务、Gradle 或 Cargo。用户已授权完成实现和本地检查后提交推送，构建与生产页面、Java 测试交 CI；目标教学屏性能 / 触感 / 权限 / 声学效果及生成内容科学正确性仍需实际验收。最新检查与 CI 结果记于 history.md。

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

`canvas.inspect.configuration` 与命令结果提供实际配置 / CSS 像素单位，设备默认值沿已有 App 校准属性传入。自动笔尖必须有显式或原设备阈值。命令等待真实 React 提交，取消 / 卸载 / 目标失效释放等待；宿主未提交不得返回成功。课件检查只读取 FilePreview 自己提供的实时配置快照，不新增背后画板读取。课件当前不支持背景和多点笔，命令明确拒绝这些参数；共享笔 / 手背 / 橡皮尺寸作用于下一笔。

课件对象橡皮复用 `eraser/stroke.ts` 的扫掠矩形和实际笔迹几何，命中后删除整个笔画及同组图形、插入、函数图或语言对象。文字 / 图片 / HTML 按实际边界，填充图形用 `polygonIncludesPointNonZero` 加边缘扫掠，避免三角形空白包围角误删。模式与大小来自原橡皮按钮重复点击的紧凑 MUI 属性，主板设置 / Agent 共用；细指对象擦除与手背 / 笔键局部擦除区分，取消恢复整个原内容，完成单次撤销。原 APK `HScribeEraserObject` 的画区域涂抹手势不同于当前指针扫掠，不将此扩展宣称为原厂全手势一致。

CI 40251850480 的生产截图 / trace 是本批 UI 修复依据：14 项页面失败中，录制与图形沿用旧可访问名、SVG 误匹配图标、德语工具箱 / 资源同名需精确作用域；触控用例首次选笔后无条件 Escape 切回选择。真实缺陷是窄屏实验旁空位不足时提问框未使用既有最小尺寸档，以及工具显式文字样式被问题旧样式覆盖。修复保持原命令和空位算法，增加紧凑档回归、跨回合样式优先级，教师供应商测试返回实际只读观察结果，不取消行为断言。浏览器复验仍只交 CI。

旧 AI 面板清理依据是 `Classroom.tsx` 原可从 `TeachingTools` 的 `canvas.capture` 和公共 `panel.open(ai)` 到达同一 textarea、截图预览和重复“写到白板”按钮；前者先缓存整板截图，后者直接开面板，上下文范围不同。按用户最新重复入口只留一个的要求，现只保留 `assistant.open`，移除上述两路及工具箱重复的截屏问答项。通过可选 whole 参数保留整板语义并传到提交时的 `execute`，不缓存打开时的旧截图；普通重开恢复原选区上下文。`panel.close` 关闭手写框并由卸载取消请求，既有板书不删。移除仅旧面板使用的状态、标题和 CSS，保留底层截图、总结 / 语音 / 函数控制与设置。真实路由回归验证无 textbox、最新上下文、可折叠答案和打开 / 关闭，工具箱仅一个问答入口且仍真实执行。

CI 40254712563 为 69 / 73 生产页面通过；余下录制两项居中偏移来自 `.fc-panel` 的 `translateY(5px)` 进入动画，中心浮层禁用这一菜单位移动画，保留 MUI Dialog 原渐显。录制拖动边界差 0.46875 px 来自 `offsetWidth` 取整，改读 `getBoundingClientRect` 的真实 CSS 宽高，隐藏时沿用既有尺寸回退。德语第四项由旧 capture 与 recording 都译作 Aufnahme 引起，旧重复入口移除后无需放宽定位；新的分数像素回归覆盖拖动与隐藏 / 恢复。

背景回归实测发现原图案未加入历史观察，原 CaptureUpdateAction 不能单独使其可撤销；现把 whiteboardBackground 加入既有独立背景快照及 delta，与颜色同次撤销 / 重做。普通书写偏好仍按原规则保存，既有笔迹不被配置修改。真实编辑器 / MUI / Agent / 课件回归覆盖这些行为，物理双尖校准仍需真机。

## 2026-10-28 原版设置与阈值续核

`layout_about.xml` 原首页宽 373dp、左右 28dp、标题 18sp、设置行 34dp / 标签 13sp、开关 44×22dp；`about_setting_panel_bg` 是 #fafafa、22dp 圆角与 #38000000 描边。按这些值恢复首页及原 `about_close_icon` / `ic_arrow_right` 路径，不沿用旧 672px 左侧分类布局。AI 保留用户指定的逐级入口，设置自动保存覆盖原子页保存按钮。

`layout_threshold.xml` 为 620×430dp，三项互斥选择、190dp 检测区与原提示 / 帮助 / 恢复默认。`ThresholdView.onTouchEvent` 只在 DOWN 记录 `min(touchMajor,touchMinor)`，UP 回调，不根据 MOVE 累加。`ZWhiteBoardActivity.getSize` 对原始橡皮阈值乘 2/3，细 / 粗笔分别乘 4/5；现页面显示物理值，应用到现有 CSS 像素偏好，避免重复换算。恢复默认读取 ThresholdPopu 的三个 `persist.sys.whiteboard.*threshold` 属性；无厂商属性时移除手动覆盖，继续使用真实设备默认。`HTool.JudgeWhichPen` 只按粗笔阈值分类，未虚构细笔迟滞。真实编辑器测试验证 1× / 2× / 3×、按下与松手、取消 / 无效触点、手动输入、重启恢复和默认值。

当时确认的原版缺口为自定义背景和语言包管理，续修如下，不能据同名入口推算复刻百分比。

## 原版背景、语言包与周期表续修

`NewSlideBackgroundView` 的 back_pattern_1–14 / 五色 / 彩色选择器共 41 个资源按原路径转入菜单，画布图案仍用原整幅位图。自定义图片选择 / 预览 / 长按再选通过现有图像处理写入真实背景；`HCanvas.setBitmapPaint` 明确对 pattern14 使用 alpha255，其他图案 alpha150，Canvas / SVG 导出使用同样规则。背景加入已有场景历史 / 页面 / BZD 扩展 / 同步，图片解码失败及换目标不写入场景。原跨页全局图片回退已在下述 BoardBook 续修补齐。

`LanguagePackDialogFragment` / `LanguagePackAdapter` / `ModelManager` 的实际目录为 39 个语言标签，按当前界面语言、内置包、当地名称排序；九种状态沿原编号。新增独立模型操作队列调用已安装 18.1.0 SDK 的 getDownloadedModels / download / deleteDownloadedModel，识别线程分开；删除关闭实际缓存识别器。界面接真实状态版本、删除确认、缺包提示、下载 / 重试和关闭释放，缺包不调用其他语言或云识别掩盖错误。原生校验使用实际内置模型和默认包删除拒绝，待 CI。

`TeachingResDataProvider.chemistryToolItems` 使用动态 toolItem 创建周期表，旧图示抽取未包含它。现按 `PeriodicTableDialogFragment` / `PeriodicTableView` / `PeriodicTableDataProvider` 转入 118 个元素与 118 条详情，原分类色、图例、元素位置、选中 / 详情和 220×180 透明边缘卡片。反编译 getElementRect 的返回分支损坏，按明确 group / period 与 57–71 / 89–103 拆行算式重建，验证全部位置不重复；不能假装逐字复制错误分支。插入复用当前资源图像链路，主板 / 课件目标、取消、文件类型和撤销保持真实；原硬编码 1600 / 1600 落点按当前白板可见区域规则适配。

安装的 MUI Dialog.js 在 maxWidth=false 时仍设置 `calc(100% - 64px)`。MaterialPanel 显式解除这一额外限制，让原设置宽度和小屏边距实际生效。新增六项 390 / 800 / 1920 页面用例仅发现，不能替代实际运行或逐像素验收；完整源码入口索引持续跟踪动态工具、USB 专用笔及文件浏览器；成绩板和图表编辑的后续实现如下。

## 原记分牌、图表编辑与背景回退续修

`TeachingResDataProvider.otherItems` / `ScoreBoardWindow` 的记分牌每次打开初始化三组 1 / 2 / 1，允许负分，改名取消不改变组名、确认保留空格和空字符串；700×300 面板 / 180×202 卡片与原渐变 / 圆角，窄屏改为纵向滚动。入口留在原“其他”分类。改名铅笔暂沿用项目已有矢量图标，原 Android 系统铅笔与关闭图标的逐像素一致仍待验。

`ChartEditDialogFragment` / `dialog_chart_edit` / `ChartPreviewView` 的 900×520 面板、33 / 55 / 88 默认行、递增默认标题、增删到空行、数字过滤、柱 / 线 / 环形饼图、八种颜色、2 / 5 / 10 轴刻度与一位小数转入 ChartEditor / chartData。实时预览和插入共用同一 SVG 几何，标题按 XML 文本转义。按实际 `HCanvas.initHBitmapObject` 的 1600 上限保留预览尺寸，位置仍适配当前可见区域；复用当前资源图片与撤销 / 文件链路，失败保留编辑器，取消 / 换页拒绝迟到提交。原左侧数学实验 / 数学工具是独立子菜单，实验区只保留概念 / 应用两个标签。原随机数与手动函数绘图在下述续修接入，没有用 AI 函数笔代替。

`NewSlideBackgroundView.getCurrentCustomBackgroundPath` 优先当前页路径，再回退 `HDataSet.getCustomBgPath`。BoardBook 在现有 IDB 工作区中保存全局最后图片；页面自身图片优先。只预览回退不会把它固化为页面专属图片，切换旧页 / 普通书写不回滚全局选择；创建 / 删除 / 导入保留元数据，已验证新选择再次回退与重启持久化。不在每个笔触内复制图片或写独立 localStorage。

新增 390 / 800 / 1920 的记分牌 / 图表页面操作与控件不重叠用例；本地仅发现，页面和原生验收仍待 CI / 目标屏。新增回归实际覆盖资源入口、独立分数 / 改名、图表编辑 / 失败重试 / 空图、真实编辑器图片插入与单步撤销 / 重做以及背景跨页 / 重开。

## 原随机数与手动函数绘图续修

`RandomNumberDialogFragment` / `dialog_random_number`：720dp / 最低 500dp 面板、1–8 数量、默认 1 / 100、上下限 −999 / 999、禁止滚轮回绕 / 子输入聚焦、允许重复且含两端点；最小值大于最大值不清旧结果，成功抽取替换结果并回到左侧。RandomNumber 对应接触摸整数滚轮、滚轮 / 键盘辅助、数量与真实独立抽取，未增加文本框。窄屏上下排列且可滚动；Android NumberPicker 的原生惯性 / 触感仍需目标屏对照，不能仅靠单测认定完全一致。

`FunctionGraphDialogFragment` / `FunctionGraphView` / `FunctionExpressionEvaluator`：1080×650、左侧六预设、中间坐标图、右侧表达式列表 / 自定义 / 删除 / 生成 / 清空 / 插入。六预设为 x、x^2、1/x、2^x、ln(x)、sin(x)，重复点击不创建重复预设，颜色沿原 12 色池及 HSV 扩展并释放复用，自定义序号清空后继续递增。输入先保留草稿，点击生成以原 −2 / 0 / 2 检验规则更新图像，失败保留已生成曲线。解析器按原支持的运算 / 函数 / 常量及 log 为十进制对数处理，未改变 AI 函数笔。原解析器的幂结合顺序同样保留；不是用另一套通用求值规则替代。

绘图按原 x∈[−10,10]、步长 .02、|y|≤1000、屏外 100dp 截断、42dp 单位 / 20–200 缩放、原点移动范围 ± 视图宽高、聚焦点缩放与双击复位转入 functionGraphData / FactoryFunctionGraph。表达式编译和数学采样仅在曲线变化时执行，拖动复用采样；实时 SVG 与实际插入图像共用几何，保留当前坐标变换。复用原资源图片文件 / 课件 / 单步撤销和迟到取消链路，失败仍可重试；窄屏重排三块区域。原 Android 系统关闭图标的逐像素比对仍待验，现沿已有文字关闭按钮。

新增文案导致此前总覆盖率门槛移除德语等既有语言，已由实际回归发现。保留完整英语目录的真实总覆盖率；脚本另按基础编辑器（不含应用 fcboard 命名空间）生成 localeEligibility，语言可选性仍用原 85% 门槛，新增教学工具可按既有机制回退英语。德语保留，低覆盖的 kaa / kab 仍不开放，四个原版界面语言使用直接提取的原文案；覆盖率、语言切换与资源搜索一并回归。

新增三个 390 / 800 / 1920 页面用例覆盖随机数和函数图的可操作性 / 可见范围 / 生成 / 拖动 / 双击 / 插入，仅用例发现，尚未实际运行页面。本地不启 build / dev / 原生编译。

## 原生文件浏览器与真实 BZD 读写续修

按 `FileBrowserPopu` / `HFileGridAdapter` / `layout_file_browser` 直接移入原资源：580×387 面板、43 标题、31 路径栏 / 蓝色返回、127 存储侧栏、六列 60×75 卡片、52×48 图标、58×19 文件名、原选中背景 / 字号 / 配色 / 18 圆角；`MyPopu.setAlpha(100)` 对 #2f2f2f 全屏背景应用原透明度。原布局的列表 / 排序切换及 SD 项均为 GONE，Java 绑定没有把它们显示，故不凭遗留代码增添原 UI 没有的按钮。窄屏按空间换列、重新排布输入与确认区，空间不足时隐藏只读格式行并提供整框滚动；不整体缩放，键盘仅在明确编辑文件名时出现。保存初始文件名按源码 yyyyMMddHHmmss，单点选择、目录进入 / 返回、移动卷实际用户标签、拔盘回本地和覆盖确认接实际操作。BZD、图片及 PDF 保存的续修见下述记录。

`HDataSet` 的默认目录确为 `Environment.getExternalStorageDirectory()/Whiteboard/xml`，移动盘来自 StorageManager。FactoryFileAccess 使用真实目录与挂载状态、后代路径边界、受限文件名与 64MB 上限；文件写入所选目录的临时文件、同步后同目录 rename，仅替换成功后报告成功，失败保留旧文件。图像素材放同目录配套资产文件夹，原 XML 写真实图像路径；无图不创建资产目录。保存失败留在弹窗内可改名 / 重试，取消不写文件。BZD 读取会话采用 256KiB 分块、核对文件长度 / 时间与读取偏移，多字节 UTF-8 在合并字节后解码，最终仍走实际 BZD 多页导入与现有页面保护。

Android 10 设置 requestLegacyExternalStorage，较早版本通过已安装 Capacitor 8.2.0 的权限回调；Android 11+ 必须取得真实文件访问能力，目录无权限时接系统的文件访问设置，返回后重新读取，未伪报授权。规则已核对 [Android 官方存储文档](https://developer.android.com/about/versions/11/privacy/storage)。原生文案按当前应用语言创建 Configuration Context，原四语言文案直接从参考 resources 提取；取消按唯一请求 / 暂存 ID 归属，关闭只释放自身会话。

前端回归覆盖真实 UTF-8 跨片读取 / 解析、取消 / 迟到释放、损坏分块 / 超限拒绝、实际 XML 暂存 / 保存结果 / 写入失败及浏览器取消。新增原生仪器测试使用真实文件验证过滤 / 路径边界 / 原子覆盖 / 超限与目标目录保护，并实际显示原网格、选择确认 / 默认时间戳 / 保存落盘和窗口范围；这些 Java 与资源本地仅做引用 / XML 检查，受本地编译禁令约束，必须等待 CI，不能当原生通过。旧 BZD 矩阵见下述续修；掩码 / 部分节点 / 大文件内存及全部导出 / 邮件仍保留待办。

## 原位图矩阵与教学资源完整层级续修

`HSaxSlideParser` 写入 / 恢复九项 Android Matrix，`HBitmapObject.doDraw` 调用 `drawBitmap(bitmap, matrix, null)`；`photoRectSrc` 是源像素矩形，不能当白板落点，`nRGBA_A` 也没有参与原位图绘制。bzdBitmap 据此解出平移、非等比缩放、旋转和轴翻转，优先采用 Android 实际解码尺寸；BzdBitmap.decode 复用 `BitmapUtils.compressImageIfNeeded` 的 1920 整数采样规则，转换静态 PNG，避免浏览器 EXIF / 动画处理改变原结果。斜切 / 透视由 Android Matrix / Canvas 烘焙为透明位图，几何位置取真实映射范围，最长边限制 2048；跨越投影极点及非法矩阵拒绝导入。

导出先记录当前图像单位方形矩阵，再由原生保存按实际 SVG / 位图解码、裁剪后的像素尺寸归一化，写原格式的 matrix / photoRectSrc；不再写单位矩阵并把位置塞进源矩形。裁剪及图像透明度烘焙入 PNG，原 null Paint 绘制即可显示正确；Fcboard 扩展仍保留原文件、可编辑裁剪及透明度。普通浏览器导出的 Fcboard XML 有无损扩展，但其资产前缀及归一化标记需要 Android 保存步骤才能成为原版可直接读的图片路径 / 像素矩阵，不能把浏览器导出宣称为独立原版兼容文件。前端角点、实际素材尺寸、斜切桥接及往返回归已接；新增五项原生仪器用例通过实际非对称像素、Canvas 原绘制、裁剪 / 翻转 / 旋转 / alpha、采样和透视检查落点，未本地编译 / 运行。

`TeachingResWindow.onChildSelected / showParentMenu`、`TeachingResDataProvider`、`layout_teach_res_setting`、`TeachingResCardAdapter` 和 `TeachingGroupedResourceRenderer` 是本轮资源层级、顺序、默认项及视觉参数的依据。factory-resource-menus 记录源码哈希与真实资源 ID，241 项既有目录逐项唯一归入原菜单；纠正化学 QUANTUM 黑体资源误归物理。另从 `TeachingNetworkResourceProvider` 补回原第六个网络按钮 PhET：其空 URL 经 `ZXStudyFloatingWindow.resolveCurrentHomeUrl` 取 `HDataSet.ZX_STUDY_URL_CN / EN`，有真实目标，并非空控件。最终 242 项。

原八个入口按原序显示，点击学科回默认子项 / 首标签；数学实验 / 工具、物理实验七标签 / 力学原理、化学实验双标签 / 仪器 / 分子 / 工具、生物六子项与六个阶段组、地理实验 / 工具 / 天气、其他 / 函数 / 网络均接现有真实资源、窗口及撤销保存。物理两侧原矢量箭头按原 220px 滚动，键盘选择同步；AI resources 上下文和 open 命令提供真实子菜单 / 标签 ID。原 48 / 44 行高、父菜单蓝字 / 子菜单 #d6ecff 10 圆角、56 标签栏、150 实验 / 网络卡、140 工具卡、112 透明图示、120×126 分组卡和 66 / 58 / 64 图标尺寸已按适配器接入；力学七列、化学仪器 / 分子八列，窄屏改四列 / 两列，阶段组横向滚动，不挤压原图标。四语言文案直接取原 strings。

回归遍历所有学科入口与标签、阶段分组、父项复位、键盘与 AI 状态；化学量子真实 URL、PhET 主页与独立函数入口实际打开，生物减数第二次分裂选定 PNG 经真实编辑器插入 / 文件保存 / 撤销重做。三种窗口尺寸新增页面用例仅待 CI 执行，不能代替已通过的页面检查。原 showNAV 的逐站点差异、全窗口像素和设备交互仍须继续核对。

## 原文件窗的图片、背景、JPG 与 PDF 续修

`FileBrowserPopu.initInternalPath` 和 `HDataSet` 为 BZD / 图片 / PDF 分别选择 `Whiteboard/xml`、`Whiteboard/image`、`Whiteboard/pdf`；`HFile.setFileType` 定义原 JPG / BMP / PNG 图片过滤，`HFileGridAdapter` 用实际缩略图 / default_pic 和 pdf 图标。FactoryFileAccess / Dialog 现在按模式接同一原面板、目录、过滤、只读格式和文件名规则，保留现有 JPEG / WebP / GIF 扩展。缩略图用独立线程和 4MB 缓存 / 采样解码，和界面及实际文件操作线程分开，关闭释放队列；图片和 PDF 图标直接来自原资源。

主板图片工具通过可选宿主 onImagePick 进入原生文件窗，选定 File 继续走原有图片初始化 / 排列 / 文件存储 / 可编辑对象链路，浏览器仍使用既有多选。背景点击 / 500ms 长按也接同一窗，取消不改变背景；BMP / GIF 由已安装 pica.toBlob 支持的显式 PNG 编码转换为既有持久化支持的静态背景格式。关闭 / 换页取消所属选择，分块读完后的清理也再次检查取消，避免迟到落入新页面。

`ChooseFileListener.SAVE_JPG` 的真实文件命名为用户基名加原页码 `_01.jpg` / `_12.jpg`，不是每张重新编号。现在选定页面一次渲染 JPEG，按现有 256KiB 分块暂存与实际尺寸清单上传；JPG 一次原文件窗选择目录 / 基名，整批预写后再替换，存在任一输出页会确认覆盖，准备失败保留旧文件，提交异常尝试恢复备份。PDF 同样走原文件窗的单文件保存，不再把保存动作接到系统附件分享。成功返回实际存在的输出路径，取消无成功提示，空间 / 写入失败保留窗及暂存以重试。

`ZWhiteBoardActivity.savePdf` / `PDFUtil` 及随包 iText `PdfDocument.add(Image)` / Phrase leading 是排版依据：A4 595×842、左右 50 / 上下 30、18 号居中“白板记录”标题、27 行高、图片 500×500 范围等比缩放 / 居中、半行高 13.5 间隔与剩余空间分页。FactoryPageExport 以 Android PdfDocument / Canvas 实现这条布局，使用现有 PdfPageSpec 的 12M 总像素预算采样并实际缩小，逐张解码 / 回收。原 STSong 字体与 Android 字形差异、iText 延迟图片的边界行为仍须逐像素对照；整页导出裁切见下述续修。现有 20 页 / 64MB 限制尚在，原更大批量与大图 / EXIF 压缩尺寸需继续对齐。

前端回归覆盖二进制图片 / MIME / 原模式、宿主图片工具实际初始化、背景成功 / 取消 / 迟到 / BMP 编码、原页码分块保存、选页后 PDF 真实保存入口、JPG 取消 / 空间失败与浏览器真实保存回退。新增原生仪器用例检查实际缩略图像素 / 模式筛选、JPG 像素 / 原页码、失败保留旧文件，以及读取保存的 PDF 检查 A4、图片颜色与分页；本地均未编译 / 运行，仍待 CI。原文件窗的 AI 控件检查 / 操作尚未接入，不从 DOM 工具的可用性推断原生窗已可控。

## 整页预览 / 导出与原翻页键续修

`HSlide.save` / `saveToEmailOrPDF` 调 `createBitmap(1)`，尺寸为当前设备完整画布；预览 `createBitmap(4)` 同样保留完整范围，JPEG 写入质量为 100。原 `createBitmapForQR` 则单独计算内容范围，不能把这两种语义混在一起。boardExport 通过现有 exportingFrame / getDimensions API 指定临时导出框，使用当前画布宽高、页面自身 scroll / zoom 和设备像素比例，保留空白、背景及对象位置；文件 / 邮件输出上限 4096 像素、预览 280，JPEG quality=1。临时框未加入场景 / 选择 / 撤销 / 文件。扫码内容范围保持原分支，没有将它改成整页。

board.pages 返回当前画布尺寸快照，boards 上下文 / 视图尺寸变动也同步；未将 width / height 塞进持久化页面 view，以免旧页面覆盖新屏幕布局。翻转横竖屏及 DPR 变化会刷新预览 / 导出尺寸；空白页也渲染实际背景。关闭后尚未开始的预览跳过，迟到渲染及替换 / 卸载释放对象 URL，不把旧图显示为新页。背景旋转的原图尺寸 / 平移语义仍需单独对照，这条改动只保证当前可见范围的快照不被内容框裁掉。

`ZWhiteBoardActivity.onKeyDown(92/93)` 调 `doPre / doNext`，首末页提示不回绕；当前编辑器原行为却是垂直平移画布。PageNavigation 把无修饰 PageUp / PageDown 接到现有 board.switch 或 document.next / previous（保留课件动画步进），防止键盘重复请求并发保存，关闭取消自身请求，真实写入失败显示错误。输入 / 候选菜单 / 弹窗不触发后台翻页，编辑器也不再因弹窗中的翻页键平移；修饰组合保留既有编辑快捷键。首末页文案直接取原四语言资源，重复触发仍重新显示。真实编辑器与组件回归覆盖完整尺寸 / 空白页 / 平移缩放 / DPR / 上限 / 旋转、预览迟到释放、翻页与画布不平移、课件路由、边界、输入 / 弹窗及实际失败；页面与目标设备验收仍待后续。

## 专用 USB 笔的已核实协议与剩余移植

`com.koga.Reference / SkizzePenManager` 的这条链路是 Java USB HID，不是 JNI：VID=9761，PID=36867/36868；控制接口索引 3、报告 3；笔尖报告 5，36867 使用接口 4，36868 与控制共用接口 3。中断类型 1 / 2 / 3 / 7 / 8 分别是连接、鼠标、原始按键、电量、姿态，数据长度 1 / 20 / 3 / 1 / 2。控制 SET_REPORT 为 26 字节、请求 33/9、wValue=0x303、接口 ID、100ms；载荷为 length/command/status0/data，GET_REPORT 请求 161/1，响应 status1。连接查询 0x81、电量查询 0x85、原始按键事件启用 0xa2（载荷 0）；源码三次重试、每次至多 15×80ms，未连接时每 3 秒复查。现代权限、拔插 / 生命周期和长度校验须按实际 Android API 处理，不能照搬反编译代码的数组 / byte 计数问题。

`SkizzeService / ButtonEvent` 的 PageDown / PageUp / 原始按钮对应原始位 4 / 8 / 32；按下 / 释放，500ms 双击窗口。原始单击回桌面或唤起白板，双击发送 SYSRQ(120)，翻页发送 92/93。`SkizzePenLayer` 中的 ERASER_CLICK **实际是五色选择焦点循环**（白 / 红 / 绿 / 黄 / 黑，3 秒隐藏、120px 色项、200ms 的 1.3 倍聚焦），并非切换对象擦除；不要据事件名误接。姿态 attitude=2 的双击循环激光 / 鼠标 / 聚灯 / 放大镜；SkizzeView 可见时翻页键优先调整半径，激光 20..60 步 10、聚灯 260..420 步 40、放大镜 180..340 步 40 / 2 倍，再由 2 秒隐藏计时管理。鼠标坐标日志不能替代原生 hover 绘制。

补读完整 SkizzeView：模式切换显现 3 秒，ACTION_HOVER_MOVE 使用原屏幕坐标并在最后移动 200ms 后隐藏，翻页调半径后隐藏延长到 2 秒，三种时长用途不同。聚灯底色为 0x90000000，圆内清空；鼠标用原 pointer_arrow 位图。放大镜取 HCanvas 的真实白板快照并作 2 倍采样，黑色 2px 圆框，不应截入应用按钮或用一张静态装饰图代替。

现代接入依据 [Android USB Host](https://developer.android.com/develop/connectivity/usb/host) 核对设备枚举、明确 USB 授权、设备过滤和工作线程；[UsbDeviceConnection](https://developer.android.com/reference/android/hardware/usb/UsbDeviceConnection) 要求先 claimInterface，关闭释放后不能继续复用连接。[connectedDevice 前台服务](https://developer.android.com/develop/background-work/services/fgs/service-types#connected-device) 的声明、权限与启动条件也已查阅。36868 的报告 3 / 5 共用端点须单读者分发，不能照抄原双读线程互相争抢；也不移植原调试流程无条件写入 DemoTest 用户 ID。

最初续修只接通标准翻页键；本轮进一步移植 SkizzeProtocol / Buttons / Usb / PenService / PenPlugin。真实枚举 / USB 授权、两个目标设备的接口 / 独立端点单读者、中断报告、SET / GET_FEATURE、连接查询 / 电量 / 原始键启用均接通；短包 / 不匹配响应忽略，连续查询失败清空连接状态，读取失败后每 3 秒重试，拒绝授权不循环弹窗，拔插 / 销毁关闭连接与线程。服务仅在目标 USB 接收器存在时启动，通知可断开，保留后台按键处理；设备滤镜可唤起应用，快捷键单击桌面 / 唤起、双击 SYSRQ，权限 / 启动失败显示实际错误，没有假报截图成功。

SkizzePen 白板层用当前真实场景的 exportingFrame 快照绘制 2 倍放大镜；悬浮位置只调度一帧 canvas 重绘，不触发逐点 React 状态 / 场景转换或请求截图。失败暂停悬浮自动重试，显式切换模式可重试；未连接时不分配整屏像素缓冲。五色条使用原矢量 path / 颜色 / 次序 / 200ms 聚焦及 3 秒隐藏，直接更新下一笔颜色，保留当前工具和选中对象；原鼠标位图逐字节复制。PageNavigation 在原键路由前让可见悬浮层调整半径，隐藏后恢复真实页面 / 课件翻页。注册实际 skizze 状态与模式命令供原 AI 工具路由使用，断连拒绝操作，未加另一套无效按钮。

前端回归覆盖浏览器无硬件界面、原五色 / 不改选区对象、真实悬浮坐标 / 时间、翻页优先与半径边界、2 倍真实快照 / 迟到结果 / 失败限流、更新状态优先 / 监听释放及桥接失败。新增两份 Java 测试覆盖真实报告长度 / 功能请求响应、600 包侧键边界、500ms 按下释放 / 双击、姿态隔离、冲突按键和断连取消；受本地禁止构建约束尚未执行。Java 仅语法分析，原生编译 / lint、物理 USB 授权与读写、系统特权安装的后台唤起 / 截图、目标屏上 hover / 像素 / 压感仍未验收，不能据此报告原版笔体验已完全一致。

## 表格随手写实时扩展

直接对照 `HTool` 的 MOVE 分支（约 384 行）和 `HTableObject.positioningArea / updateTableChanges`：落笔固定单元，宽度超过 1px 的真实笔迹推进对应边界，保留 20px 边距，移动前后其他单元内已完成内容，当前笔迹留在手下。此前主板和课件只有抬笔后的增长；本轮主板通过帧批量 `onInkProgress` 接 `LiveTableWriting`，课件在实际 pointer move 上调用同一增长函数。缓存增量笔迹边界和当前表格几何；单元内普通书写不重新发布静态表格，主板不逐点扫描整个场景。重建表格保留原图层位置和 fractional index，避免取消后额外修改其他对象。

每支笔以已提交的表格为基准组合预览，落笔单元按当时显示的网格锁定；抬笔只捕获该笔的笔迹 / 扩展 / 相邻对象移动，随后恢复其他笔的预览，避免把另一支未完成笔写进本次撤销。取消、失去捕获、失焦恢复原表及相邻内容；换页或显式替换不复活旧表格。课件定时 / 关闭保存读取已提交几何，长笔画中不保存临时扩展，抬笔后整体保存和单步撤销；接触转为手背擦除先回退扩展再走真实对象擦除。课件边界提取跳过单元内原始墨迹，避免对长笔迹执行展开式 Math.min/max；15 万点相邻笔迹回归覆盖扩展和移动。目标 7 文件 132 项通过，包含真实编辑器 / 课件、两表及同表多笔、原轨迹 / 压感、取消 / 翻页、撤销 / 重做、保存和静态绘制次数；不代表真机帧率或所有表格操作已验收。

续修依据：`SelectCacheLayer.drawMarks` 在恰有一张表时显示复制 / 删除 / 加行 / 减行 / 加列 / 减列六项（44px 单元、42px 高），`drawTableRows / drawTableColumn` 在末端增减，新增尺寸取当前总尺寸除以行列数，原位置及已有分隔线不重排，至少保留一行 / 一列。SelectionActions 现接 TableActions 四按钮及共享 table.track 命令，原“只剩一行 / 列”反馈也已接；主板 / 课件及 AI 读相同对象并走同一撤销链路。复制 / 删除 / 搜索及四项行列的七个矢量，完整转自原 ic_copy / ic_delete / ic_search / ic_row_add / ic_row_del / ic_columns_add / ic_columns_del，按原 24px 图标显示。小屏按钮保持原 44px，菜单按可用宽度换行并约束高度位置；表格选区抑制原本不显示的搜索项，AI 扩展保留。

`SelectCacheLayer.updateScalingHObjects` 的 OBJECT_TABLE 分支只提示 `table_zoom_instructions`，普通墨迹也以 `!hObject.getTableInside()` 排除格内内容；原资源文案明确“表格及表格内的内容不支持缩放”。虽然同类有 updateScalingHTableObject 方法，实际该入口没有调用它，不能拿未调用方法认定原版支持缩放。主板 resizeWhiteboardSelection 与课件选择现排除表格 / 格内内容，保留实际拖动；混合选区里的其他对象继续走原缩放。原 SquareView 仅显示 10 列 × 7 行的初始尺寸选择格，行列增删分支没有该初始面板限制；移除表格模型原有 12 行列 / 1600×1200 上限及强制重排的小格尺寸，保留仓库 BZD 的 50,000 场景预算和既有 100,000 坐标范围，避免无限分配。14 列 / 1680px 的增列、持久化重读已有真实编辑器回归。

原行列函数只修改表格线，不删除旧单元位置上的 HObject；selectTable 在后续选择时按当前表格边界纳入内容。因此 tableContents 在列数变化时重算仍在表内墨迹的行列索引，越出新边界的原始墨迹 / 已有文字留在原位置并解除表格归属，避免把一次减列变成删除文字。新角色 ID 区分行线 / 列线 / 单元文字，避免新增分隔线复用文字 ID 破坏历史；脱离表格的合成文字换独立 ID，后续加回同一列不冲突。保留相邻图层顺序、已有其他选区和单步撤销；已发布索引排序恢复旧位置式 ID 的取消预览。表格读取及内容搬移按实际几何，修复主板 / 课件移动后再加减行列使原内容二次偏移。课件选择框同步扩展范围；本轮代码回归覆盖这些真实链路，完整页面 / 实机交给 CI 构建后验收。

`rotateRect` 在原类只初始化 / 清空 / 命中，未找到绘制赋值；当前 !part.angle 仍跳过已旋转表格，原版是否开放旋转须继续核实实际入口，不能凭项目已有能力发明原版行为。

## 活动邮箱窗口、真实邮件动作与原版附件续修

`ZWhiteBoardActivity.showEmailPopu` 实际构造 `NewEmailPopu`；未找到 `new EmailPopu` 调用。旧 `layout_email` 及其厂商账号不是本次活动流程的依据。`layout_new_email` / `NewEmailPopu.switchPage` 给出 433×339、22 圆角、#fafafa 面板和账户 / 提供方 / 写信 / 发件配置四层，写信返回其实际来源层；首页主按钮进入提供方层，保存真实验证通过才回到账户卡。MailComposer 按此移植六个提供方、213×113 账户卡、四个核心字段、27px 输入、原按钮 / 字号 / 灰阶；现有 STARTTLS / IMAP / PNG 扩展收在高级项。小屏重排并滚动，不整体缩放。Mail 专用选择器覆盖旧课堂全局的 48px 输入 / 按钮和 16px label margin，避免原尺寸被旧 CSS 改写；未把这项局部修复当作全应用布局验收。

`EmailAutoComplete` 的 13 个真实后缀与过滤已接到可用键盘 / 指针候选，并保留前一分号收件人。候选用当前已安装 MUI Popper 的固定定位 / 越界翻转，避免挤压表单。`DeleteMailBoxPopu` 的 300px 确认 / 取消接真实删除，取消或 Escape 只关闭确认层，失败不移除账户。两个新增图标直接转自 `ic_email_back` / `ic_exist_email`，viewport / path / fill 已核对；四语言核心文案取原 strings，缺少的港繁键沿用原资源回退。

UI 与 `mail.action` / `mail.configure` 共用实际 MailPlugin 操作；AI 可导航、读公开状态、配置草稿、确认删除、验证保存与发送，长操作接取消信号。授权码不进入公开账户 / 上下文。列表失败不会假作空账户，验证 / 导出 / SMTP 失败保留可重试草稿；同一次发送重试保留请求 ID，取消或卸载后拒绝迟到发送 / 回调。原生确认接受后关闭窗口，再显示实际成功或 IMAP 归档警告。九项界面回归覆盖这些路径及 StrictMode、端口默认加密、实际高级下拉 STARTTLS / IMAP 保存；桥接模拟不代表外部服务器已验收。

原活动 `sendNewEmail` 调 `savePdf`，以 `meeting.pdf` 发送；PDFUtil 先写会议记录标题，再按 A4 / 500×500 居中图像流排版。BoardAttachments.createMail 复用既有 FactoryPageExport.writePdf，而普通分享保留原有分支。新增仪器用例以红蓝页面检查 A4 和连续图片流位置；三份 Java 仅做 javalang 语法解析，本地未编译 / 运行，实际原生检查交推送后 CI。

## 原表格 BZD 类型与可继续编辑的往返续修

`HSaxSlideParser` 写 `OBJECT_TABLE`、`tableVerLine` / `tableHorLine`、完整竖 / 横线列表；`HTableObject.restoreTableLines` 从线列表恢复非等宽网格，旧文件由两角和行列数恢复。此前当前工程导入仅生成普通线、导出又写成笔迹，重开即丢表格动作。现导入复用 insertionShapes / 现有表格模型 / 稳定角色 ID，格内原文字和笔迹按实际范围归属，保留原坐标、字体及路径；行列操作与新手写增长复用既有内容移动链路。线宽和透明度保留在模型，后续重建不回落默认样式。

导出通过纯 readSceneInsertions 读取所选页，独立于活动课件上下文；每个网格只写一个原表格对象，格内文字 / 原笔迹继续分别写入，ObjectCount 取实际对象数。回归去掉 fcboard 无损扩展再读，确认原格式下仍可编辑、非等宽与内容保留；旧两角文件、缺边 / 重复边 / 非矩形 / 超预算拒绝也覆盖。累计坐标偏移改为线性循环，避免大表逐项复制数组；点数在构造点数组前检查，原对象展开为场景对象时检查现有 50,000 预算。未据此宣称大文件内存问题全部解决。

另核实 `HCanvas.onAllTouchUp` / `cutPoint`：擦除结束后生成切分对象并经 HCutObjectCommand 替换，擦除对象没有走 HAddObjectCommand；HSlide.createBitmap 也排除 HEraserObject。不能把普通原文件假定成含持久擦除遮罩。异常含该对象的兼容分支及旧思维节点仍保留待办。

本轮最终本地为 233 文件、2486 通过、46 既有跳过、1 todo；npm check / 零警告 lint 通过。表格六文件 42 项与邮箱九项定向回归通过。原生 / 页面在完成代码目标后推送 CI，再由用户安装验证；实机触感、声学和逐像素不是推送前置条件。整体目标仍未完成，不能以局部回归认定达到 90%。

## 云端 / 本地实时分享与实际服务器续修

原 ChooseServerPopu 是文件传输，新增实时编辑复用已有 SceneSync / LanRoom 协议，入口按 layout_chooser_bzd 的尺寸 / 两项 / 原矢量移植。LanSession 的真实云创建 / 初始认证 / 同房重连 / 密码开关、取消 / lifetime、UI 与 AI 共用配置和启动已有真实 HTTP / WebSocket / React 回归；不因这条链路接通而报原云文件传输完成。

用户已提供 hus（101.96.199.53）。服务器 Node 22、ws、Caddy、独立账户、私有配置及常驻 unit 已准备，公网可信 IP TLS 经严格验证；当前 503 等待本次 CI 网页，未用旧版本或占位页面假装上线。源码 / 服务器哈希核对，生产运行环境的回环自检通过；完整部署状态、原始依据、测试及待办见 [云端分享记录](cloud-sharing.md)。静态云选页、BZD 传输和白板翻页已在下节续接；课件仍待接，不重复询问云地址。

## 原云端文件传输与白板页面隔离续修

直接读 ChooseSlidePopu 的 chooseType 0 / 1 / 2、ChooseServerPopu、ChooseBzdPopu、ExtraCodePopu、layout_extra_code 与 UploadBZDUtils：扫码先选页再选云 / 本地，BZD 保存 / 打开各自走云 / 本地，上传真实序列化 XML，成功显示不可编辑提取码；读取以码获取 XML 后创建新页面。提取码 XML 明确 maxLength=4 / 数字及大小写字母，原厂服务保留时间没有源码依据。当前分别接 ShareServerChooser / CloudPageShare / BzdCodeDialog / board.open，保留既有 JPG / PDF / 邮件流；云端错误可修改连接信息重试，取消和迟到创建均清理，成功才显示码或二维码。

Node transfers.mjs 的静态访问复用 BoardShareServer 的图片 / 表单 / cookie 行为，实际保护所有图片端点；文件持久化到 unit 已允许的私有目录，24h 为明确的项目服务策略。未调用旧厂商域名，未部署占位页面。服务端有单次、数量及与实时房间共用的总预算；本地 HTTP 回归验证真 PNG 下载、cookie 失效、期限、重启、真实 BZD 解析及取消删除。

实时页面扩展以现有 ScenePacket / LanRoom 的冲突规则为基础，为主机访问增加 page.id / epoch，主机翻页才允许替换场景。Node / Android 均拒绝旧次访问及扫码者伪造的翻页，扫码端清理旧文件和撤销；原页面的变化不会进入目的页。另修 BoardBook 异步保存期间的归属窗口，收到的编辑仍更新可见来源页，取消回退保留来源页改动。真实 socket / SceneSync / 会话 UI 回归通过，Android 新 socket 用例未本地编译。课件 FilePreview 的 DocumentInk 不等同 ScenePacket，仍未完成；不把白板页切换当作课件同步已实现。

旧节点的源码定位：HSaxSlideParser 写入 nodeAddDirections / nodeColumns / nodeLeftId / nodeRect\*，文本通过 mNoteId 归属，finishMindMappingSlide 以 nodeLeftId 恢复父子关系；HAlphabetObject 另有 matrix、alphabetId 和四线文字重排。以下续修已接入这两类对象的可编辑读写；仍需核对大节点图与其他原设备基准，不重复猜测持久擦除遮罩或 rotateRect 入口。

## 旧 BZD 思维节点与四线格的可编辑读写

readBzdInsertions 按 HSaxSlideParser 的 nodeLeftId 恢复树关系，遍历后将真实矩形、节点列级 / 方向 / RGB / alpha 保留在 nodeStyles，不再将不同节点强制读成同一尺寸。mNoteId / alphabetId 的 HSmaTextObject 原先就是隐藏的文字载体，当前收集到所属节点 / 四线格，不在其 -10,-10 的占位坐标单独绘字。原孤立载体同样不绘制；重复节点 ID、环路及无效投影拒绝。节点曲线依据 HMindMappingOBject 的直线 / quadratic 控制点与 6px 线宽；新增子节点按父节点右边加 100px、末端子节点下边加 40px，保留 columns + 1。

原 Html.fromHtml 标签合成允许一节点多种文字颜色，当前用可编辑文本片段表示，并保留源顺序及跨行拼接；片段各有独立 ID，避免识别追加时重复 ID 丢字。主板 / 课件的识别写回共用片段展开，读取实际可见标签而非复活已擦文字。移动、清空、加 / 删分支保持各节点矩形和文字颜色；保存输出真正 OBJECT_Note / OBJECT_ALPHABET 及 mNoteId / alphabetId，剥掉 Fcboard 扩展仍可继续编辑。

四线格矩阵按 Android mapRect 的轴向包围矩形解出，含缩放 / 旋转；仍以既有 1920×1080 BZD 基准恢复原构造宽高的五分之一，其他原设备基准 / 大节点图及全部字体像素仍需进一步对照。现有模型的 40 节点限制没有因该导入冒称消失。原 hw.ttf 已从参考资源转入，54276 字节，SHA-256 为 6c4f2b8692ca638c0103b47f8819480aaf0c6094775baf8da9c333c1eb5a08c4；使用私有 FactoryHandwriting 字体入口，未增加通用字体菜单项。head / hhea 指标据实际字节及 [OpenType head](https://learn.microsoft.com/en-us/typography/opentype/spec/head)、[hhea](https://learn.microsoft.com/en-us/typography/opentype/spec/hhea) 核实；TrueType 的浏览器 format 标识及原字节导出依据 [CSS Fonts src](https://www.w3.org/TR/css-fonts-4/#src-desc)，未将 TTF 误送到只接 WOFF2 的解码器。

另保留用户进行的 Fcboard 命名调整，已核对并修复批量误改 / 漏改和第三方边界，详细计数见 [命名核对](rename-audit.md)。内部类型为 FcboardElement；按用户最后要求，工作区和第三方依赖的包名 / 导入路径均保留原有 @fcboard 名称，源码目录仍为 packages/fcboard。
