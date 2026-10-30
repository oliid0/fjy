# Fcboard 重命名与依赖边界

当前保留用户的 Fcboard 类型、组件和内部 `@fcboard/*` 名称。根项目名为 `fcboard`；第三方依赖的真实包名及导出名不参与替换。

## 已修复的实际问题

- 首轮确认的 13 处误改涵盖 `gFcboardng`、`Fcboardlse`、`boFcboard`、错误字段 / 类型、样式路径和 Mermaid 第三方 API。实际外部包仍是 `@excalidraw/mermaid-to-excalidraw`，其 `parseMermaidToExcalidraw` / `MermaidToExcalidrawResult` 通过本地别名适配。
- 浏览器实测发现画布仍使用 `excalidraw__canvas`，SCSS 已生成 `.fcboard__canvas`。已统一画布、临时笔迹层、网页容器、截图和录制选择器；修复画布排列到可视区外、无法落笔的问题。
- DOM 属性已改为 `data-fcboard-id` / `data-fcboard-owner`，读取却仍使用 `dataset.excalidrawId` / `excalidrawOwner`。已同步门户归属、手背擦除转发、AI 控件检查和相关测试。
- 新导出采用 fcboard 标签，同时恢复读取原有 Excalidraw JSON / library / PNG / SVG（含未压缩 v1 SVG）。原始 PNG / SVG 兼容样本保留；压缩导出快照按实际新标签更新。
- 包声明、相对路径大小写、字体、静态资源和导入别名一起核对；仅改类型名不会自动修改外部包的导出。

## main 与 fc 工作区

main 的 app 使用 `@fcboard/*` 别名，直接解析本仓库 packages 源码；app 不依赖远程 `fcboard`。TypeScript / Vite / Vitest 的本地映射保持一致，工作区安装可重新生成 node_modules，不能提交安装目录。

本地 fc 工作区位于 `/Users/oi/Documents/fjy-fc`，保留独立 npm 消费方式：app 从 `fcboard` / `fcboard/editor/*` 导入，使用独立 tsconfig 和安装包静态资源，无 app 源码目录别名。用户已明确授权只在 fc 工作区本地提交一次；该分支不推送，main 的暂存区与工作目录独立保留。

仓库名与远程包同为 fcboard 时，pnpm 的工作区链接可能误选根项目。远程消费清单采用 `npm:fcboard@0.18.0`，并须通过实际 registry 安装生成锁文件，不能把 `link:..` 当成发布包验收。

## npm 产物

发布目标是无作用域的 `fcboard`，内部源码包 `@fcboard/fcboard` 保持私有。`build:packages` 将可发布目录生成到 `packages/fcboard/dist/npm`，内含编译 JS / CSS / 字体 / WASM / 图片 / JSON / 类型声明及必要的 package.json、README、MIT LICENSE；不含 TS 实现、SCSS、测试、环境文件或源码映射。

公共包提供画布引擎及原版需要的底层交互；完整的原版菜单、设置、分享、课件及 AI / 语音逻辑仍由 app 组合实现。包构建成功不代表完整原版复刻验收完成。发布和最终检查状态以 history.md 为准。
