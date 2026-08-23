// Conversation + Greeting Manager types.
// The greeting queue logic described here is UI/state-only for now;
// a real perception pipeline will drive it later via the event system.

export type ConversationRole = "USER" | "ARYA";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  text: string;
  timestamp: string;
}

export type VoiceUIState = "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING";

export type GreetingQueueStatus = "WAITING" | "IN_PROGRESS" | "COMPLETED" | "LEFT";

export interface GreetingQueueEntry {
  id: string;
  personName: string;
  status: GreetingQueueStatus;
  queuedAt: number;
}

export type GreetingManagerState = "READY" | "CHECKING_PRESENCE" | "GREETING";
