# Fcdraw / 方成教育

- 目标：品牌白板用于大屏教学与会议；统一原有底栏，圈选直接计算 / 绘图，内置中文语音，保留录制、文稿、总结、局域网快传及课件预览。
- 已完成：原菜单、绘图工具、撤销 / 重做、缩放、课堂入口合并为一条底栏；普通状态其余空间均为白板。圈选算式直接写入结果，圈选函数直接出图；重新选图自动显示邻近参数，修改立即生效，无计算 / 绘图按钮或折叠菜单。过期请求、重复生成及坐标轴 / 曲线范围问题已修复。
- 已完成：APK 内置 Moonshine 0.1.5 中文 Tiny Streaming 模型（八个文件随包分发并校验），支持离线识别与录制共用音轨；系统 / 自定义语音可选。支持四种录制组合、回放 / 时间轴文稿 / AI 总结、LAN 文件上传和 PPTX 预览。AI 默认火山方舟，支持自定义接口。
- 依据与决定：逐项阅读并复核用户提供的七个参考项目，具体路径和采用的行为见 [reference-review.md](docs/reference-review.md)。沿用当前元素、选择、截图和历史接口；数学使用现有 mathjs / nerdamer。Moonshine 官方库要求 Android 8.0 / API 26。IndexTTS 官方 Python/PyTorch 库无安卓嵌入接口，提供可选的局域网播报适配器，未称其为内置安卓模型。
- 修改位置：excalidraw-app/fcdraw、原白板 LayerUI / ToolbarExtras、Android 语音插件与模型打包脚本、e2e、pnpm 锁文件、Actions 和参考说明。保留用户原有 .gitignore 的 ss 排除变更。
- 验证：本地与 CI 的 pnpm check、lint、test:other、test 均通过；110 个测试文件、1333 项通过、46 项既有跳过、1 项既有待办。生产页面 8 项检查覆盖四种宽度、自动函数图 / 手写选区 / 等号补全、截图总结后继续书写；3 项 IndexTTS 适配器测试通过。安卓编译、单元测试、lint 与 2 项实际设备测试通过，真实加载随包模型并处理音频。未执行本地 build / dev / Cargo；打包及设备验证均在 Actions。
- CI：[成功运行 38754280447](https://github.com/oliid0/fjy/actions/runs/38754280447)，代码 2031efd，工作流修正 145b6c9。模板包名断言已更新；设备测试使用 :app:connectedDebugAndroidTest，避免运行无关生成模块的冲突测试依赖。产物：[APK（约 92 MB zip）](https://github.com/oliid0/fjy/actions/runs/38754280447/artifacts/11983166342)、Web、UI 截图、Android 检查报告。
- 剩余：无实现或 CI 任务。手写识别需填写真实视觉模型与密钥；目标大屏的实际麦克风、摄像头和识别效果仍需现场验收，当前设备测试验证了模型加载 / 音频推理，未替代硬件验收。
