/** Read the selected image directly; style comes from the user and image model. */
export const selectionImagePrompt = (mode: "creative" | "magic") =>
  mode === "magic"
    ? "根据输入的手写要求和草图创作。理解草图的主体，不要逐笔复制草稿线条；未指定画风时默认精致、富有想象力的立体3D风格，用户指定的风格优先。主体完整，直接生成带真实Alpha透明通道的PNG，适合放入白板；不画纸张、画板界面或假透明棋盘格。只返回最终图片。"
    : "参考输入图像和手写要求进行自由创作。有明确要求时遵循用户意图；其余内容、构图、风格和细节由你发挥，充分发挥创造力。说明文字和白板操作界面不属于画面内容。直接返回完整创作图片。";
