# fcboard

React 白板组件，包含当前工程的画笔、擦除、圈选、图形、文本、图片、表格与交互网页底层能力。AI、语音、课件管理和云分享的应用逻辑由宿主 app 提供。

```sh
npm install fcboard react react-dom
# 或 pnpm add fcboard react react-dom
```

```tsx
import { Fcboard } from "fcboard";
import type { FcboardImperativeAPI } from "fcboard";
import "fcboard/index.css";

export default function Board() {
  const onReady = (api: FcboardImperativeAPI) => {
    api.setActiveTool({ type: "freedraw" });
  };
  return (
    <div style={{ width: "100%", height: "100dvh" }}>
      <Fcboard
        UIOptions={{ unifiedToolbar: true, library: false }}
        onFcboardAPI={onReady}
      />
    </div>
  );
}
```

组件填满父容器，请给父容器有效的高度。使用 React 18.2 或 React 19，以及支持 ESM 和 CSS 导入的构建器。根入口同时导出场景转换、序列化、图片 / SVG 导出、菜单和 API Provider 等现有接口。

类型可从 `fcboard/types` 导入；元素、数学及通用工具分别从 `fcboard/element`、`fcboard/math`、`fcboard/common`、`fcboard/utils` 导入。应用的细分编辑器模块位于 `fcboard/editor/*`，例如 `fcboard/editor/i18n`、`fcboard/editor/whiteboardPen`。这些路径都指向已编译的 JS 和声明文件，不依赖仓库路径别名或本地 packages 源码。

字体与图片由构建器根据包内 URL 打包；字体加载保留当前发布版本的 CDN 回退。离线部署可将 `node_modules/fcboard/dist/prod` 下的字体及其他静态资源按原目录结构复制到自己的静态目录，在加载白板前设置资源基址：

```html
<script>
  window.EXCALIDRAW_ASSET_PATH = "/sdk/";
</script>
```

本工程 fc 工作区的 app 构建会从安装的 fcboard 包复制相应资源；main 直接使用本地源码与字体插件。变量名保留兼容现有 API。WASM、图标和字体均随 npm 产物分发。

发布目录由 `npm run build:packages` 生成到 `packages/fcboard/dist/npm`。该目录只包含 `dist` 编译产物、package.json、README 和 LICENSE；不发布 TypeScript 实现、SCSS、测试、源码映射、环境文件或应用 / Android 源码。

本项目基于 Excalidraw，保留其 MIT 许可与版权信息，见随包 LICENSE。
