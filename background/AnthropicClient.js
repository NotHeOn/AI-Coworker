import { parseSSE } from "./sseParser.js";

export class AnthropicClient {
  constructor(profile) {
    this.profile = profile;
  }

  /**
   * Async generator: yields text chunks from Anthropic streaming API.
   * @param {string} systemPrompt
   * @param {{ role: string, content: string }[]} messages
   * @param {AbortSignal} [signal]
   */
  async *stream(systemPrompt, messages, signal) {
    const { baseUrl, modelName, apiKey } = this.profile;
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `HTTP ${response.status}`);
    }

    yield* parseSSE(response.body, (parsed) => {
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
        return parsed.delta.text;
      }
      return null;
    }, signal);
  }
}
