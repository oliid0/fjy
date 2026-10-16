# 原白板能力回归核对

以本仓库已有 Excalidraw 内核、测试和 [Excalidraw 功能说明](https://github.com/excalidraw/excalidraw#features)为基线。新上游版本的全部新增能力不自动等同本仓库版本已有能力。

| 能力 | 本轮处理与验证依据 |
| --- | --- |
| 矩形、椭圆、菱形、线、箭头、笔迹、橡皮、文字 | 保留原工具、快捷键与元素类型；原 `dragCreate`、`multiPointCreate`、`tool`、`text`、`regressionTests` 等测试继续运行。新增生产页面测试实际绘图与擦除历史。 |
| 框选 / 套索、移动、缩放对象、旋转、分组、复制、锁定 | 沿用原元素与选择实现；原 `selection`、`lasso`、`move`、`resize`、`rotate`、`elementLocking`、`duplicate` 等测试验证。新增浏览器复制、移动、删除检查。AI 通过现有动作管理器和元素 API 操作。 |
| 箭头绑定、折线、图形文字、文本换行与字体 | 原 `arrowBinding`、`binding`、`elbowArrow`、文本布局测试继续运行；没有改写这些实现。AI 文字仍为可编辑文本，公式为可擦除 SVG 图片对象。 |
| 撤销 / 重做 | 原 history 测试和新增浏览器检查验证。每块白板分别存内容，切换时清除当前撤销栈以防跨板撤销；重开白板不会恢复旧撤销栈。课件使用独立的每页板书历史。 |
| 无限画布、平移与缩放 | 原 `scroll`、`fitToContent` 测试继续运行；主白板缩放在浏览器中检查。课件另有底栏缩放，图像、原文和透明笔迹一起缩放。 |
| 图片、文件格式、导入与导出 | 原 `image`、`clipboard`、`export`、`restore` 测试继续运行；新增生产页面测试覆盖图片插入、包含图片的 `.excalidraw` 文件导出后重新打开，以及真实 PNG / SVG 文件内容。 |
| 主题、语言、画笔 / 对象属性、文件菜单 | 保留原菜单及属性组件，入口集中到底栏；已覆盖四种屏幕宽度、菜单和属性浮层。 |
| 离线与本地保存 | 保留 PWA，Office WASM 也加入离线缓存；多板额外保存图片和视图，持久化失败时保留原场景。浏览器存储被用户清除后无法恢复未导出的板书。 |
| 实时协作、云端只读分享 | 源码保留配置入口。协作需要 `VITE_APP_WS_SERVER_URL` 对应服务，分享也需要自己的后端；本轮没有对未配置的服务声称可用，尚未做多设备网络联调。 |
| 素材库 / 上游社交和商业入口 | 按用户明确要求隐藏原素材库并换为教学工具；移除非本品牌的社交 / 帮助 / 商业入口。第三方版权和原文件格式标识保留。 |

生产页面测试文件为 `e2e/classroom.spec.ts`、`e2e/courseware.spec.ts` 和 `e2e/whiteboard-regression.spec.ts`。完整打包、浏览器和安卓验证只在 Actions 中执行；最终状态以对应提交的 CI 为准，不以静态检查替代运行验证。

## tldraw 参考

阅读了 [tldraw README](https://github.com/tldraw/tldraw) 和官方 [`PagePanelExample.tsx`](https://github.com/tldraw/tldraw/blob/9bbecbe7973d0b6103adc441410662f04d2658e9/apps/examples/src/examples/ui/page-panel/PagePanelExample.tsx)。采用其“页面在外部管理、当前画布保持专注、缩略图按需导出、页面操作与内容更新保持一致”的交互组织方式。Fcdraw 的列表现在使用本仓库的 `exportToBlob` 生成真实缩略图，不把不同的手写白板都显示成相同的占位文字；绘图内核继续使用现有实现。

发现并修复了 `tunnel-rat` 扩展工具更新时重新追加、改变底栏位置的问题。新增只用于底栏的稳定注册通道，状态更新保持顺序和 DOM 身份；其他原有菜单通道不变。回归测试同时检查顺序与节点身份，避免快速操作点到相邻按钮。
