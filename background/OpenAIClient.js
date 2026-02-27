import { parseSSE } from "./sseParser.js";

export class OpenAIClient {
  constructor(profile) {
    this.profile = profile;
  }

  /**
   * Async generator: yields text chunks from OpenAI-compatible streaming API.
   * @param {string} systemPrompt
   * @param {{ role: string, content: string }[]} messages
   * @param {AbortSignal} [signal]
   */
  async *stream(systemPrompt, messages, signal) {
    const { baseUrl, modelName, apiKey } = this.profile;
    const openAiMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: openAiMessages,
        stream: true
      }),
      signal
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || `HTTP ${response.status}`);
    }

    yield* parseSSE(response.body, (parsed) => {
      return parsed.choices?.[0]?.delta?.content ?? null;
    }, signal);
  }
}
