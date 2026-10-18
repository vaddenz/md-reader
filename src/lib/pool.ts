export async function runPool<T>(
  items: T[], limit: number,
  worker: (item: T, index: number) => Promise<void>,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
