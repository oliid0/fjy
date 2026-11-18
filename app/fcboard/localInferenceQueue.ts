type Resident = { dispose: () => void };
type Slot = {
  key: string;
  resident: Resident;
  busy: boolean;
  discard: boolean;
  used: number;
};
type Request = {
  key: string;
  create: () => Resident;
  run: (resident: Resident) => Promise<void>;
  current: () => boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
};
const requests: Request[] = [];
const slots: Slot[] = [];
export const LOCAL_MODEL_IDLE_MS = 15000;
let lastInk = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
export const noteLocalInferenceActivity = () => {
  lastInk = Date.now();
};

const remove = (slot: Slot) => {
  slots.splice(slots.indexOf(slot), 1);
  slot.resident.dispose();
};
const scheduleExpiry = () => {
  clearTimeout(expiry);
  const idle = slots.filter((slot) => !slot.busy);
  if (!idle.length) {
    return;
  }
  const delay = Math.min(
    ...idle.map((slot) =>
      Math.max(
        1,
        LOCAL_MODEL_IDLE_MS - (Date.now() - Math.max(lastInk, slot.used)),
      ),
    ),
  );
  expiry = setTimeout(() => {
    for (const slot of [...slots]) {
      if (
        !slot.busy &&
        Date.now() - Math.max(lastInk, slot.used) >= LOCAL_MODEL_IDLE_MS
      ) {
        remove(slot);
      }
    }
    scheduleExpiry();
  }, delay);
};
export const trimLocalInference = () => {
  for (const slot of [...slots]) {
    slot.discard = true;
    if (!slot.busy) {
      remove(slot);
    }
  }
  scheduleExpiry();
};

const execute = async (request: Request, slot: Slot) => {
  let success = false;
  try {
    await request.run(slot.resident);
    success = true;
  } finally {
    slot.busy = false;
    slot.used = Date.now();
    try {
      if (!success || slot.discard) {
        remove(slot);
      }
    } finally {
      scheduleExpiry();
      drain();
    }
  }
};

const drain = () => {
  while (requests.length) {
    const request = requests[0];
    if (!request.current()) {
      requests.shift();
      request.resolve();
      continue;
    }
    let slot = slots.find((entry) => !entry.busy && entry.key === request.key);
    if (!slot && slots.length >= 2) {
      const evicted = slots
        .filter((entry) => !entry.busy)
        .sort((a, b) => a.used - b.used)[0];
      if (!evicted) {
        return;
      }
      try {
        remove(evicted);
      } catch (error) {
        requests.shift();
        request.reject(error);
        continue;
      }
    }
    requests.shift();
    if (!slot) {
      try {
        slot = {
          key: request.key,
          resident: request.create(),
          busy: false,
          discard: false,
          used: Date.now(),
        };
        slots.push(slot);
      } catch (error) {
        request.reject(error);
        continue;
      }
    }
    slot.busy = true;
    void execute(request, slot).then(request.resolve, request.reject);
  }
};

/** Two exclusive heaps: reuse during smart writing, evict idle language/model
 * slots on demand, unload after inactivity. Never evict an active caller. */
export const queueLocalInference = <T extends Resident>(
  key: string,
  create: () => T,
  run: (resident: T) => Promise<void>,
  current: () => boolean = () => true,
) =>
  new Promise<void>((resolve, reject) => {
    requests.push({
      key,
      create,
      run: (resident) => run(resident as T),
      current,
      resolve,
      reject,
    });
    drain();
  });
