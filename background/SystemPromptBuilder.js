export class SystemPromptBuilder {
  /**
   * Build the system prompt.
   * @param {boolean} hasPageContent - whether page content is available
   */
  build(hasPageContent) {
    let prompt = "You are a helpful AI coworker embedded in a Chrome extension. ";

    if (hasPageContent) {
      prompt += "The user is currently viewing a web page. You have access to the page content and will help analyze, summarize, or answer questions about it based on the user's instructions. ";
      prompt += "\n\nThe page content includes paragraph anchors in the format [§tag-N] (e.g. [§p-3], [§h2-1], [§li-5]). ";
      prompt += "When referencing a specific part of the page in your response, include the anchor tag exactly as it appears (e.g. [§p-3]) so the user can click to jump to that section. ";
      prompt += "Only cite anchors that genuinely appear in the provided content. Do not invent anchor IDs. ";
    } else {
      prompt += "The user does not have a readable web page loaded, or the page content could not be extracted. Answer based on your general knowledge. ";
    }

    prompt += "Be concise and helpful. Format your responses using markdown when appropriate.";
    return prompt;
  }
}
