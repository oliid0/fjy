# 云端与本地白板分享

目标仍是全部原版功能对齐与完整安装反馈修复。这里分别记录静态页面、BZD 文件传输、实时白板及尚未完成的课件同步；不能用这些链路替代整个目标验收。

## 入口与真实数据流

原 `ChooseServerPopu` / `layout_chooser_bzd` 是文件传输入口；实时双向编辑是本项目增加的需求。LanSession 复用原 250×151 居中面板、72×72 两项、26px 原云端 / 本地图标、12px 文字和灰阶 / 圆角。两个矢量 viewport / path / fill 已核对；小屏保持控件尺寸并留足关闭按钮触摸区。原全局 network-panel 的右 / 下定位及 margin 由专用样式重置，避免影响居中窗口。设置里未恢复 toolbox。

- 本地继续用实际 NetworkPlugin / LanServer / LanRoom，选本地后直接启动并显示同一套二维码。
- 云端使用 CloudShare → HTTP 创建 → 已认证的 host WebSocket → SceneSync；收到真实初始场景才显示二维码。扫码加载服务端实际打包的白板，guest 走原 `#lan` / `/board/` 协议，双向修改文字 / 笔迹 / 场景对象、删除、图片和背景。
- 服务端 merge / resolve 根据已有 LanRoom 的版本与较低 nonce 合并、文件首写、背景时钟 / client 排序；无效批次原子拒绝。每次请求 / 消息 / 房间 20 MB、50,000 对象、32 房间 / 每房 32 位参与者，另有 64 MB 聚合序列化数据预算、慢连接保护和闲置回收；不能把这些预算称作大文件问题全已解决。
- 密码行为依据 QRHttpPopu：默认关、四位、满位更新、关闭清空，二维码不变。仅开启后询问扫码端密码；等待者关密码即放行，已经加入的连接保持。创建服务密钥与四位访问码是不同用途，创建密钥不进入二维码 / 公开 AI 上下文。
- 取消 / 关闭待启动窗口会清理迟到本地启动或已创建云房间；实际失败保留错误。持续会话有独立 lifetime，结束或卸载后不再弹出旧发布错误。断线按原退避重连同一房间，重新合并场景。UI 与 collaboration.configure / start / stop 共用实际操作，start 支持取消信号；配置立即进入实际 ref，避免 AI 连续配置后启动读取旧值。

配置位于更多菜单的云端层，自动保存地址；密钥只在当前会话保存，公开状态仅提供 hasKey。Android 本地入口正常使用，浏览器缺少本地主机能力时显示禁用原因，仍能作为云端主机或扫码端。实时主机现可在同一二维码下切换白板页；SceneSync / Node Room / Android LanRoom 共用 page.id / epoch。每次访问另一页增加 epoch，替换场景、文件、背景及扫码端撤销记录；旧页及旧次访问的迟到包被拒绝，扫码者不能伪造翻页。BoardBook 在异步保存目的页期间仍把收到的编辑归到可见来源页，取消恢复原工作区。扫码端自行切换本地页仍离开协作。课件有独立 DocumentInk 数据流，尚未接到该协议，不能称作课件已可实时共享。

## 已配置的服务器

用户提供 `101.96.199.53`，SSH 别名 `hus`，已实际登录核对。系统为 Debian 13，运行环境是经过官方 SHA-256 核对的 Node 22.23.4，独立于系统原有环境；ws 8.22.0 复用项目已安装的同版本运行文件。Caddy 2.11.2 来自 Debian 签名 backports 包。未在本地或服务器运行前端 build / dev / Gradle / Cargo。

- 地址：`https://101.96.199.53/`，同时作为新安装的默认云端地址。`/etc/caddy/Caddyfile` 对应仓库 deploy/Caddyfile；独立 fcboard 账户及 fcboard-share.service 已安装并启用。
- 密钥在服务器 `/etc/fcboard/share.env`，root:root / 0600；未打印、未写入仓库或上传构建产物。服务代码在 `/opt/fcboard/share`，Node 在 `/opt/fcboard/node`；后端只绑定 127.0.0.1:8080，经 Caddy 代理 HTTP / WebSocket。
- 公网 IP 已取得 Let's Encrypt 可信证书，并交 Caddy 自动维护。依据 [Let's Encrypt 官方 IP 证书说明](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability) 使用 shortlived 配置；NAT 下无 SNI 客户端还需 [Caddy default_sni](https://caddyserver.com/docs/caddyfile/options#default_sni)。此前实际握手失败已据此修复；最终未跳过证书检查的 curl 为 TLS verification 0。
- **公网目前返回 HTTP 503：等待已验证网页版本。** 对应源码文本也说明这一状态。服务 unit 的 ConditionPathExists 等待 `/srv/fcboard/current/public/index.html`，Node 后端未对外宣称已上线。没有部署旧版网页或临时占位白板来假报扫码可用。
- 服务器此前安装的 server.mjs SHA-256 为 `11680a43a733f1f5478c51923a33454503810e5e35c6354ca5fc13b4355bc1ef`，其 Node 22 语法检查及真实运行环境回环自检通过。本轮新增 transfers.mjs、静态页面 / BZD 路由及页面 epoch；这些源码尚未上传，不能继续宣称远端哈希与当前源码一致。部署时须一起更新两个模块和同次 CI 网页。

## 构建与待办

CI 已加入服务独立 lint，并在已有网页构建后上传 Fcboard-Live-Share：服务代码、部署配置和同一次的 app/build 一起打包。全部代码目标完成后才按用户约定推送触发；取得对应产物后部署到 `/srv/fcboard/current/public` 并启动服务，再验证公网实际创建 / 扫码 / 编辑 / 密码 / 结束。构建产物不等于已部署。

## 静态页面和 BZD 文件传输

- 对照 ChooseSlidePopu / ChooseServerPopu：扫码入口先选页，再选云端或本地；保存入口保留 BZD / JPG / PDF 格式选择。静态云端复用现有选中 PNG 内容范围及 ShareQRCode，浏览器可作为云端主机，Android 继续支持本地 BoardShareServer。服务端实际返回页面列表、PNG 预览及下载；四位密码保护同时约束 HTML 和图片，修改密码清理旧 cookie，关闭保护立即开放，同一二维码不变。十分钟到期或关闭窗口结束；取消后迟到的创建也被删除。
- 对照 ChooseBzdPopu / ExtraCodePopu / UploadBZDUtils：保存 BZD 可选云端，使用现有 serializeBzd 上传真实 XML，成功才显示只读四位大小写字母 / 数字提取码。打开菜单先选云端 / 本地；云端不要求创建密钥，输入码后经 readCloudBzd → openBoardFile → BoardBook.importPages 导入，保留既有页并可继续编辑。错误留在输入层重试；取消不导入迟到结果，AI 的 board.open 接同一 code / endpoint 和取消信号。
- 本项目服务替代已停留在原源码中的厂商域名，没有向该厂商发送文件。页面暂存内存，BZD 写私有目录，默认 `/var/lib/fcboard/transfers`，可用 SHARE_DATA_DIR 覆盖；该路径与 unit 已有 ReadWritePaths 对齐。提取码有明确 24 小时保留期，重启后恢复未过期文件；这项时长是本服务的决定，原源码只规定四位码而未给出服务端保留期。
- 页面 / 文件各次请求限制 20 MB，共最多 32 个传输，与实时房间共用 64 MB 总数据预算；无效创建、越限、错误凭据及错误码明确失败。服务创建密钥 / 传输所有者密钥不进公开链接或提取结果。公网仍等待匹配 CI 网页部署，以上是本地真实 HTTP / WebSocket 与界面验证，不是已上线。

服务器地址已提供，不再重复询问或以缺地址阻塞。旧 BZD 节点 / 四线格的常见基准文件已接可编辑原生往返；大节点图、非标准基准及自定义背景兼容、课件实时同步、大文件及余下组件全面对照仍未完成。

前轮全量为 235 文件、2497 通过、46 既有跳过、1 todo。本轮验证结果见 history.md；新增真实 HTTP / WebSocket、BZD 重启往返、页面隔离和界面错误 / 取消回归。新增原生 socket 用例待 CI；三种视口的新页面用例仅发现，未本地启动页面环境。
