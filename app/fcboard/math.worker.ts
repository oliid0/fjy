import { calculateLocal } from "./mathCalculation";

self.onmessage = (event: MessageEvent<{ expression: string }>) => {
  try {
    self.postMessage({ answer: calculateLocal(event.data.expression) });
  } catch (failure) {
    self.postMessage({
      error: failure instanceof Error ? failure.message : String(failure),
    });
  }
};
