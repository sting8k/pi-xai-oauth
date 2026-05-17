/**
 * Payload sanitization for xAI Responses API.
 * 
 * Centralizes all xAI-specific fixes so they run via the
 * before_provider_request hook (making them visible and chainable).
 */

import type { Model } from "@earendil-works/pi-ai";

export function sanitizeXaiPayload(payload: unknown, model: Model<any>): unknown {
  if (!payload || typeof payload !== "object") return payload;

  const body = { ...(payload as Record<string, any>) };

  // 1. Remove reasoning.encrypted_content (xAI doesn't support it)
  if (Array.isArray(body.include)) {
    body.include = body.include.filter((item: string) => item !== "reasoning.encrypted_content");
    if (body.include.length === 0) delete body.include;
  }

  // 2. Remove prompt_cache_retention (not supported by xAI)
  delete body.prompt_cache_retention;

  // 3. Clean up image-bearing tool outputs that cause 422 errors
  if (Array.isArray(body.input)) {
    body.input = normalizeXaiInput(body.input, model);
  }

  return body;
}

function normalizeXaiInput(input: unknown[], model: Model<any>): unknown[] {
  // Reuse the existing image normalization logic if possible.
  // For now we keep a minimal safe version here.
  return input.map((item: any) => {
    if (
      item &&
      typeof item === "object" &&
      item.type === "function_call_output" &&
      Array.isArray(item.output)
    ) {
      // Convert image parts in tool output to text + separate user message
      const hasImages = item.output.some((p: any) => p?.type === "input_image");
      if (hasImages) {
        return {
          ...item,
          output: item.output
            .filter((p: any) => p?.type !== "input_image")
            .map((p: any) => (p?.type === "input_text" ? p.text : p))
            .join("\n") || "(tool returned no text output)",
        };
      }
    }
    return item;
  });
}
