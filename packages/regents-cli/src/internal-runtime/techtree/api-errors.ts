import { TechtreeApiError } from "../errors.js";
import { messageWithRetryAfter } from "../rate-limit-message.js";

const parseMaybeJson = (input: string): unknown => {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
};

export async function parseTechtreeErrorResponse(res: Response): Promise<TechtreeApiError> {
  const contentType = res.headers.get("content-type") ?? "";
  const rawBody = await res.text();
  const parsedBody =
    contentType.includes("application/json") || rawBody.trim().startsWith("{")
      ? parseMaybeJson(rawBody)
      : rawBody;

  if (
    parsedBody &&
    typeof parsedBody === "object" &&
    "error" in parsedBody &&
    parsedBody.error &&
    typeof parsedBody.error === "object"
  ) {
    const payload = parsedBody.error as {
      code?: string;
      message?: string;
      details?: unknown;
    };

    const message = messageWithRetryAfter(
      res.status,
      res.headers,
      payload.message ?? `Techtree request failed with status ${res.status}`,
    );

    return new TechtreeApiError(message, {
      code: payload.code ?? "techtree_api_error",
      status: res.status,
      payload: parsedBody,
    });
  }

  return new TechtreeApiError(messageWithRetryAfter(
    res.status,
    res.headers,
    `Techtree request failed with status ${res.status}`,
  ), {
    status: res.status,
    payload: parsedBody,
  });
}
