/**
 * A source review is advisory: failure to resolve one upstream must leave that
 * skill local, never leave the whole library review waiting forever.
 */
export async function withReviewTimeout<T>(task: Promise<T>, source: string, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out while reviewing ${source}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
