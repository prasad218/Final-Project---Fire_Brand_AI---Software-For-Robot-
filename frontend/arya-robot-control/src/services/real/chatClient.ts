// Real chat client — replaces services/mock/mockConversation's
// getMockResponse(). Talks to POST /api/chat on the AURA web backend
// (web_server.py -> chat_service.py), which handles the wake word
// ("Arya" / "hey Arya" -> "Yes, how can I help you today?"), canned
// answers (introduction, college info, campus locations, movement
// commands), and falls back to Gemini for everything else.

import { ENDPOINTS } from "../../config";

export type ChatSource =
  | "wake"
  | "intro"
  | "college"
  | "location"
  | "kannada_toggle"
  | "movement"
  | "gemini"
  | "unavailable"
  | "empty"
  | "offline";

export interface ChatReply {
  reply: string;
  userText: string;
  source: ChatSource;
  lang: "en" | "kn";
  movement: "forward" | "backward" | "left" | "right" | "stop" | null;
}

interface ChatApiResponse {
  reply: string;
  user_text: string;
  source: ChatSource;
  lang: "en" | "kn";
  movement: ChatReply["movement"];
}

/**
 * Sends `message` to ARYA's backend and returns her reply. Never
 * throws — on a network failure (backend not running yet, wrong URL,
 * etc.) it resolves with a friendly in-character error instead, so a
 * flaky/absent backend degrades gracefully rather than crashing the
 * conversation UI.
 */
export async function sendChatMessage(message: string, userName = ""): Promise<ChatReply> {
  try {
    const res = await fetch(ENDPOINTS.chat, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, user_name: userName }),
    });
    if (!res.ok) throw new Error(`chat endpoint returned ${res.status}`);
    const data = (await res.json()) as ChatApiResponse;
    return {
      reply: data.reply,
      userText: data.user_text,
      source: data.source,
      lang: data.lang,
      movement: data.movement,
    };
  } catch {
    return {
      reply:
        "I can't reach my AI backend right now — check that web_server.py is running and VITE_API_BASE_URL points at it.",
      userText: message,
      source: "offline",
      lang: "en",
      movement: null,
    };
  }
}
