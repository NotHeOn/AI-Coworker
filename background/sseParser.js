/**
 * Async generator that reads an SSE response body and yields extracted chunks.
 * @param {ReadableStream} body
 * @param {(parsed: object) => string|null} extractFn
 * @param {AbortSignal} [signal]  — optional; stops iteration when aborted
 */
export async function* parseSSE(body, extractFn, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const chunk = extractFn(parsed);
          if (chunk) yield chunk;
        } catch {
          // Ignore malformed JSON lines
        }
      }
    }
  } finally {
    // Always release the reader lock (abort or normal completion)
    reader.cancel().catch(() => {});
  }
}
