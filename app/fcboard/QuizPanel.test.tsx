import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { QuizPanel } from "./QuizPanel";
import { render } from "./test/render";
import { classroomCommands } from "./commands";
import * as quiz from "./quiz";

afterEach(() => vi.restoreAllMocks());

it("opens from the tool route, generates a paper, accepts an answer and reveals its explanation", async () => {
  vi.spyOn(quiz, "generateQuiz").mockResolvedValue({
    title: "高一数学",
    questions: [
      {
        id: "q1",
        type: "single",
        prompt: "x=2时x²等于多少？",
        options: ["2", "4", "8"],
        answer: ["4"],
        explanation: "将2代入得到2×2=4。",
      },
    ],
    sources: [{ title: "资料", url: "https://example.com/course" }],
  });
  const view = render(<QuizPanel />);
  try {
    await act(async () => {
      await classroomCommands.execute({ name: "quiz.open" });
    });
    fireEvent.change(screen.getByRole("textbox", { name: "出题要求" }), {
      target: { value: "出1道高一数学选择题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "联网出题" }));
    await waitFor(() =>
      expect(screen.getByText("x=2时x²等于多少？")).toBeVisible(),
    );
    expect(screen.queryByText("将2代入得到2×2=4。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "B. 4" }));
    fireEvent.click(screen.getByRole("button", { name: "交卷 / 显示答案" }));
    expect(screen.getByText("回答正确")).toBeVisible();
    expect(screen.getByText("将2代入得到2×2=4。")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新作答" }));
    expect(screen.getByRole("radio", { name: "B. 4" })).not.toBeChecked();
  } finally {
    view.unmount();
  }
});
