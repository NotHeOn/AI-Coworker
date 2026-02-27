// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Allow side panel for all URLs
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Notify side panel when the user switches tabs — wait until the tab is fully loaded
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (tab.status === "complete") {
      chrome.runtime.sendMessage({ type: "TAB_CHANGED" }).catch(() => {});
    } else {
      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.runtime.sendMessage({ type: "TAB_CHANGED" }).catch(() => {});
        }
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
    }
  });
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTENT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ error: "No active tab found." });
        return;
      }
      if (tab.status !== "complete") {
        sendResponse({ error: "Page is still loading." });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_CONTENT" }, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // Keep channel open for async response
  }

  if (message.type === "ANALYZE") {
    handleAnalyze(message, sender.tab);
    return false;
  }
});

async function handleAnalyze({ instruction, pageContent, conversationHistory }, tab) {
  // Retrieve active profile from storage
  const { profiles, activeProfileId } = await chrome.storage.local.get(["profiles", "activeProfileId"]);
  const profile = profiles?.find(p => p.id === activeProfileId);

  if (!profile) {
    chrome.runtime.sendMessage({
      type: "STREAM_ERROR",
      error: "No profile configured. Please open Settings to add a model profile."
    });
    return;
  }

  const { baseUrl, modelName, apiKey } = profile;
  const isAnthropic = baseUrl.includes("anthropic.com");

  // Build system prompt
  const systemPrompt = `You are a helpful AI coworker embedded in a Chrome extension. \
The user is currently viewing a web page. You have access to the page content and will help analyze, summarize, or answer questions about it based on the user's instructions. \
Be concise and helpful. Format your responses using markdown when appropriate.`;

  // Build messages from conversation history
  const messages = [...conversationHistory];

  // Append the current user message with page content context
  const userContent = pageContent
    ? `Here is the current page content:\n\n---\n${pageContent}\n---\n\nMy instruction: ${instruction}`
    : instruction;

  messages.push({ role: "user", content: userContent });

  try {
    let response;

    if (isAnthropic) {
      // Anthropic format
      response = await fetch(`${baseUrl}/messages`, {
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
        })
      });
    } else {
      // OpenAI-compatible format
      const openAiMessages = [
        { role: "system", content: systemPrompt },
        ...messages
      ];
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: openAiMessages,
          stream: true
        })
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      const errMsg = errBody?.error?.message || `HTTP ${response.status}`;
      chrome.runtime.sendMessage({ type: "STREAM_ERROR", error: errMsg });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            let chunk = null;

            if (isAnthropic) {
              // Anthropic SSE: content_block_delta.text_delta
              if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                chunk = parsed.delta.text;
              }
            } else {
              // OpenAI SSE: choices[0].delta.content
              chunk = parsed.choices?.[0]?.delta?.content ?? null;
            }

            if (chunk) {
              fullText += chunk;
              chrome.runtime.sendMessage({ type: "STREAM_CHUNK", chunk });
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    }

    chrome.runtime.sendMessage({ type: "STREAM_DONE", fullText });
  } catch (err) {
    chrome.runtime.sendMessage({ type: "STREAM_ERROR", error: err.message });
  }
}
