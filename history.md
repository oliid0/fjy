# fcboard / 方成教育

- 目标：以 HWhiteBoard 5.42 为基线达到 90% 同机体验对齐，AI 融入原操作；用户已授权推送 GitHub 并验证 CI 构建。还原度尚未通过验收。
- 已完成：APK 反编译依据与缺口见 [apk-alignment.md](docs/apk-alignment.md)。紧凑底栏、上下文属性、局部笔迹擦除、整手势撤销 / 取消、手背 / 笔侧键擦除、合并采样、硬笔 / 压感笔轮廓；主白板与课件共用擦除逻辑。圈选问答 / 指令走原命令链，结果写入真实可编辑对象，修复过期回答、网络取消 / 超时和配置测试。
- 已完成：保留用户恢复的 Fcboard 改名、安卓与网络改动；修正目录引用，并兼容同源旧配置 / 密钥 / IndexedDB。修复 CI 的 Scrcpy 测试阶段与缺失配置。
- 新增：书写模式默认多触点独立落笔；显式单点仅接受一个触点，不再将第二只手解释为捏合，选择 / 移动画布状态保留双指缩放。Cutover 按原 APK exchangeMorePosition 做左右换位（不是返回桌面）。隐藏按钮样式和小屏盒模型按失败产物修正。分享从现有菜单选择页面，支持 PNG 导出及 Android 局域网只读二维码、十分钟失效 / 关闭终止，新增真实 HTTP 与导出检查。
- 新增：原版单点 / 多点切换，多触点各自书写，重叠手势统一撤销 / 重做，取消只丢弃对应触点；复用已有笔迹构造与帧节流。修复手写双击误插入文本、页码重叠及小屏分组挤压。
- 真机证据：adb 192.168.0.7:40317，RK3576 / Android 16 / 3840×2160 / density480 / 60Hz，原版 5.42；厂商 touch_threshold120 → 原 APK80 物理像素。新增原生读取并按实际 DPR 换算笔宽 / 橡皮 / 手背阈值，课件同样校准。原版已有笔迹保留。底栏依据同机截图改为分组，撤销 / 重做回中央，支持隐藏 / 恢复。
- 修改位置：白板 LayerUI / WhiteboardTools / App / 轮廓 / 擦除 / 设置恢复、fcdraw 实际目录与菜单、设备校准桥、对应测试 / e2e / CI、依赖锁与对照文档。
- CI 修复（下一项）：资源链接已通过，Android Java 编译与 JVM 测试通过；lint 提示 MainActivity / NetworkSessionService 无法解析。Java 声明已改为 com.fcjy.fcboard 但目录仍为 com/fcjyboard/fcdraw，统一 main / test / androidTest 目录与声明，不关闭 MissingClass 检查。
- CI 修复：4a789d4 的静态 / 单元与生产页面检查均通过，Android 在 processDebugResources 因改名后 fcboard_icon 资源缺失失败；将既有 fcdraw_icon.xml 同步改名为 fcboard_icon.xml，未重新绘制图标。
- 验证：前轮 check / lint / test:other / 124 文件 1383 项测试通过。新增设备校准后 check、lint、test:other 及 Python 适配器 3 项已通过，完整测试正在复核；28 项浏览器用例与 1 项后置 Scrcpy 用例可枚举。本地未运行 build / dev / Cargo / Gradle。
- 剩余：推送与 CI / APK 安装、同机触控与 UI 对照；多点同时书写、原版全部笔型 / 教具 / 插入对象、非笔迹透明局部擦除、厂商原生加速、真实 AI 模型效果与笔迹克隆均未全部完成。不能据现有自动化检查声称 90%。
