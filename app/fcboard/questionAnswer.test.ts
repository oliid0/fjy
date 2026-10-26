import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { updateQuestionAnswer } from "./questionAnswer";
import { sceneAPI } from "./test/scene";

it("folds only the answer, persists its geometry with the question and restores edited objects", async () => {
  const api = sceneAPI();
  const question = api.getSceneElements()[0];
  const [answer, unrelated] = convertToExcalidrawElements([
    { type: "text", x: 100, y: 140, text: "answer" },
    { type: "rectangle", x: 700, y: 100, width: 50, height: 50 },
  ]);
  api.updateScene({ elements: [question, answer, unrelated] });
  await updateQuestionAnswer(api, question.id, [answer.id]);
  api.updateScene({
    elements: api
      .getSceneElements()
      .map((item) => (item.id === answer.id ? { ...item, x: 120 } : item)),
  });
  expect(await updateQuestionAnswer(api, question.id)).toEqual({
    collapsed: true,
    count: 1,
  });
  expect(api.getSceneElements().map((item) => item.id)).toEqual([
    question.id,
    unrelated.id,
  ]);
  const serialized = JSON.stringify(api.getSceneElements());
  api.updateScene({ elements: JSON.parse(serialized) });
  expect(await updateQuestionAnswer(api, question.id)).toEqual({
    collapsed: false,
    count: 1,
  });
  expect(
    api.getSceneElements().find((item) => item.id === answer.id),
  ).toMatchObject({ x: 120 });
  expect(
    api.getSceneElements().find((item) => item.id === unrelated.id),
  ).toEqual(unrelated);
});

it("does not restore deleted pieces or resurrect a removed question", async () => {
  const api = sceneAPI();
  const question = api.getSceneElements()[0];
  const answers = convertToExcalidrawElements([
    { type: "text", x: 100, y: 140, text: "first" },
    { type: "text", x: 100, y: 180, text: "second" },
  ]);
  api.updateScene({ elements: [question, ...answers] });
  await updateQuestionAnswer(
    api,
    question.id,
    answers.map((item) => item.id),
  );
  api.updateScene({
    elements: api
      .getSceneElements()
      .filter((item) => item.id !== answers[0].id),
  });
  await updateQuestionAnswer(api, question.id);
  await updateQuestionAnswer(api, question.id);
  expect(api.getSceneElements().some((item) => item.id === answers[0].id)).toBe(
    false,
  );
  await updateQuestionAnswer(api, question.id);
  api.updateScene({ elements: [] });
  await expect(updateQuestionAnswer(api, question.id)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(api.getSceneElements()).toHaveLength(0);
});

it("does not let a copied question hide another question's answer", async () => {
  const api = sceneAPI();
  const question = api.getSceneElements()[0];
  const [answer] = convertToExcalidrawElements([
    { type: "text", x: 10, y: 80, text: "answer" },
  ]);
  api.updateScene({ elements: [question, answer] });
  await updateQuestionAnswer(api, question.id, [answer.id]);
  const copy = { ...api.getSceneElements()[0], id: "copied-question" };
  api.updateScene({ elements: [...api.getSceneElements(), copy] });
  await expect(updateQuestionAnswer(api, copy.id)).rejects.toThrow();
  expect(api.getSceneElements().some((item) => item.id === answer.id)).toBe(
    true,
  );
});
