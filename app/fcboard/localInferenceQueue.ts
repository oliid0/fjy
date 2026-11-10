type Resident = { dispose: () => void };
type Slot = {
  key: string;
  resident: Resident;
  busy: boolean;
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
const slots: Slot[] = [];
const requests: Request[] = [];
let sequence = 0;

const drain = () => {
  while (requests.length) {
    const request = requests[0];
    if (!request.current()) {
      requests.shift();
      request.resolve();
      continue;
    }
    const available = slots.filter((slot) => !slot.busy);
    let slot = available.find((slot) => slot.key === request.key);
    if (!slot && slots.length < 2) {
      try {
        slot = {
          key: request.key,
          resident: request.create(),
          busy: false,
          used: 0,
        };
        slots.push(slot);
      } catch (error) {
        requests.shift();
        request.reject(error);
        continue;
      }
    }
    if (!slot && available.length) {
      slot = available.sort((a, b) => a.used - b.used)[0];
      slot.resident.dispose();
      try {
        slot.resident = request.create();
        slot.key = request.key;
      } catch (error) {
        slots.splice(slots.indexOf(slot), 1);
        requests.shift();
        request.reject(error);
        continue;
      }
    }
    if (!slot) {
      return;
    }
    requests.shift();
    slot.busy = true;
    slot.used = ++sequence;
    const active = slot;
    void Promise.resolve()
      .then(() => request.run(active.resident))
      .then(request.resolve, (error) => {
        active.resident.dispose();
        slots.splice(slots.indexOf(active), 1);
        request.reject(error);
      })
      .finally(() => {
        active.busy = false;
        drain();
      });
  }
};

/** Two independent WASM heaps can make progress together. Keep an idle model
 * ready until another model needs its slot; never evict an active caller. */
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
