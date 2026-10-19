# HWhiteBoard 5.42 对齐记录

目标是保持出厂白板的书写、擦除和触控体验，再将 AI 接入原操作。当前没有真机量化验收结果，不能把本记录或单元测试当作“90% 还原”认证。

## 样本与复核方式

样本来自用户的 `ss/HWhiteBoard` 解包目录。反编译 `BuildConfig` 确认包名 `com.paike.zjc`、版本 5.42、版本号 38。使用 Homebrew jadx 1.5.6 与 apktool 3.0.3；解码结果位于本机 `/tmp/fcboard-apk-reference`、`/tmp/fcboard-apk-res`，没有将反编译副本、APK 或厂商二进制加入项目。

| 文件 | SHA256 |
| --- | --- |
| `classes.dex` | `aa20ee80ae18ff4476cc46fd6f2e078400cb15e855626a6176ed5a86caf003f3` |
| `classes2.dex` | `fef924f373928a59396075d19ca018b6bd21e4eb0e1684e578b43fff4357fee0` |
| `resources.arsc` | `72875b9745140a1a33de9dc3f578b2a1bb87bbd06e28558008235904246392ae` |
| `lib/arm64-v8a/libWhiteboard-sdk.so` | `38d77cfb49ef403bd9db9206dc346219a6207e7f62f7219a53add8d0ae624c7e` |

解包目录可以临时重新打成 ZIP/APK 后运行 `apktool d -s`；Java 代码直接运行 `jadx --no-res classes.dex classes2.dex`。jadx 对整个依赖集报告 32 项反编译错误，因此只将实际成功读取的方法作为实现依据，没有把反编译失败的代码当作已审阅。

## 关键代码与本轮实现

| APK 证据 | 当前实现与边界 |
| --- | --- |
| `res/layout/layout_bottom_bar.xml`：中心为画笔、橡皮、选择、插入、工具、撤销、恢复、单点；侧边为菜单、前后页、页码、新建 | `WhiteboardTools` 与 `LayerUI` 收起平铺的图形，恢复紧凑操作结构。白板页码及前后切换沿用真实 BoardBook；录制、截图、语音、设置、协作、问答回到菜单。小屏保留菜单和历史按钮，中间工具可横向滚动；页列表也可从菜单进入。独立课件工具栏尚未完全按 APK 重排。 |
| `ZWhiteBoardActivity.onClick`：再次点击已选画笔 / 橡皮打开属性 | 常用工具首次点击切换，再次点击打开属性；插入弹层保留原图形、文本、图片等工具。没有另设常驻 AI tab。 |
| `HCurveObject.onMove`：二次曲线平滑，普通笔为固定宽度；`HBezierObject`：压力 / 速度计算宽度；`BaseApplication` 默认硬笔宽 4、毛笔宽 15，可被系统属性覆盖 | 新笔迹记录 `fcInk`，普通笔固定宽度，毛笔保留压力 / 速度效果。基准宽度对应 4 / 15，按当前缩放转换到场景单位。采样在渲染节流前收集，支持 `getCoalescedEvents`，每帧批量写入；Canvas 和 SVG 导出共用同一轮廓算法。旧文件保持原渲染参数。仍使用项目已安装的 perfect-freehand，未声称逐点复刻 APK 毛笔公式。 |
| `HEraserObject`：宽高比 5:6 的矩形，移动时形成连续扫过区域，Canvas 使用 CLEAR / DST_OUT | `eraser/stroke.ts` 按扫过的凸多边形裁剪笔迹线段，保留两侧可编辑笔迹和插值压力。稀疏点、快速横扫、旋转笔迹均有测试；一次手势一次历史记录，取消恢复。课件批注使用相同几何裁剪。当前是向量笔迹裁剪，边缘按笔帽留量处理，并非逐像素透明蒙版；文字、图片、填充图形的任意局部擦除仍未对齐，可用选择删除或原对象橡皮。 |
| `HTool.accelerateDown` / `accelerateMove`：根据 `getTouchMajor`、`getTouchMinor` 和智能笔按钮识别橡皮；`getSize` 从厂商数据库读取 `touch_threshold` 并乘 2/3 | 主白板依据 PointerEvent 接触宽高临时擦除，保留原选中工具，笔正在书写时忽略另一大面积触点。提供开关、大小及 16..120 CSS 像素阈值校准；默认阈值 36 是待实测的初始值，不能等同厂商阈值。触控面积被设备固定报告为 1 时不能可靠识别手背。Android 原始长短轴与 WebView 接触面积的对应仍需 adb 验证。 |
| `HCanvas.onTouchEvent`、`doPoint`：单点 / 多点书写与双指 / 多指缩放分支 | 保留现有双指缩放和拖动行为；增加手掌擦除的独立输入生命周期与取消清理。多用户同时书写、厂商多点模式、触摸过程中粗细笔识别仍待逐项移植和实机验证。 |
| `NativeWhiteboard` 与 `libWhiteboard-sdk.so`：原生画布、局部区域刷新、原生擦除 JNI；Manifest 使用系统 UID | 当前仍是 Capacitor WebView 绘制。没有复制厂商库冒充完成原生加速；JNI / 固件兼容性、输入到显示延迟、长时间连续书写的掉帧都需目标设备测量。 |

PointerEvent 的接触面积单位为 CSS 像素，不能再乘 devicePixelRatio；画布像素密度仍交给现有渲染层处理。采样方式核对了 [MDN 接触宽度](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/width)、[合并事件](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)、[Android MotionEvent](https://developer.android.com/reference/android/view/MotionEvent) 和 [tldraw 的 Canvas 采样实现](https://github.com/tldraw/tldraw/blob/8a7b1a65ab4c7365319614ffef68590dee23f305/packages/editor/src/lib/hooks/useCanvasEvents.ts)。

## 2026-10-18 目标设备实测

已通过 adb 连接 `192.168.0.7:40317`。设备为 Rockchip RK3576 / BDV3576B（Android 报告 SSI 16 on ARM64），Android 16，3840×2160、density 480、60 Hz。原厂系统应用 `com.paike.zjc` 为 5.42 / 38，位于 `/system/app/HWhiteBoard`。触控设备报告 InfraredMultiTouch-61 Touch Device,86-60P，支持接触长短轴。

读取厂商 `tbl_Settings.touch_threshold=120`，按原 APK `getSize()` 得到 80 个物理像素。新增原生 `getInkProfile` 读取这一参数，按 WebView 实际 DPR 转换一次到 CSS 像素；硬笔 4、毛笔 15、橡皮 150 的物理像素基准同样换算。无法访问厂商数据库时保留手动阈值；用户保存的偏好优先。设备参数不存入白板文件，避免换屏后继续沿用错误校准。课件笔迹采用相同换算。

原版启动后已有绿板笔迹，已保留，不清除应用数据。截图与 UI hierarchy 确认三组独立底栏、中央撤销 / 重做和隐藏按钮；布局继续据此修正。原版截图、输入与显示诊断暂存 `/tmp/fcboard-*`，不把设备数据提交仓库。当前尚待安装本轮 CI APK 对照，物理手背触摸和端到端笔迹延迟尚未量化。

## 其余功能清单

从布局资源读取以下原版入口。现有同名或近似功能不自动算作对齐，后续需要按实际行为、数据与真机操作验收。

| 原版功能 | 当前状态 |
| --- | --- |
| 细笔 / 粗笔、画笔、钢笔、荧光笔、虚线笔、文字、图形、魔术、彩虹笔、粗细 / 颜色 / 预览 | 固定宽笔、压感笔、颜色、粗细、透明度、文字 / 图形已有；双笔尖、原版笔型、彩虹 / 魔术效果、原笔迹识别参数尚未完整对应。 |
| 橡皮及滑动清屏 | 手写局部擦除与原对象擦除可用；原版滑动清屏手势、所有内容透明局部擦除待实现。 |
| 图形、网页、思维导图、表格、四线格、文档、多媒体、信号源、教学资源 | 图形、文档及已有嵌入能力保留；其余原生专用对象、信号源和厂商资源接口未逐项复刻。 |
| 快传、分栏、投票器、直尺、圆规、量角器、三角尺、计算器、聚光灯、计时器 | 原快传、尺规部分、计时器及数学计算已有；分栏、投票器、圆规 / 三角尺精确交互、聚光灯仍有缺口。 |
| 打开、保存、扫码分享、邮件发送、白板设置、退出、导出图片、插入素材 | 沿用现有文件 / 导出 / 设置；原厂格式兼容、分享和邮件流程、退出 / 保存语义需另行对照验收。 |

## AI 接入与验收

圈选确定算式、函数沿原数学链路执行；明确问题 / 操作请求复用现有命令路由。问答和总结写入真正可编辑的白板文本，课件打开时路由到当前批注层；讲解沿现有逐步绘图控制器。普通标题不自动改写，选区变化使过期回答失效。模型只能执行已注册命令，不能据此声称所有原版能力已实现。

AI 仍需真实模型 ID、密钥与可访问的兼容接口。修复取消信号覆盖超时、原生请求取消等待、非 JSON 网关错误；设置中可测试未保存配置，有白板内容时同时发送视觉上下文。改名保留同源旧配置、会话密钥和旧 IndexedDB 数据读取。更换 Android applicationId 会建立独立应用沙箱，不属于同源数据兼容的保证范围。

本地检查使用 CI 同版本 pnpm 10.28.2，安装依赖时禁用脚本。当前主机 Node 26 默认的实验性 Web Storage 会影响 jsdom，测试时使用 `NODE_OPTIONS=--no-experimental-webstorage`。不运行本地 build / dev / Cargo；浏览器生产页面、APK 和设备检查需在已有 CI 或待连接设备上继续。

设备连接后先读取型号、系统、物理 / 覆盖分辨率、DPI、刷新率、输入设备与应用版本；不清除设备数据。对比相同尺寸的连续直线、曲线、拐角、小字、快速回环、不同笔型、不同宽度、手背触点、双指变换、局部擦除及撤销。还原度必须以这张功能清单和同机对照记录计算，不能以新增入口数或代码量代替。
