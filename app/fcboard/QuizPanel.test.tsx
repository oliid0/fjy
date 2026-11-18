import { useState } from "react";
import { act, fireEvent, waitFor } from "@testing-library/react";

import { QuizPanel } from "./QuizPanel";
import { render } from "./test/render";

import type { Quiz } from "./quiz";

it("keeps the same sandbox document during progressive updates and accepts retry only from its current child/channel", async () => {
  const initial: Quiz = {
    id: "quiz-1",
    title: "Progressive quiz",
    plannedCount: 2,
    generating: true,
    questions: [],
    sources: [],
  };
  const props = {
    busy: true,
    error: "",
    onClose: vi.fn(),
    onRetryImage: vi.fn(),
  };
  let change!: (quiz: Quiz) => void;
  const Host = () => {
    const [quiz, setQuiz] = useState(initial);
    change = setQuiz;
    return <QuizPanel {...props} quiz={quiz} />;
  };
  const view = render(<Host />);
  const frame = view.getByTitle(initial.title) as HTMLIFrameElement;
  const document = frame.getAttribute("srcdoc");
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  fireEvent.load(frame);
  const channel = post.mock.calls.at(-1)![0].channel;
  const question = {
    id: "q1",
    type: "short" as const,
    question: "First completed",
    answer: ["Answer"],
    explanation: "Reason",
  };
  act(() => change({ ...initial, questions: [question] }));
  await waitFor(() =>
    expect(
      post.mock.calls.some(
        ([payload]) =>
          payload.cards[0]?.includes("First completed") &&
          payload.cards[1] === null,
      ),
    ).toBe(true),
  );
  expect(view.getByTitle(initial.title)).toBe(frame);
  expect(frame.getAttribute("srcdoc")).toBe(document);
  const send = (source: Window, token: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: { type: "quiz-retry-image", channel: token, id: "q1" },
      }),
    );
  send(window, channel);
  send(frame.contentWindow!, "wrong");
  expect(props.onRetryImage).not.toHaveBeenCalled();
  send(frame.contentWindow!, channel);
  expect(props.onRetryImage).toHaveBeenCalledExactlyOnceWith("q1");
});
