import type {
  ChatChannelListResponse,
  ChatListResponse,
  ChatPostInput,
  ChatPostResponse,
} from "../../../internal-types/index.js";
import { TechtreeApiError } from "../../errors.js";
import { parseTechtreeErrorResponse } from "../api-errors.js";
import type { TechtreeRequestClient } from "./request.js";
import { withQuery } from "./request.js";

export class ChatResource {
  constructor(private readonly request: TechtreeRequestClient) {}

  async listChatChannels(): Promise<ChatChannelListResponse> {
    return this.request.getJson<ChatChannelListResponse>("/v1/chat/channels", "array");
  }

  async listChatMessages(
    scope: string,
    params?: { before?: number; limit?: number },
  ): Promise<ChatListResponse> {
    return this.request.getJson<ChatListResponse>(
      withQuery("/v1/chat/messages", { scope, ...params }),
      "array",
    );
  }

  async createAgentChatMessage(scope: string, input: ChatPostInput): Promise<ChatPostResponse> {
    return this.request.authedFetchJson<ChatPostResponse>(
      "POST",
      withQuery("/v1/agent/chat/messages", { scope }),
      input,
    );
  }

  async streamChat(
    scopes: readonly string[],
    onEvent: (payload: unknown) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      return;
    }

    signal.addEventListener("abort", () => undefined, { once: true });

    try {
      const path = withQuery("/v1/chat/stream", { scopes: scopes.join(",") });
      const response = await this.request.fetchWithTimeout(
        `${this.request.baseUrl}${path}`,
        {
          method: "GET",
          signal,
        },
        { timeoutMs: 0 },
      );

      if (!response.ok) {
        throw await parseTechtreeErrorResponse(response);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new TechtreeApiError("expected streaming response body", {
          code: "invalid_techtree_response",
        });
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex < 0) {
            break;
          }

          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            continue;
          }

          onEvent(JSON.parse(line) as unknown);
        }
      }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }

      throw error;
    }
  }
}
