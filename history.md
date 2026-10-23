# Fcboard / 方成教育

- 目标：以 HWhiteBoard 5.42 APK 对齐书写、触控、原菜单及可见课件操作，AI 融入原工具。整体 90% 未完成，按[差距表](docs/apk-alignment.md)推进；不能将构建或单测当作真机验收。
- 发布：基线 a38a0af 的 [CI](https://github.com/oliid0/fjy/actions/runs/39562248843) 曾通过并安装到 Android 16 / 3840×2160 / density 480。2026-10-23 用户明确要求先推送构建以便实测，允许整体目标未完成时发布本轮验证版本；已推送 dbb4a35，[首轮 CI](https://github.com/oliid0/fjy/actions/runs/39931979485) 在准备 OCR 资源时发现缺失 scripts/ocr-LICENSES.txt，尚未进入编译；恢复原打包输入后，node scripts/fetch-ocr-models.mjs 本地资源准备通过，继续推送修复并跟踪构建。
- 迁移：保留用户 app、app/fcboard、packages/fcboard 目录迁移及远控移除、协作、资源和多语言修改。修复剩余 8 处失效相对引用与重复的 packages/fcboard 锁文件条目；清单 / 锁文件 specifier 一致。按用户新项目要求，仅用 fcboard 数据键；移除重复回退，修复设置保存后误删自身，保留会话 / 显式记住密钥语义。
- 识别：APK 的文字识别是 ML Kit Digital Ink 18.1.0 原始轨迹，model.tflite 为图示分类器。新增 DigitalInkModels / Plugin、digitalInk.ts、八个 Google 模型下载及双重 SHA 校验、包名对应 MDD 注册与 OfflineInkTest；资源已验证。真实 SDK 运行、中文 / 英文准确率和耗时待 CI / 真机；Web PaddleOCR 不冒充等价能力。
- 插入：主板 / FilePreview 共用真实字体测量、换行和可见区域布局，答案放问题下方，结果在算式后，匹配手写大小，先换行再缩小；无空间保留原内容。原始笔迹按旋转 / 选区裁切后识别，删除和目标变化取消旧请求。
- 数学：明确算式 / 函数笔后才自动处理，普通笔记不改；mathjs、Nerdamer 和区间运算处理已支持的数值、矩阵、微积分及有限方程。AI 只规范化为校验后的表达式 JSON，本地计算与绘图；Worker 可取消 / 6 秒限时。能力和固定源码依据见[数学链路](docs/math-pipeline.md)，不声称任意数学或手写零错误。
- 书写：按 HCurveObject / HBezierObject 增量构造 Path2D，Canvas / SVG 共用 trace，移除采样后的额外 RAF；细 / 粗笔独立配置、逐触点阈值与 0..50 笔锋变化率已接入。本轮按 onUp 的零宽节点补钢笔收笔，保留静止压力变化及松手合并采样；裁剪按连续椭圆宽度处理，反复擦除保留原收笔，不给切口重新收尖。触及 factoryInk / Brush / Path、主 App、eraser/stroke 及相关测试，尚未量测真机延迟。
- 课件：共用笔菜单、几何、识别、插入与局部擦除。本轮补触点变大 / 中途笔键转擦除、共享橡皮尺寸 / 原预览、捕获归属，取消 / 失焦 / 失去捕获释放并回滚，迟到事件失效；一次擦除或复制可整体撤销，复制的图形 / 函数标识独立。触及 FilePreview / documents / canvasCommands，异步资源仍校验课件身份 / 页码 / 白板目标。
- 圈选与讲课：对照 SelectCacheLayer 保留复制 / 删除 / 搜索，只增一个 AI，移除计算 / 图像 / 问答三入口；MUI Paper / ButtonBase，44×42 单元、18 图标、28 间距和上方翻转定位。AI 先识字再自动路由，本地画函数；失败保留笔迹。已测圈中“讲解牛顿定律”后进入 lesson.ask、校验脚本并绘制文字 / 受力箭头；仍需真实模型和语音同步验收。参考 ss 内三份讲课脚本 / 提示词 / 有界动作协议，未引入独立聊天页面。
- UI / 语音：更多采用 MUI 分层返回菜单；背景设置独立页面、原 13 图案及逐板 / 导出 / 协作接入，无 Card。反馈自动消失，成功 / 忙碌提示减少；语音已有激活恢复 AudioContext、无 PCM 超时与空结果回退，设备麦克风效果待验收。
- 验证：pnpm 10.28.2，Node 26 使用 NODE_OPTIONS=--no-experimental-webstorage。check、lint（零警告）、test:other、完整 test 全通过：154 文件 / 1621 通过 / 46 既有跳过 / 1 todo；git diff --check 通过。圈选 E2E 已改为单个 AI，留给 CI 生产页面执行。未在本地运行 build / dev / Gradle / Cargo。
- 剩余：复杂二维手写到 LaTeX、一般隐式 / 高次 / 非光滑数学、普通笔独立尾锋、三指变换、物理手背校准、非笔迹透明擦除、圆规 / 三角尺、原厂格式与系统加速。圈选轮廓、全部分辨率视觉和完整菜单仍需逐项实测，不能声称所有功能完美工作。
