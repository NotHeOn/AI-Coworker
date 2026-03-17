import { AnthropicClient } from "./AnthropicClient.js";
import { OpenAIClient } from "./OpenAIClient.js";

export class ModelClientFactory {
  /**
   * @param {{ provider: { type: string, baseUrl: string, apiKey: string }, modelId: string }} param
   */
  static create({ provider, modelId }) {
    // Normalise to the flat shape the clients expect
    const profile = {
      baseUrl:   provider.baseUrl,
      apiKey:    provider.apiKey,
      modelName: modelId,
    };
    if (provider.type === "anthropic") {
      return new AnthropicClient(profile);
    }
    return new OpenAIClient(profile);
  }
}
