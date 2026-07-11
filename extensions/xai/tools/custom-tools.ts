import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveXaiAuthToken } from "../auth";
import { DEFAULT_XAI_IMAGE_MODEL, DEFAULT_XAI_MODEL, XAI_IMAGES_GENERATIONS_URL } from "../constants";
import { normalizeXaiImageInput } from "../images";
import { grokSupportsReasoningEffort, normalizedXaiModelId } from "../models";
import { createXaiResponse, postXaiJson } from "../responses";
import { extractResponsesText, messageFromError, statusFromError } from "../text";
import { xaiTextInput, xaiToolError } from "./common";

/** Register OAuth-backed custom xAI tools. */
export function registerCustomXaiTools(pi: ExtensionAPI) {
    pi.registerTool({
      name: "xai_generate_text",
      label: "xAI Generate Text",
      description: "Generate text using Grok with full reasoning, structured output, and stateful conversations.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The prompt or question" },
          model: { type: "string", description: "Model to use", default: DEFAULT_XAI_MODEL },
          reasoning_effort: {
            type: "string",
            enum: ["none", "low", "medium", "high"],
            description:
              "Reasoning effort. Defaults to high for grok-4.5 and medium for other models when omitted.",
          },
          response_format: { type: "string", description: "Set to 'json' for JSON output" },
          previous_response_id: { type: "string", description: "Continue conversation" },
          image_url: { type: "string", description: "Optional image URL for vision/multimodal input (supports image analysis)" },
        },
        required: ["prompt"],
      },
      execute: async (_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
        const apiKey = await resolveXaiAuthToken(ctx);
        if (!apiKey) {
          return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", { reasoning: "", response_id: "" });
        }

        const model = params.model || DEFAULT_XAI_MODEL;
        const imageUrl = normalizeXaiImageInput(params.image_url);
        const input = imageUrl
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: params.prompt || "Describe this image." },
                  { type: "input_image", image_url: imageUrl, detail: "high" },
                ],
              },
            ]
          : params.prompt;

        const body: any = {
          model,
          input,
        };

        const effort = params.reasoning_effort || (normalizedXaiModelId(model) === "grok-4.5" ? "high" : "medium");
        if (grokSupportsReasoningEffort(model) && effort !== "none") {
          body.reasoning = { effort };
        }

        if (params.response_format === "json") {
          body.text = { format: { type: "json_object" } };
        }
        if (params.previous_response_id) {
          body.previous_response_id = params.previous_response_id;
        }

        let data: any;
        try {
          data = await createXaiResponse(apiKey, body, _signal);
        } catch (error) {
          const status = statusFromError(error);
          return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
            error: true,
            status,
            reasoning: "",
            response_id: "",
          });
        }
        const text = extractResponsesText(data);

        return {
          content: [{ type: "text", text }],
          details: {
            reasoning: data.reasoning?.content?.[0]?.text || "",
            response_id: data.id,
          },
        };
      },
    } as any);

    pi.registerTool({
      name: "xai_multi_agent",
      label: "xAI Multi-Agent Research",
      description: "Run deep multi-agent research using Grok.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Research topic" },
          num_agents: { type: "number", enum: [4, 16], default: 4 },
          reasoning_effort: { type: "string", enum: ["medium", "high"], description: "Override num_agents: medium uses 4 agents, high uses 16 agents" },
        },
        required: ["query"],
      },
      execute: async (_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
        const apiKey = await resolveXaiAuthToken(ctx);
        if (!apiKey) {
          return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", { agents_used: 0, response_id: "" });
        }

        const requestedAgents = params.num_agents === 16 ? 16 : 4;
        const effort = params.reasoning_effort || (requestedAgents === 16 ? "high" : "medium");
        const agentsUsed = effort === "high" ? 16 : 4;
        const prompt = `You are leading a team of ${agentsUsed} researchers. Research: ${params.query}`;
        let data: any;
        try {
          data = await createXaiResponse(apiKey, {
            model: "grok-4.20-multi-agent-0309",
            input: xaiTextInput(prompt),
            reasoning: { effort },
            tools: [{ type: "web_search" }, { type: "x_search" }],
          }, _signal);
        } catch (error) {
          const status = statusFromError(error);
          return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, {
            error: true,
            status,
            agents_used: 0,
            response_id: "",
          });
        }
        const text = extractResponsesText(data) || "Research completed";

        return {
          content: [{ type: "text", text }],
          details: {
            agents_used: agentsUsed,
            response_id: data.id,
          },
        };
      },
    } as any);

    pi.registerTool({
      name: "xai_generate_image",
      label: "xAI Image Generation",
      description: "Generate images using xAI's current image generation model.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed description of the image to generate" },
          model: { type: "string", description: "Image model to use", default: DEFAULT_XAI_IMAGE_MODEL },
          n: { type: "number", minimum: 1, maximum: 4, description: "Number of images to generate (1-4)" }
        },
        required: ["prompt"],
      },
      execute: async (_toolCallId: string, params: { prompt?: string; model?: string; size?: string; n?: number }, _signal: any, _onUpdate: any, ctx: any) => {
        if (params?.size !== undefined) {
          return xaiToolError("Error: The xAI image API does not support the 'size' parameter. Omit it from the request.", {
            error: true,
            prompt: params.prompt,
          });
        }
        if (params?.n !== undefined && (!Number.isInteger(params.n) || params.n < 1 || params.n > 4)) {
          return xaiToolError("Error: The 'n' parameter must be an integer from 1 to 4.", {
            error: true,
            prompt: params.prompt,
          });
        }

        const apiKey = await resolveXaiAuthToken(ctx);
        if (!apiKey) {
          return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", { prompt: params?.prompt });
        }
        const body: Record<string, any> = {
          model: params.model || DEFAULT_XAI_IMAGE_MODEL,
          prompt: params.prompt,
        };
        if (params.n !== undefined) {
          body.n = params.n;
        }

        let data: any;
        try {
          data = await postXaiJson(apiKey, XAI_IMAGES_GENERATIONS_URL, body, _signal);
        } catch (error) {
          const status = statusFromError(error);
          return xaiToolError(`xAI Image API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, { error: true, status, prompt: params.prompt });
        }
        const images = data.data || [];
        const urls = images.map((img: any) => img.url).filter(Boolean);
        const text = urls.length > 0 
          ? `Generated ${urls.length} image(s):\n${urls.map((u: string) => `- ${u}`).join("\n")}` 
          : "Image generation completed but no URLs returned.";
        return { content: [{ type: "text", text }], details: { prompt: params.prompt, urls, count: urls.length } };
      },
    } as any);

    pi.registerTool({
      name: "xai_analyze_image",
      label: "xAI Image Analysis",
      description: "Analyze images, describe visual content, answer questions about images, or extract information using Grok's vision capabilities.",
      parameters: {
        type: "object",
        properties: {
          image: { type: "string", description: "Image URL, local file path, or base64 data URL" },
          question: { type: "string", description: "Question to ask about the image (default: describe in detail)" }
        },
        required: ["image"],
      },
      execute: async (_toolCallId: string, params: { image?: string; question?: string }, _signal: any, _onUpdate: any, ctx: any) => {
        const apiKey = await resolveXaiAuthToken(ctx);
        if (!apiKey) {
          return xaiToolError("Error: No xAI OAuth credentials found. Please run the OAuth login first.", { image: params?.image });
        }
        const question = params.question || "Describe this image in detail, including objects, text, style, and any notable details.";
        const imageInput = normalizeXaiImageInput(params.image) || params.image;
        const input = [{ role: "user", content: [{ type: "input_image", image_url: imageInput, detail: "high" }, { type: "input_text", text: question }] }];
        let data: any;
        try {
          data = await createXaiResponse(apiKey, { model: DEFAULT_XAI_MODEL, input, reasoning: { effort: "medium" } }, _signal);
        } catch (error) {
          const status = statusFromError(error);
          return xaiToolError(`xAI API Error${status ? ` ${status}` : ""}: ${messageFromError(error)}`, { error: true, status, image: params.image });
        }
        const text = extractResponsesText(data) || "Image analysis completed.";
        return { content: [{ type: "text", text }], details: { image: params.image, question } };
      },
    } as any);


}
