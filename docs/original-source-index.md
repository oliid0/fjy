# 原版源码入口索引

分析报告用于导航；此表由当前 `com/paike/zjc/**/*.java` 的 `R.layout.*` 引用扫描得出，不含 R.java。直接引用共 55 个布局；这不是功能总数或完成率，仍须追踪 XML 子视图、动态资源、Canvas 对象、厂商硬件及不可达分支。报告中的旧缺口需以当前代码复核。

本阶段优先全部原版界面和操作，新增算式 / 函数 / 魔法 / 语言笔与 AI 不计复刻指标。原版文字笔、图形笔、手写候选、语言包和资源工具仍在范围内。用户已要求设置自动保存，此处有意覆盖原保存按钮。

推送前按源码 / 当前代码 / 自动检查判断实现完成度；代码完成后推送 CI 打包，再交用户实机测试。实机视觉、笔触、声学及物理硬件验证不阻塞推送。下表中的待实机 / 待 CI 与代码缺口分别记录，55 个布局入口不用于计算百分比。

## 本轮已深入追踪

- 背景：NewSlideBackgroundView → ZWhiteBoardActivity.saveCustomBackground → HCanvas.setBitmapPaint / resetBitmapBG。原内置图案 alpha 150，自定义图片 alpha 255；原菜单图标与整幅背景图是不同资源。
- 语言包：LanguagePackDialogFragment / Adapter / Info → ModelManager 的 39 语言目录、九种状态、串行队列和 SDK 下载 / 删除；不是界面语言下拉。
- 周期表：TeachingResDataProvider.chemistryToolItems → TeachingResWindow.handleChemistryToolItemClick → PeriodicTableDialogFragment / View / DataProvider。原资源目录抽取曾漏掉 toolItem 动态入口；本轮补 118 元素 / 118 详情行和实际插入。getElementRect 的反编译返回分支损坏，布局依据其明确 group / period / detached-series 算式重建，并验证 118 个位置无重叠。

- 记分牌：TeachingResDataProvider.otherItems → TeachingResWindow.handleOtherItemClick → ScoreBoardWindow / dialog_score_name_edit。现补“其他”入口、原三组 1 / 2 / 1、独立加减至负分、改名确认 / 取消；重开重新计分。
- 统计图表：mathToolItems → handleMathToolItemClick → ChartEditDialogFragment / ChartPreviewView → HCanvas.addPhotoByPath。现补左侧“数学工具”子菜单、原数据编辑 / 增删行、三种实时图表及实际图像插入 / 撤销；横竖屏重排。原实验区仍只有概念 / 应用两个标签，工具不混入实验标签。

## 布局入口与当前落点

| 原布局 | 直接引用的原类 | 当前实现 / 待办 |
| --- | --- | --- |
| `clear_popu_view` | `popu/ClearPopu.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `dialog_chart_edit` | `view/ChartEditDialogFragment.java` | ChartEditor / chartData / TeachingResources；原默认数据、增删 / 编辑、柱线饼图预览与真实插入已接，页面 / 像素待验 |
| `dialog_function_graph` | `view/FunctionGraphDialogFragment.java` | FactoryFunctionGraph / functionGraphData；六预设 / 自定义 / 生成 / 删除 / 清空、拖动 / 双指缩放 / 双击复位、当前视图插入与撤销已接；页面 / 真机待验 |
| `dialog_language_pack` | `recognition/LanguagePackDialogFragment.java` | HandwritingLanguagePacks / DigitalInkPacks；本轮接实际 ML Kit 管理，原生待 CI |
| `dialog_language_pack_confirm` | `ZWhiteBoardActivity.java`, `recognition/LanguagePackDialogFragment.java` | 同上，缺包提示及删除确认，默认模型禁止删除 |
| `dialog_periodic_table` | `teaching/periodic/PeriodicTableDialogFragment.java` | PeriodicTable / periodicTableData / TeachingResources；本轮接 118 元素和实际卡片插入，待页面验收 |
| `dialog_random_number` | `view/RandomNumberDialogFragment.java` | RandomNumber；1–8 数量、−999 至 999 无键盘滚轮、端点 / 重复 / 等值 / 区间错误 / 反复抽取；横竖屏页面与原生滚轮触感待验 |
| `dialog_score_name_edit` | `view/ScoreBoardWindow.java` | ScoreBoard；名称编辑确认 / 取消，保留原空名与空格规则，待页面验收 |
| `email_item` | `view/EmailAutoComplete.java` | MailComposer / mailForm；原 13 个后缀、过滤、键盘 / 指针选择及多收件人前缀已接；候选浮层避免挤压写信表单 |
| `file_grid_item` | `adapter/HFileGridAdapter.java` | FactoryFileBrowserDialog 原 60×75 / 实际图片缩略图 / PDF 图标 / 选中背景 / 名称，窄屏换列；待原生 CI |
| `file_list_item` | `adapter/HFileListAdapter.java` | 原 file_path_list 与切换控件在参考 XML 中为 GONE；当前按原默认网格，未杜撰可见列表开关 |
| `http_popu_view` | `popu/QRHttpPopu.java` | ShareQRCode / BoardShare / LanSession；本地与云端实时均接原开关 / 四位码 / 二维码不变。当前画布云端真实链路已有回归，hus HTTPS 已配置待 CI 网页部署；静态云选页及真实 PNG 下载已接，本地十分钟 / 密码生命周期一致，均待 CI 部署；见 cloud-sharing |
| `item_language_pack` | `recognition/LanguagePackAdapter.java` | 同上，实际状态 / 当前语言 / 下载队列 / 删除 / 重试 |
| `item_network_res_button` | `teaching/renderer/TeachingNetworkResourceRenderer.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `item_teach_resource_card` | `adapter/TeachingResCardAdapter.java`, `teaching/renderer/TeachingGroupedResourceRenderer.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_about` | `popu/AboutPopu.java` | BoardSettings / SettingsNavigation / Classroom；首页与阈值已续修，其他入口仍须逐项对照 |
| `layout_auto_picture` | `view/HAutoPictureWindow.java` | 原涂鸦素材 / 新魔法笔暂不计本阶段指标 |
| `layout_auto_shape_window` | `view/HAutoShapeWindow.java` | FactoryShapes / factoryShapeGeometry；已有连续放置，全部图形待验 |
| `layout_chooser` | `popu/ChooseFilePopu.java` | BoardShare / BoardSwitcher；真实保存 / 打开存在，原文件交互尚未完全一致 |
| `layout_chooser_bzd` | `popu/ChooseBzdPopu.java`, `popu/ChooseServerPopu.java` | ShareServerChooser 接静态选页 / BZD 保存 / 打开的原 250×151 两项；LanSession 实时入口复用原布局。静态 PNG 云上传下载、BZD XML / 四位提取码 / 实际导入已接真实回归；课件同步及原生 / 页面待 CI |
| `layout_chooser_slide` | `popu/ChooseSlidePopu.java` | BoardShare；选页存在，完整分享流程待验 |
| `layout_delete_mailbox_pop` | `popu/DeleteMailBoxPopu.java` | MailComposer；原 300px 删除确认 / 取消、返回只关确认层、真实删除失败保留账户与重试；AI 共用实际动作 |
| `layout_email` | `popu/EmailPopu.java` | 遗留布局；实际 showEmailPopu 构造 NewEmailPopu，未找到 new EmailPopu 调用，不复制遗留厂商账号或把旧布局当活动入口 |
| `layout_eraser_setting` | `view/HEraserSettingWindow.java` | WhiteboardTools / eraser；已有实现，全部手背 / 对象命中和菜单待验 |
| `layout_exit_pop` | `popu/ExitPopu.java` | ExitDialog / boardFile；保存 / 不保存 / 取消已接，设备 chooser 待验 |
| `layout_extra_code` | `popu/ExtraCodePopu.java` | BzdCodeDialog / cloudTransfers：原四位字母数字、上传只读 / 输入导入、确认 / 取消 / 错误重试、实际 XML 及 24h 持久保存已接；保留期为本服务决定，原界面 / 页面待 CI |
| `layout_file_browser` | `popu/FileBrowserPopu.java` | FactoryFileBrowserDialog / FactoryFileAccess / boardFile / FactoryPageExport；原网格 / 本地 / 移动盘 / 返回 / 选择 / 文件名 / 确认接 BZD、图片 / 背景选择与 JPG / PDF 保存；原类型目录 / 页码 / A4 布局已接，整页尺寸 / 字形 / 大批量 / 原生窗 AI 控件及编译 / 真机待验；原列表 / 排序 / SD 为 GONE，未新增无来源入口 |
| `layout_fuzzy_recog` | `view/HFuzzyRecognitionWindow.java` | InsertionCandidates / digitalInk / inkRecognition；候选链路已有，真实同轨迹排序待验 |
| `layout_gizmo_setting` | `view/HGizmoSettingWindow.java` | FactoryGizmos / TeachingTools；已有交互，四套尺规完整触控与视觉待验 |
| `layout_hprogress_popu` | `popu/HProgressPopu.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_insert_setting` | `view/HInsertSettingWindow.java` | InsertMenu / FilePreview / TeachingResources；已有入口，全部原生对象仍待核对 |
| `layout_min_web_window` | `view/HMinWebWindow.java`, `view/HMinWebWindowZX.java` | ResourceWindow / WebResourceDialog；已接滚动 / 导入 / 拖动 / 缩放，新增原生待 CI |
| `layout_min_window` | `popu/MinWindowPopu.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_more_setting` | `view/HMoreSettingWindow.java`, `view/HSmallToolsWindow.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_navigation_grideview_item` | `adapter/HFileChooserAdapter.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_new_email` | `popu/NewEmailPopu.java` | MailComposer / MailPlugin；原 433×339 四层 / 返回来源 / 账户卡 / 六提供方 / 四核心字段及发送后关闭已接；复用真实 SMTP 验证、KeyStore、A4 meeting.pdf / 标题 / 图片流；扩展 IMAP / STARTTLS 收在高级项，mail.action / configure 可操作。九项界面回归通过，新增原生 PDF 仪器待 CI |
| `layout_new_slide_background` | `view/NewSlideBackgroundView.java` | BackgroundSettings / FactoryColorWheel / whiteboardBackground；本轮接自定义图片与原菜单资源，待页面验收 |
| `layout_note_delete_pop` | `popu/NodeDeletePopu.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_pen_setting` | `view/HPenSettingWindow.java` | FactoryPenSettings / whiteboardPen / ink；已有实现，真机和逐项视觉待验 |
| `layout_pen_setting_double_pen` | `view/HPenSettingWindow.java` | 同上，自动笔尖 / 双档配置已有实现，真机待验 |
| `layout_progress_popu` | `popu/ProgressPopu.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_progress_popu_text` | `popu/ProgressPopuText.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_score_board_window` | `view/ScoreBoardWindow.java` | ScoreBoard；三组分数、负分、名称编辑、重开复位及窄屏重排，页面 / 像素待验 |
| `layout_slide_chooser_item` | `adapter/HSlideChooserAdapter.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `layout_slide_index_dialog` | `view/HSlideIndexWindow.java` | BoardSwitcher；页面管理存在，预览全部操作待对照 |
| `layout_slide_index_page_item` | `adapter/HSlideIndexAdapter.java` | 整页 / 空白背景预览、横竖屏 / DPR 尺寸与迟到释放已有回归；选择 / 删除 / 复制及像素待完整验收 |
| `layout_table_setting` | `view/HTableSettingWindow.java` | TableSizePicker / InsertionPlacement / insertObjects / LiveTableWriting / TableActions；放置 / 笔色 / 实时增长、末端增删 / 内容保留 / 独立撤销、移后再改 / 重读及表格不缩放已接；原七矢量与小屏按钮换行。BZD 现读写原 OBJECT_TABLE / 非等宽网格，保留内容 / 样式并接回实际编辑。旋转入口待核实；实机是打包后验收 |
| `layout_teach_res_setting` | `view/TeachingResWindow.java` | TeachingResources / factory-resource-menus；八个原入口、各学科子菜单 / 实验标签、241 项提供器资源与补回的 PhET 主页共 242 项已接；卡片类型 / 分组 / 插入回归已接，逐像素与原生窗口待验 |
| `layout_threshold` | `popu/ThresholdPopu.java` | ThresholdSettings / ink / native / restore；校准、密度、默认和持久化已测，真机待验 |
| `layout_update_pop` | `popu/UpdateAppPopu.java` | 分析报告及调用点核查为静态不可达，排除运行中原功能指标 |
| `main` | `ZWhiteBoardActivity.java` | WhiteboardTools / AppMainMenu / BoardSwitcher；全部入口与反复开关 / 响应式待验 |
| `main_v` | `ZWhiteBoardActivity.java` | 同上；竖屏按可用空间重排，不能直接等比缩放 |
| `text_list_item` | `adapter/HTextFuzzyListAdapter.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `toast_text` | `view/ZToast.java` | 已有近似入口不能计完成；原控件及完整交互待逐项核对 |
| `zx_study_floating_window` | `view/ZXStudyFloatingWindow.java` | 网页交互参照，整窗 / 浮窗边界待设备验收 |

## 非布局缺项与验收边界

- 原数学工具三项现都接动态实现：函数、统计图表、随机数；函数绘图属于原版功能，没有与新增函数笔一起排除。物理 / 化学 / 生物 / 地理的原子菜单、物理七标签 / 化学双标签、生物六阶段组及函数独立入口已接实际内容；跨屏页面用例待 CI。

- SkizzeService / SkizzePenLayer / SkizzePenManager：标准翻页及自定义 USB VID/PID / 报告 / 控制命令、连接 / 电量 / 拔插 / 授权 / 重连、按键 / 双击、五色条和四种悬浮图层已有移植，复用真实白板 / 课件动作与白板快照。前台服务保留后台按键；普通安装的系统截图受实际权限约束，失败显示错误。前端回归及原生静态检查不代表原生编译、物理 USB、后台唤起 / 截图及视觉 / 悬浮时延已验收，见源码记录。
- BZD：当前 XML 与无损扩展已接；旧位图矩阵 / 裁剪透明度、原表格类型 / 非等宽 / 旧两角格式及可继续编辑已有回归，Android 真实像素仪器用例待 CI。HCanvas.cutPoint 在抬手时切分并保存结果，正常擦除路径不作为独立遮罩加入场景；含擦除对象的异常旧文件仍会拒绝，不能无依据叠加遮罩。旧 OBJECT_Note / OBJECT_ALPHABET 的真实矩形 / 关系 / 彩色文字 / 编辑及原生 XML 往返现已接入；40 节点外的大图、非 1920×1080 基准、自定义背景在原厂 XML 中的兼容、大文件内存及全部格式仍未完成。
- 页面 / 所有原菜单：自动回归不能替代实际横竖屏边界、逐像素图标 / 颜色 / 字体 / 圆角、笔触和手背延迟验收。当前不能据此确认 90%。
- 原生新增代码与全部新增页面用例尚待 CI；本地不启动 build / dev / Gradle / Cargo。
