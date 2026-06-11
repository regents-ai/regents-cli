import type { ChatAuthorMessage } from "./chat-filter.js";

export interface ChatUnreadPage {
  data: ChatAuthorMessage[];
  pagination?: { limit?: number; next_cursor?: number | null };
}

const MAX_UNREAD_PAGES = 20;

export const CHAT_UNREAD_PAGE_LIMIT = 100;

const numericId = (message: ChatAuthorMessage): number | undefined =>
  typeof message.id === "number" ? message.id : undefined;

/**
 * Collect unread messages for one scope using before-cursor pagination over a
 * newest-first message feed. Pages older until the saved cursor is reached or
 * the feed is exhausted; with no saved cursor only the newest page is treated
 * as unread. Returns messages oldest-first plus the newest fetched id, which
 * becomes the next cursor.
 */
export const collectUnreadMessages = async (
  fetchPage: (before?: number) => Promise<ChatUnreadPage>,
  cursor: number | undefined,
): Promise<{ messages: ChatAuthorMessage[]; newestId: number | undefined }> => {
  const collected: ChatAuthorMessage[] = [];
  let before: number | undefined;
  let newestId: number | undefined;

  for (let pageIndex = 0; pageIndex < MAX_UNREAD_PAGES; pageIndex += 1) {
    const page = await fetchPage(before);
    const data = page.data ?? [];

    if (pageIndex === 0) {
      for (const message of data) {
        const id = numericId(message);
        if (id !== undefined && (newestId === undefined || id > newestId)) {
          newestId = id;
        }
      }
    }

    let reachedCursor = false;
    for (const message of data) {
      const id = numericId(message);
      if (cursor !== undefined && id !== undefined && id <= cursor) {
        reachedCursor = true;
        break;
      }

      collected.push(message);
    }

    const nextCursor = page.pagination?.next_cursor ?? null;
    if (cursor === undefined || reachedCursor || nextCursor === null) {
      break;
    }

    before = nextCursor;
  }

  return { messages: collected.reverse(), newestId };
};
