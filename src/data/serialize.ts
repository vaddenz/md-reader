/** 读-改-写串行化：并发写场景下后一次总能读到前一次的结果（原 prefs.ts 内实现，v1.1 抽出共用）。 */
let queue: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}
