export type Task<T> = () => Promise<T> | T;

export const serialMap = new Map<string, Promise<void>>();

export const serialCount = new Map();

interface PromiseObject<T> extends Promise<T> {
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

export function makePromiseObject<T>(): PromiseObject<T> {
  let resolve!: Parameters<ConstructorParameters<typeof Promise<T>>[0]>[0];
  let reject!: Parameters<ConstructorParameters<typeof Promise<T>>[0]>[1];
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return Object.create({
    ...promise,
    reject,
    resolve,
  });
}

export function serialized<T>(key: string, task: () => Promise<T> | T) {
  const prevProcess = serialMap.get(key);
  const promise = makePromiseObject<T>();
  serialCount.set(key, serialCount.get(key) ?? 0 + 1);

  const next = async () => {
    try {
      promise.resolve(await task());
    } catch (err) {
      promise.reject(err);
    } finally {
      const count = serialCount.get(key) - 1;
      if (count === 0) {
        serialMap.delete(key);
        serialCount.delete(key);
      } else {
        serialCount.set(key, count);
      }
    }
  };

  if (prevProcess) {
    const nextProcess = prevProcess.then(() => next());
    serialMap.set(key, nextProcess);
  } else {
    serialMap.set(key, next());
  }
  return promise;
}
