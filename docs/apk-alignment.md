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

## Java 对照副本与输入分支审阅

可读反编译结果已完整保存到本机 `ss/HWhiteBoard-reference/java/`，资源在 `ss/HWhiteBoard-reference/resources/`，入口与哈希审计见该目录 `README.md`、`audit.json`。目录由现有 Git 忽略规则排除。共 7728 个 Java 文件，其中 `com.paike.zjc` 白板业务包 183 个；扫描发现 34 个依赖文件含错误或未还原方法标记，白板业务包未发现同类标记。该扫描只能表明方法体可读，不能等同原始工程恢复或语义全部正确。

进一步核对的 Java 实现：

| 方法位置 | 行为与当前处理 |
| --- | --- |
| `HCanvas.onTouchEvent:495` | 是否书写 / 选择 / 多点先决定手势分支，不能简单以触点数大于一进入缩放。当前默认多点落笔；显式单点忽略第二处笔迹，选择 / 移动状态保留捏合。 |
| `HTool.accelerateDown:144` | 按 pointerId 保存对象；任一接触轴大于厂商阈值或笔擦键进入橡皮。当前笔迹同样按触点独立持有与取消。 |
| `HObject.round:63`、`HCurveObject.continueStroke:85` | 0.3 / 0.7 阈值半像素量化，上一采样点作为二次曲线控制点，中点作为终点。新增 version2 固定宽笔迹共用此类曲线路径，Canvas / SVG 使用圆笔帽与圆连接；末端补到最后真实采样点，不预测未来位置。旧笔迹保留原轮廓。 |
| `HBezierObject.calcNewWidth:205` | 历次移动距离加权、宽度变化和压感修正，最终串接变宽椭圆。新 version3 钢笔采用 Java 的 0.6 / 0.4 距离加权、45/50 默认变化量、平方根压力修正与最小宽度，按 Bezier 中点采样，再以 2:1 扁椭圆形成填充路径。局部擦除保存采样曲线、宽度和椭圆旋转方向，防止剩余笔迹重新计算变形。保留最后真实触点，不照搬原生末端截断及画布边缘钳制；系统自定义变化参数和原生尾锋仍待真机核对。 |
| `HDashedCurveObject.createDashEffect` | 虚线段 max(1.6× 笔宽,8)、间隔 max(1.8× 笔宽,10)。按设备单位换算并共用于 Canvas / SVG；局部擦除后的片段保留虚线相位。 |
| `HRainbowCurveObject.createBoardRainbowShader` | 普通曲线笔加整张白板宽度的横向渐变，12 个固定色标，超出两端钳制。当前复用 version2 曲线和 Java 色标，在落笔时保存可见白板的场景范围；Canvas / SVG 共用逆变换后的渐变坐标，局部擦除不重置色带，缩放 / 裁切导出不改色。移动 / 旋转后的颜色仍按白板横坐标取值；不同于原 APK 随位图重绘的路径，颜色范围在笔迹创建时固定，避免换分辨率重新着色。现有属性面板及 AI 的 canvas.style.pen 共用笔型状态；课件层尚未接入该笔型。 |
| `ZWhiteBoardActivity.doHighlighter:2810` | 荧光笔 alpha110/255；当前荧光笔保留同样透明度比例，独立于用户透明度设置。 |
| `HEraserSettingWindow.onStopTrackingTouch:59` | 清屏滑块低于 98 回零，达到 98 清空并回到画笔；小中大 100 / 150 / 200 物理像素。当前增加相同阈值与尺寸换算，清屏保留背景 / 画笔偏好且可一次撤销。 |
| `exchangeMorePosition:2746`、`setBottomMenuCollapsed:1131` | Cutover 切换侧边操作位置；Hide 收起工具栏并关闭底部弹层。隐藏状态沿现有 AppState 传递到属性、橡皮、工具箱与页列表，恢复时旧弹层保持关闭；状态不存入文件、浏览器或协作数据。AI 共用 canvas.toolbar 路由。不是系统返回桌面操作。 |

`NativeWhiteboard.java` 的 13 个 native 声明与 ARM64 .so 的 JNI 符号已对应；底层刷新 / framebuffer 代码不是 Java，不能把现有 JNI 包装声明记作“已经移植原生加速”。

原工具箱还有一组外部应用调用，来自 `HGizmoSettingWindow.onClick / launchPackage / startSplitScreen`，不是白板内的自绘组件：

| 原工具 | 已核对的调用                          |
| ------ | ------------------------------------- |
| 快传   | `com.bsd.fastfile` 的启动 Intent      |
| 投票   | `com.bsd.vote.android` 的启动 Intent  |
| 计算器 | `com.bsd.bsdcalculator` 的启动 Intent |
| 聚光灯 | `com.hwh.spotlight` 的启动 Intent     |
| 计时器 | `com.bsd.timer` 的启动 Intent         |
| 分屏   | `bsd.intent.action.SPLITE_SCREEN`     |

新增 `FactoryTools.java` 和 Classroom 插件方法，按白名单解析可启动应用；只在原工具箱呈现实际可用的选项，缺失 / 权限拒绝返回真实错误。触控和 AI 共用 `tools.factory` 命令，调用中禁用按钮，失败恢复并提示。没有添加底栏 tab。`<queries>` 声明这五个包、分屏 Intent 和厂商设置 provider，依据 [Android 包可见性文档](https://developer.android.com/training/package-visibility/declaring)，没有请求枚举全部应用权限。分屏未复制原 APK 的系统遮罩广播或原生 framebuffer 停止逻辑；这些是固件 / 系统 UID 部分，必须继续真机核验。

UI 专项覆盖触控 / AI 同一路由、失败恢复、缺失工具不进入模型能力清单。生产页面新增 800 / 1920 宽度的 Capacitor 桥接夹具检查；它验证 UI 布局与调用，不等同真实预装应用验收。

## 关键代码与本轮实现

| APK 证据 | 当前实现与边界 |
| --- | --- |
| `res/layout/layout_bottom_bar.xml`：中心为画笔、橡皮、选择、插入、工具、撤销、恢复、单点；侧边为菜单、前后页、页码、新建 | `WhiteboardTools` 与 `LayerUI` 收起平铺的图形，恢复紧凑操作结构。白板页码及前后切换沿用真实 BoardBook；录制、截图、语音、设置、协作、问答回到菜单。小屏保留菜单和历史按钮，中间工具可横向滚动；页列表也可从菜单进入。独立课件工具栏尚未完全按 APK 重排。 |
| `ZWhiteBoardActivity.onClick`：再次点击已选画笔 / 橡皮打开属性 | 常用工具首次点击切换，再次点击打开属性；插入弹层保留原图形、文本、图片等工具。没有另设常驻 AI tab。 |
| `HCurveObject.onMove`：二次曲线平滑，普通笔为固定宽度；`HBezierObject`：压力 / 速度计算宽度；`BaseApplication` 默认硬笔宽 4、毛笔宽 15，可被系统属性覆盖 | 新笔迹记录 `fcInk`，version2 普通笔用原 APK 的中点二次曲线、固定宽度、圆笔帽 / 连接；钢笔采用原版距离 / 压力宽度递推和扁椭圆笔触。基准宽度对应 4 / 15，按当前缩放转换到场景单位。采样在渲染节流前收集，支持 `getCoalescedEvents`，每帧批量写入；Canvas 和 SVG 导出共用同一轮廓算法。旧文件保持原渲染参数。新钢笔 Canvas / SVG 共用扁椭圆填充路径；旧笔迹保留 perfect-freehand，避免打开旧文件改变外观。 |
| `HEraserObject`：宽高比 5:6 的矩形，移动时形成连续扫过区域，Canvas 使用 CLEAR / DST_OUT | `eraser/stroke.ts` 按扫过的凸多边形裁剪可见笔迹，保留两侧可编辑笔迹和插值压力。version2 曲线按实际半像素量化后二次曲线采样，误差目标为创建时 1/64 物理像素，超大导入每段最多 4096 步；残段保存中心线，避免二次平滑或重新量化。回归用例覆盖控制点 (100,200) 的可见曲线顶端 (100,150)，旧裁剪漏擦该点。稀疏点、快速横扫、旋转、重复擦除均有测试；一次手势一次历史记录，取消恢复。课件批注使用相同几何裁剪。当前是向量笔迹裁剪，边缘按笔帽留量处理，并非逐像素透明蒙版；文字、图片、填充图形的任意局部擦除仍未对齐，可用选择删除或原对象橡皮。 |
| `HTool.accelerateDown` / `accelerateMove`：根据 `getTouchMajor`、`getTouchMinor` 和智能笔按钮识别橡皮；`getSize` 从厂商数据库读取 `touch_threshold` 并乘 2/3 | 主白板依据 PointerEvent 接触宽高临时擦除，保留原选中工具，笔正在书写时忽略另一大面积触点。提供开关、大小及 16..120 CSS 像素阈值校准；默认阈值 36 是待实测的初始值，不能等同厂商阈值。触控面积被设备固定报告为 1 时不能可靠识别手背。Android 原始长短轴与 WebView 接触面积的对应仍需 adb 验证。 |
| `HCanvas.onTouchEvent`、`doPoint`：单点 / 多点书写与双指 / 多指缩放分支 | 保留现有双指缩放和拖动行为；增加手掌擦除的独立输入生命周期与取消清理。新增单点 / 多点切换，多点时每个触点独立保留合并采样、取消和笔迹，每个触点按完成顺序分别撤销 / 重做（对应 HCanvas.onAllTouchUp 的 HAddObjectCommand）；显式单点忽略第二个书写触点；选择 / 移动工具保留捏合。自动化覆盖两触点交错书写及单独取消，仍待真机多人验收；厂商粗细笔尖识别待实现。 |
| `NativeWhiteboard` 与 `libWhiteboard-sdk.so`：原生画布、局部区域刷新、原生擦除 JNI；Manifest 使用系统 UID | 当前仍是 Capacitor WebView 绘制。没有复制厂商库冒充完成原生加速；JNI / 固件兼容性、输入到显示延迟、长时间连续书写的掉帧都需目标设备测量。 |

PointerEvent 的接触面积单位为 CSS 像素，不能再乘 devicePixelRatio；画布像素密度仍交给现有渲染层处理。采样方式核对了 [MDN 接触宽度](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/width)、[合并事件](https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents)、[Android MotionEvent](https://developer.android.com/reference/android/view/MotionEvent) 和 [tldraw 的 Canvas 采样实现](https://github.com/tldraw/tldraw/blob/8a7b1a65ab4c7365319614ffef68590dee23f305/packages/editor/src/lib/hooks/useCanvasEvents.ts)。

## 2026-10-18 目标设备实测

已通过 adb 连接 `192.168.0.7:40317`。设备为 Rockchip RK3576 / BDV3576B（Android 报告 SSI 16 on ARM64），Android 16，3840×2160、density 480、60 Hz。原厂系统应用 `com.paike.zjc` 为 5.42 / 38，位于 `/system/app/HWhiteBoard`。触控设备报告 InfraredMultiTouch-61 Touch Device,86-60P，支持接触长短轴。

读取厂商 `tbl_Settings.touch_threshold=120`，按原 APK `getSize()` 得到 80 个物理像素。新增原生 `getInkProfile` 读取这一参数，按 WebView 实际 DPR 转换一次到 CSS 像素；硬笔 4、毛笔 15、橡皮 150 的物理像素基准同样换算。无法访问厂商数据库时保留手动阈值；用户保存的偏好优先。密度变化通过重新注册 resolution 媒体查询及 resize 检测，更新之后落笔的换算；对应 [MDN 的 DPR 变化监听示例](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes)。设备参数不存入白板文件，避免换屏后继续沿用错误校准。课件笔迹采用相同换算。

原版启动后已有绿板笔迹，已保留，不清除应用数据。截图与 UI hierarchy 确认三组独立底栏、中央撤销 / 重做和隐藏按钮；布局继续据此修正。原版截图、输入与显示诊断暂存 `/tmp/fcboard-*`，不把设备数据提交仓库。当前尚待安装本轮 CI APK 对照，物理手背触摸和端到端笔迹延迟尚未量化。

## 其余功能清单

从布局资源读取以下原版入口。现有同名或近似功能不自动算作对齐，后续需要按实际行为、数据与真机操作验收。

| 原版功能 | 当前状态 |
| --- | --- |
| 细笔 / 粗笔、画笔、钢笔、荧光笔、虚线笔、文字、图形、魔术、彩虹笔、粗细 / 颜色 / 预览 | 硬笔曲线、钢笔递推、荧光透明度、虚线间隔与彩虹色标已有 Java 对应；双笔尖、魔术 / 图形 / 文字笔识别、原生尾锋与预览尚未完整对应。 |
| 橡皮及滑动清屏 | 手写局部擦除与原对象擦除可用；滑动清屏阈值与三档大小已按 Java 对应；所有内容透明局部擦除待实现。 |
| 图形、网页、思维导图、表格、四线格、文档、多媒体、信号源、教学资源 | 图形、文档及已有嵌入能力保留；其余原生专用对象、信号源和厂商资源接口未逐项复刻。 |
| 快传、分栏、投票器、直尺、圆规、量角器、三角尺、计算器、聚光灯、计时器 | 内置快传、尺规部分、计时器及数学计算已有；按 Java 补充六项系统工具调用与可用性发现，待目标设备核验。圆规 / 三角尺精确交互、没有预装工具时的同等内置能力仍有缺口。 |
| 打开、保存、扫码分享、邮件发送、白板设置、退出、导出图片、插入素材 | 沿用现有文件 / 导出 / 设置；原厂格式兼容、分享和邮件流程、退出 / 保存语义需另行对照验收。 |

## AI 接入与验收

圈选确定算式、函数沿原数学链路执行；明确问题 / 操作请求复用现有命令路由。问答和总结写入真正可编辑的白板文本，课件打开时路由到当前批注层；讲解沿现有逐步绘图控制器。普通标题不自动改写，选区变化使过期回答失效。模型只能执行已注册命令，不能据此声称所有原版能力已实现。

AI 仍需真实模型 ID、密钥与可访问的兼容接口。修复取消信号覆盖超时、原生请求取消等待、非 JSON 网关错误；设置中可测试未保存配置，有白板内容时同时发送视觉上下文。改名保留同源旧配置、会话密钥和旧 IndexedDB 数据读取。更换 Android applicationId 会建立独立应用沙箱，不属于同源数据兼容的保证范围。

本地检查使用 CI 同版本 pnpm 10.28.2，安装依赖时禁用脚本。当前主机 Node 26 默认的实验性 Web Storage 会影响 jsdom，测试时使用 `NODE_OPTIONS=--no-experimental-webstorage`。不运行本地 build / dev / Cargo；浏览器生产页面、APK 和设备检查需在已有 CI 或待连接设备上继续。

设备连接后先读取型号、系统、物理 / 覆盖分辨率、DPI、刷新率、输入设备与应用版本；不清除设备数据。对比相同尺寸的连续直线、曲线、拐角、小字、快速回环、不同笔型、不同宽度、手背触点、双指变换、局部擦除及撤销。还原度必须以这张功能清单和同机对照记录计算，不能以新增入口数或代码量代替。
