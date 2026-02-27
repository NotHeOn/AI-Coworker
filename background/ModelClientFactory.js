import { AnthropicClient } from "./AnthropicClient.js";
import { OpenAIClient } from "./OpenAIClient.js";

export class ModelClientFactory {
  /** Returns the appropriate client based on the profile's baseUrl */
  static create(profile) {
    if (profile.baseUrl.includes("anthropic.com")) {
      return new AnthropicClient(profile);
    }
    return new OpenAIClient(profile);
  }
}
