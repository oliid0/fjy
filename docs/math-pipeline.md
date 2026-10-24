# 手写数学：识别、校验、本地求值与绘图

## 已实现的链路

画笔菜单包含函数笔和算式笔。停笔 700ms 后处理本批笔迹，普通笔不自动计算。先读取原始轨迹；原生识别可用时不截图、不上传图片。新笔画、擦除、切工具、换板和取消使未完成请求失效。识别或解析失败保留原笔迹，自动笔不弹警告。结果作为普通可编辑对象进入现有撤销与擦除链路，不打开聊天页，也不切换正在使用的画笔。

`mathNotation.ts` 将明确的 LaTeX / 数学记号转换为本地引擎语法。`mathRecognition.ts` 优先本地解析；配置模型后，复杂记号可通过纯文本请求规范化。AI 只能返回带版本、原文、表达式和关系符号的 JSON。原文、数字顺序、二维 / 三维类型、关系符号和属性清单必须匹配，表达式还要经过 AST、参数、定义域及实数采样校验。拒绝图片、坐标点、代码、答案字段和未知属性。该校验可以防止格式错误及部分改题，不能证明模型理解了任意手写公式；没有可靠结构的输入仍应保留笔迹。

函数的坐标、坐标轴、刻度、曲线、三维投影和不等式阴影全部本地生成。图像保存表达式和参数，选中原图可继续调参。区间运算检查分母零点、正切极点、对数和根号定义域；连接线与阴影都在不连续处断开，避免把跨越渐近线的线段当作函数。曲线是有限采样近似，不宣称对任意高频或隐式函数精确绘图。坐标系、标签和曲线整体等比缩放并避让现有对象，范围受当前屏幕和工具栏限制；课件使用当前可见批注区域。

符号求值与方程求解通过独立模块 Worker 执行，6 秒未完成或源内容取消即终止线程；输入识别意图只做语法检查，不在主线程试算。数字四则和受限矩阵计算保持本地直接执行。实际测试发现 Nerdamer 的部分绝对值极限会持续占用 CPU，当前拒绝这类未支持的非光滑极限，不让自动算式笔冻结白板。没有 Worker 的环境不退回主线程运行符号引擎。

## 能力与边界

| 类别 | 当前行为 |
| --- | --- |
| 加减乘除、幂、开方、模、阶乘、绝对值 | 支持 `^` / `**`、平方 / 立方、`sqrt` / `nthRoot`、`%`、`!`、绝对值竖线及对应常见 TeX。变量表达式不会被填入任意默认值计算。 |
| 小数、分数、复数 | 数值计算独立使用 mathjs BigNumber 64 位精度，显示最多 32 位有效数字；支持嵌套 `\frac`、`sqrt(-1)`。无限小数和超越数仍是有限精度近似。绘图另用数值引擎，不改变坐标类型。 |
| 三角、反三角、对数、指数 | 支持正 / 反三角、`sin^{-1}`、`ln`、以 2 / 10 为底的对数、`e^x` / `2^x`；非实数域不画曲线。 |
| 导数、积分、极限 | 复用已安装 Nerdamer 1.1.13；不定积分检查导数并附 `C`。定积分先检查整个闭区间的实数连续性，跨奇点或无法确认定义域时拒绝输出有限数值，不冒充支持所有广义积分。 |
| 有限求和、连乘 | 支持明确索引及数值上下界；限制输入复杂度和循环范围。未求出的符号结果不作为答案写入。任意含参数的无穷级数尚未实现。 |
| 方程、方程组 | 自动解一元一次 / 二次及最多三元的确定线性方程组，检查解的数量并逐项回代。欠定、矛盾、不能回代的近似解及可能漏解的超越方程不自动写答案。高次方程和完整解集仍待补齐。 |
| 不等式 | 显式 `y > / >= / < / <= f(x)` 支持阴影，严格关系用虚线边界，非严格关系用实线；三维不等式、一般隐式关系和多条件交集尚未实现。 |
| 矩阵 / 向量 | 支持明确行列的加法、乘法、行列式、逆、转置、迹、点积和叉积；TeX matrix / bmatrix / pmatrix 可解析。不会仅凭空格猜测行列。 |
| 竖式 | 支持每个后续操作数明确带运算符的多行竖式；不把两个独立数字、长除法草稿或不明确的横线猜成运算。 |
| 本地失败后的 AI | AI 可规范化原文为 JSON 表达式，最终仍需本地求值 / 绘图。没有独立校验能力的 AI 数值答案不自动插入。 |

公式的空间识别仍是主要缺口：原厂 Digital Ink 中英文模型不是完整二维数学 LaTeX 解码器，不能据此宣称任意手写矩阵、分数、上下标均已准确识别。当前 Web 的 OCR 也不等同原厂轨迹模型。课件圈选和显式函数 / 算式笔已接入同一识别与本地绘图链路。

## GitHub MCP 代码核对

读取代码后的结论及采用范围：

| 固定源码 | 核对结果 |
| --- | --- |
| [mathplot graph1.cpp](https://github.com/sebsjames/mathplot/blob/c6a96b1c9fe96e60b087aabc435dd81c222555b4/examples/graph1.cpp) | C++ / OpenGL 使用数值样本生成曲线，不是识别模型；沿用“表达式 → 本地采样 → 图形”的结构，不引入桌面编译依赖。 |
| [LaTeX-OCR cli.py](https://github.com/lukas-blecher/LaTeX-OCR/blob/5c1ac929bd19a7ecf86d5fb8d94771c8969fcb80/pix2tex/cli.py) | PyTorch 图像公式 OCR，README 的手写支持仍有限；没有把它当作已部署的轨迹模型或函数绘图器。 |
| [AI-Math-Notes main.py](https://github.com/ayushpai/AI-Math-Notes/blob/e70a1f5429746719859db0c5197f60595dea3688/main.py)、[MathNotesAI main.py](https://github.com/parthbhangla/MathNotesAI/blob/bdda27ce6161f8bf39d1e7d597a676caf8a7cf6b/main.py) | 使用 GPT-4o 图片输入及固定大字号 / 末笔坐标；未复制其布局和直接信任答案的做法。 |
| [Hand-Written-Equation-Solver predict.py](https://github.com/Sgvkamalakar/Hand-Written-Equation-Solver/blob/ebe18d14b5c7a41cee8b11d7531b8beb13b8a85d/predict.py) | 有限字符 CNN、轮廓按 x 排序及 Python eval，不能覆盖二维数学结构；未采用 eval。 |
| [Xournal++ LatexGenerator.cpp](https://github.com/xournalpp/xournalpp/blob/9de67fa0dc6d6d856e12e2ee85d5f38fd7950f56/src/core/control/latex/LatexGenerator.cpp) | 通过外部 TeX 进程生成公式，是排版而非手写识别 / 求值模块；Fcboard 已有 MathJax，继续复用。 |
| [mathjs 15.2.0 polynomialRoot](https://github.com/josdejong/mathjs/blob/fee4561840043a7473962367bbae6f15bbb3cebb/src/function/algebra/polynomialRoot.js)、本机 Nerdamer 1.1.13 的 spec / types | 明确区分有限次多项式求根和完整数学解集；没有套用上游 Nerdamer 2.0 的不兼容 API。 |
| [interval-arithmetic 1.1.3](https://github.com/mauriciopoppe/interval-arithmetic/tree/1e83f5c49dd57e210b235ff5374aabf69ef9033c/src) | 复用向外舍入的区间四则、幂、根号、三角和对数运算，AST 适配层拒绝无界 / 未知子表达式；用于防止奇点跨线及错误定积分。 |

输入 AST 白名单遵循 [mathjs 安全文档](https://mathjs.org/docs/expressions/security.html)，数值类型依照 [BigNumber 文档](https://mathjs.org/docs/datatypes/bignumbers.html)。模型返回 JSON 不赋予它执行脚本或修改解析器的能力。

课件自动笔也复用 `inkRecognition.ts` 的轨迹优先识别与数学校验：文字原位替换，算式在右侧写结果，函数交给同一本地采样器。页码、源轨迹或笔型变化使旧请求失效；不修改被课件遮挡的白板。复杂二维手写到 LaTeX 与真机识别准确率仍未验收。
