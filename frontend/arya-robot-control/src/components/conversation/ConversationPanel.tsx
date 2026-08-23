import { useState } from "react";
import { Send, Bot, User, Loader2 } from "lucide-react";
import type { ConversationMessage } from "../../types/conversation";
import { SUGGESTED_QUESTIONS } from "../../services/mock/mockConversation";
import { Panel } from "../common/Panel";
import styles from "./ConversationPanel.module.css";

interface ConversationPanelProps {
  messages: ConversationMessage[];
  /** True while a reply is in flight from the backend (see TalkWithArya.tsx). */
  pending?: boolean;
  onSend: (userText: string) => void;
}

// SUGGESTED_QUESTIONS is still borrowed from services/mock/mockConversation
// — it's just a static list of example prompts shown as chips. It no
// longer produces the reply itself: getMockResponse is gone, actual
// replies now come from the backend's /api/chat (wake word / canned
// answers / Gemini — see TalkWithArya.tsx and the backend's
// chat_service.py).
export function ConversationPanel({ messages, pending = false, onSend }: ConversationPanelProps) {
  const [draft, setDraft] = useState("");

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <Panel title="Conversation" icon={<Bot size={14} />} accent="purple" className={styles.panel}>
      <div className={styles.history}>
        {messages.length === 0 && <p className={styles.empty}>Ask ARYA anything to get started.</p>}
        {messages.map((m) => (
          <div key={m.id} className={[styles.bubbleRow, m.role === "USER" ? styles.right : styles.left].join(" ")}>
            <span className={styles.avatar}>{m.role === "USER" ? <User size={13} /> : <Bot size={13} />}</span>
            <div className={styles.bubble}>{m.text}</div>
          </div>
        ))}
        {pending && (
          <div className={[styles.bubbleRow, styles.left].join(" ")}>
            <span className={styles.avatar}>
              <Bot size={13} />
            </span>
            <div className={[styles.bubble, styles.thinking].join(" ")}>
              <Loader2 size={13} className={styles.spin} /> Thinking…
            </div>
          </div>
        )}
      </div>

      <div className={styles.suggestions}>
        {SUGGESTED_QUESTIONS.map((q) => (
          <button key={q} className={styles.chip} onClick={() => submit(q)} disabled={pending}>
            {q}
          </button>
        ))}
      </div>

      <form
        className={styles.inputRow}
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message to ARYA…"
          aria-label="Message ARYA"
          disabled={pending}
        />
        <button type="submit" className={styles.sendBtn} aria-label="Send message" disabled={pending}>
          <Send size={16} />
        </button>
      </form>
    </Panel>
  );
}
