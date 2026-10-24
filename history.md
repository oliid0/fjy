# Fcboard / 方成教育

- 目标：以 HWhiteBoard 5.42 APK 对齐书写、触控、原菜单和可见课件操作，AI 融入原工具。整体 90% 未完成，按[差距表](docs/apk-alignment.md)推进，不将构建或单测当作真机验收。用户已授权整体未完成也推送验证版供实测。
- 发布 / CI：最新全绿基线 [251d52c](https://github.com/oliid0/fjy/actions/runs/40055192160)，通过 Web / APK、Android 单测 / lint、41 项生产页面和 8 项真实模型仪器测试。统一选框调整、整体复制 / 删除 / 撤销、取消回滚与课件撤销清旧区均通过；本轮菜单改动待新推送 CI，不混用旧包。
- 本轮菜单：业务下拉共用 MUI MaterialSelect，Esc / 点外部取消且不改值，内层 Esc 不误关外层；异步列表未到不产生越界值警告。锚定工具浮层打开获得焦点，Esc 能退出，文本输入中的 Esc 同样正常关闭。设置保留居中横向窗口、左侧分类和右侧紧凑设置行，无卡片。
- 本轮工具 / 资源：工具箱去掉“更多工具”及重复入口，MUI 按钮以紧凑横向网格自动换行；录制去掉课堂前缀，快传固定进入内部文件流程。教学资源依据原 layout_teach_res_setting / TeachingResWindow 的 900×560、240 左栏和四列改为居中横窗，默认数学，左右独立滚动。完整资源子分类 / AI 交互动画尚缺。
- 本轮长按：按用户最新要求完全取消白板长按右键菜单，不启动触摸长按计时器，编辑 / 只读均阻止 contextmenu，不再长按命中对象；课件批注 SVG 同样阻止系统菜单。圈选后的复制 / 删除 / 搜索 / 唯一 AI 操作行保留。通用编辑器保留原功能。
- 圈选进度：依据 CircleToSearch 的 beginCircleDrag / endCircleDrag 实现统一有界区域，四角调整、边框整体移动、内部重新圈画，松手才命中。主板 / 课件共用显示和截图几何，不改写对象 / 分组元数据；重复选择 / 双击不进入旧编辑器。取消 / 捕获丢失 / 失焦回滚容器内容、绑定文字和关联箭头，仅恢复本次改变且版本仍一致的对象；复制 / 删除保持整体，撤销 / 重做清过期选区，区域变化取消旧 AI。
- 识别 / 数学：原 APK 是 ML Kit Digital Ink 18.1.0 原始轨迹识别；model.tflite 是图示分类器，hw.ttf 属四线格。八个官方模型 SHA 与本包 MDD 注册已验证，真实 SDK 识别“十”和“1”，不能据此声称准确率达标。数学用英文轨迹模型、最高候选和语法校验；mathjs / Nerdamer / 区间分析本地计算绘图，AI 只输出校验后的 JSON。复杂二维手写到 LaTeX 仍缺，见[数学边界](docs/math-pipeline.md)。
- 插入 / 书写：文字按源笔迹测量，问题下方 / 算式右侧，先换行后缩小，限制可见区域；函数在源附近找空位。魔术笔主体描述 → 配置图像模型 → 原位替换，取消 / 换页拒绝旧图；仅模拟链路通过，真实画质待验收。共享二次曲线、压力 / 速度递推和 Canvas / SVG 几何，完整合并采样、增量 Path2D、细 / 粗笔、阈值、0..50 笔锋变化率、钢笔零宽收笔、局部擦除回滚均有回归；主板多指遵循 HCanvas 度量，课件捏合、普通笔独立尾锋与真机延迟仍缺。
- 讲课 / 录制：唯一 AI 识字后路由到本地数学或现有命令，明确讲解进入 lesson.ask，写入可见白板 / 课件层。Moonshine 中文指令 / 静音及 sherpa-onnx 1.13.8 / MeloTTS 中英文 44100Hz 非静音 WAV / 取消已过真实模型 CI，麦克风 / 扬声器与同步仍待真机。录制已有时间戳文稿、保存和独立总结；已通过 GitHub MCP 阅读 Meetily 停止 / 文稿收尾 / 保存 / 总结分阶段代码，面板和失败重试待补，见[播报边界](docs/offline-narration.md)。
- 本轮触及：MaterialSelect / MaterialPanel、Classroom / Teacher / FilePreview、LanguageList、WhiteboardTools / App、TeachingTools / TeachingResources、classroom.scss、三语录制标签、相关单测 / 六分辨率页面检查及差距表。
- 本轮验证：pnpm 10.28.2；Node 26 使用 NODE_OPTIONS=--no-experimental-webstorage。check、lint（零警告）、test:other、完整 test 通过：157 文件 / 1664 通过 / 46 既有跳过 / 1 todo。新增菜单退出三项、长按编辑 / 只读两项回归；初次新增用例的空选区 null 断言已按实际初始 undefined 修正，完整套件通过。41 项页面已发现，新页面检查仅在推送 CI 执行。git diff --check 通过，未本地运行 build / dev / Gradle / Cargo。
- 剩余：手写提问框及独立发送 / 语音、回答 / 总结的小字号和空位策略深化；原厂全部图形、内部多媒体 / 信号源、快传上传页 MUI / 持久配对 / 上传自动预览、完整资源子分类与 AI 交互动画；连续语音停顿 3 秒执行和中心空位写入。已通过 GitHub MCP 阅读 LiveKit turn.py 的终点检测 / 中断分离，现有语音仍是一轮即停止。继续完善录制阶段、复杂数学识别、课件捏合、普通笔尾锋、真机延迟 / DPI / 双笔尖 / 手背、非笔迹透明擦除、圆规 / 三角尺及厂商加速，不声称所有功能完美工作。
- 目录决策：保留用户 app / app/fcboard / packages/fcboard 迁移及现有别名，只用 fcboard 数据键，无旧数据回退。配置在 config，私有 config/.env.local 忽略；Capacitor 在 app，测试初始化在 tests/setup.ts，README 在 docs。CI 用 pnpm --dir app exec cap sync android，保留锁文件和字体本地路径修复。
