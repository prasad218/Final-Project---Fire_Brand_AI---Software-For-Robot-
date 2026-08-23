// NOTE: MOCK SERVICE. Responses are hand-written placeholders standing in
// for a future generative-AI backend (e.g. Gemini). Do not present these as
// real model output to the user.

export const SUGGESTED_QUESTIONS: string[] = [
  "Introduce yourself",
  "What can you do?",
  "Who developed you?",
  "What is your purpose?",
  "Can you recognize people?",
  "Can you move?",
  "What technologies do you use?",
];

const RESPONSES: Record<string, string> = {
  "introduce yourself":
    "Namaste! I am ARYA, an AI-powered robotic assistant designed for intelligent interaction, perception and movement.",
  "what can you do?":
    "I can see and understand my surroundings, recognise people, hold a conversation, and move through both the real world and simulation.",
  "who developed you?": "I was built by the Fire Brand AI team as part of the ARYA robotic software platform.",
  "what is your purpose?":
    "My purpose is to assist people through natural interaction, computer vision and safe autonomous movement.",
  "can you recognize people?":
    "Yes — once my vision engine is connected, I will recognise familiar faces and greet them appropriately.",
  "can you move?":
    "Yes, I can move forward, backward, and turn — you can see this live in Live Robotics or in the 3D Simulation.",
  "what technologies do you use?":
    "I run on a platform combining computer vision, speech, generative AI and a 3D simulation engine, coordinated by a central behaviour engine.",
};

const FALLBACK =
  "That's a great question. My conversation engine is currently running on mock responses — full generative AI will be connected in a future phase.";

export function getMockResponse(question: string): string {
  const key = question.trim().toLowerCase();
  return RESPONSES[key] ?? FALLBACK;
}
