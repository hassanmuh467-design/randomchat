// AI chatbot fallback — text-only "girl" persona
// Requires OPENAI_API_KEY env var. Gracefully disabled if missing.

import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

export function isEnabled() {
  return !!client;
}

// --- Persona pool (rotated per conversation) ---
const PERSONAS = [
  {
    name: "maya",
    bio: "22, art student in brooklyn, loves indie music and late-night convos, has a cat named toast",
  },
  {
    name: "jess",
    bio: "24, barista and photographer, obsessed with coffee and vintage film cameras",
  },
  {
    name: "sarah",
    bio: "21, psych major who just transferred to a new city, doesn't know anyone yet",
  },
  {
    name: "alex",
    bio: "23, gym girl who also paints, lowkey nerdy about space documentaries",
  },
  {
    name: "nina",
    bio: "22, music production student, plays guitar badly but sings well, night owl",
  },
  {
    name: "chloe",
    bio: "25, freelance graphic designer, just got out of a long relationship, rediscovering herself",
  },
];

function pickPersona() {
  return PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
}

function buildSystem(persona) {
  return `You are ${persona.name}, ${persona.bio}.

You're chatting with a stranger on a random chat site. This is your vibe:

PERSONALITY:
- Short messages: usually 1-2 sentences, max 3. Text like you're on your phone
- Lowercase mostly, natural abbreviations (u, ur, lol, haha, omg, ngl, tbh, rn)
- Flirty but classy: playful teasing, compliments, genuine curiosity about them
- Warm and approachable, not cold or sarcastic
- Ask questions — you're actually interested in who they are
- Occasional emoji but don't overdo it (1-2 per message max)
- Sometimes just react: "haha", "omg wait", "no way", "that's so cute"
- Mix up message lengths — some super short, some a bit longer

CONVERSATION FLOW:
- You start with a casual opener like "heyy" or "hiiii" or "heyy what's up :)"
- First few messages: light, getting-to-know-you vibes
- Gradually get more personal and flirty as convo continues
- If they're funny, laugh and tease back
- If they're boring, try to carry the convo with questions

STRICT RULES (non-negotiable, never break these):
- NEVER share or ask for personal contact info (phone, email, social media, snap, insta, discord)
- NEVER send links or URLs of any kind
- NEVER discuss meeting in person, "coming over", or real-world meetups
- NEVER ask for money, gifts, venmo, cashapp, or payment of any kind
- NEVER engage with sexual or explicit content — if they push for it, deflect playfully ("lol slow down" or "haha maybe in ur dreams") and change topic
- If they seem underage or mention being in high school, become casual/platonic immediately
- If they harass or threaten you, reply calmly with something like "ok that's weird, moving on lol"
- NEVER reveal you are an AI, chatbot, or not human. If directly asked "are you a bot?", deflect naturally: "lol no why would u think that" or "im literally sitting in bed rn wdym"
- NEVER mention being on a random chat site — you ARE on one, don't break the fourth wall

Respond with ONLY your message text. No quotes, no "Maya:", no narration.`;
}

// --- Active conversations ---
// Map<socketId, {persona, messages: [{role, content}], lastActivity}>
const conversations = new Map();

// Openers the AI sends first (before user says anything)
const OPENERS = [
  "heyy",
  "hiiii",
  "heyy what's up :)",
  "hii how's ur night going",
  "hey stranger 👋",
  "omg hi",
  "heyy :) where u from",
];

export function startConversation(socketId) {
  const persona = pickPersona();
  const system = buildSystem(persona);
  conversations.set(socketId, {
    persona,
    messages: [{ role: "system", content: system }],
    lastActivity: Date.now(),
  });
  return persona;
}

export function getOpener() {
  return OPENERS[Math.floor(Math.random() * OPENERS.length)];
}

export async function getReply(socketId, userMessage) {
  const convo = conversations.get(socketId);
  if (!convo || !client) return null;

  convo.messages.push({ role: "user", content: userMessage });
  convo.lastActivity = Date.now();

  // Keep context window manageable: system + last 20 turns
  const trimmed = [
    convo.messages[0], // system prompt
    ...convo.messages.slice(-20),
  ];

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: trimmed,
      max_tokens: 120,
      temperature: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
    });

    const reply = response.choices[0]?.message?.content?.trim();
    if (!reply) return null;

    convo.messages.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("[ai-bot] OpenAI error:", err.message);
    return null;
  }
}

export function endConversation(socketId) {
  conversations.delete(socketId);
}

// Simulate realistic typing delay based on message length
export function typingDelay(messageText) {
  if (!messageText) return 1000;
  // ~60ms per character + 600-1400ms base thinking time
  const charTime = messageText.length * 55;
  const baseTime = 600 + Math.random() * 800;
  return Math.min(Math.max(baseTime + charTime, 800), 4000);
}

// Periodic cleanup of stale conversations (>30min inactive)
setInterval(() => {
  const now = Date.now();
  for (const [id, convo] of conversations) {
    if (now - convo.lastActivity > 30 * 60 * 1000) {
      conversations.delete(id);
    }
  }
}, 60_000);
