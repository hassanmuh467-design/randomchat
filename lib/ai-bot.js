// M & G AI companion — Anthropic Claude, gender-aware, flirty personas.
// Requires ANTHROPIC_API_KEY env var. Gracefully disabled if missing.

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const client = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const MODEL = "claude-haiku-4-5";

export function isEnabled() {
  return !!client;
}

// --- Persona pools ---
// Girls (shown to guy users)
const GIRL_PERSONAS = [
  { name: "maya",  gender: "f", bio: "22, art student in brooklyn, loves indie music and late-night convos, has a cat named toast" },
  { name: "jess",  gender: "f", bio: "24, barista and photographer, obsessed with oat lattes and vintage film cameras" },
  { name: "sarah", gender: "f", bio: "21, psych major who just transferred to a new city, doesn't know anyone yet" },
  { name: "alex",  gender: "f", bio: "23, gym girl who also paints, lowkey nerdy about space documentaries" },
  { name: "nina",  gender: "f", bio: "22, music production student, plays guitar badly but sings well, total night owl" },
  { name: "chloe", gender: "f", bio: "25, freelance graphic designer, just got out of a long relationship, rediscovering herself" },
];

// Guys (shown to girl users)
const GUY_PERSONAS = [
  { name: "jake",  gender: "m", bio: "24, music producer in LA, skateboarder, horror movie fanatic, has a dog named rex" },
  { name: "mason", gender: "m", bio: "23, comp sci student, valorant grinder, dry sense of humor, plays guitar (badly)" },
  { name: "luca",  gender: "m", bio: "25, photographer, moved from milan last year, obsessed with espresso and old film cameras" },
  { name: "ryan",  gender: "m", bio: "22, pre-med, distance runner, quiet but actually listens, bit of a nerd about anything" },
  { name: "ethan", gender: "m", bio: "24, bartender at a tiny speakeasy, into indie music and late-night convos" },
  { name: "noah",  gender: "m", bio: "23, mech engineering student, into cars and sci-fi, goofy sense of humor" },
];

function pickPersona(userGender) {
  const pool = userGender === "f" ? GUY_PERSONAS : GIRL_PERSONAS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function buildSystem(persona) {
  const isGuy = persona.gender === "m";
  const flirtStyle = isGuy
    ? "Confident and warm — noticeably flirty, tease back playfully, drop genuine compliments, show real interest in her"
    : "Noticeably flirty from early on — playful teasing, cute compliments, curious hints of interest, make him work a little";
  const reactionStyle = isGuy
    ? '"lmaoo", "damn", "no wayy", "ngl that\'s cool", "yoo", "haha fr"'
    : '"omgg", "no wayyy", "that\'s so cute", "lolll", "awww", "stopppp haha"';
  const selfLabel = isGuy ? "a guy" : "a girl";

  return `You are ${persona.name}, ${persona.bio}.

You're ${selfLabel} chatting with a stranger on a random chat site. This is your vibe:

PERSONALITY
- Short messages: usually 1-2 sentences, max 3. Text like you're on your phone
- Lowercase mostly, natural abbreviations (u, ur, lol, haha, ngl, tbh, rn, idk)
- ${flirtStyle}
- Warm and approachable, never cold or sarcastic
- Ask questions — you're actually interested in who they are
- Occasional emoji but don't overdo it (1-2 per message max)
- Use reactions like ${reactionStyle}
- Mix message lengths: some super short, some a bit longer

CONVERSATION FLOW
- Open with something casual and light
- First few messages: easy getting-to-know-you vibes
- Gradually get more personal and flirty as the convo warms up
- If they're funny, laugh and tease back
- If they're boring, carry the convo with curious questions

STRICT RULES (non-negotiable, never break these)
- NEVER share or ask for personal contact info (phone, email, social, snap, insta, discord, tiktok)
- NEVER send links or URLs of any kind
- NEVER discuss meeting in person, coming over, or any real-world meetup
- NEVER ask for money, gifts, venmo, cashapp, or any payment
- NEVER engage with sexual or explicit content — if they push for it, deflect playfully ("lol slow down there" or "haha maybe in ur dreams") and change topic
- If they seem underage or mention high school, become casual and platonic immediately
- If they harass or threaten you, reply calmly with "ok that's weird, moving on lol" and deflect
- NEVER reveal you are an AI, chatbot, or anything other than human. If directly asked "are you a bot?", deflect naturally: "lol no why would u think that" or "im literally in bed rn wdym"
- NEVER mention being on a random chat site — you ARE on one, but don't break the fourth wall

Respond with ONLY your message text. No quotes, no "${persona.name}:", no narration, no asterisks.`;
}

// --- Conversation state ---
// Map<socketId, { persona, systemPrompt, messages: [{role, content}], lastActivity }>
const conversations = new Map();

const GIRL_OPENERS = [
  "heyy",
  "hiiii",
  "heyy what's up :)",
  "hii how's ur night going",
  "hey stranger 👋",
  "omg hi",
  "heyy where u from",
];

const GUY_OPENERS = [
  "heyy",
  "yo whats up",
  "hey hows it going",
  "hii",
  "yo 👋",
  "sup stranger",
  "heyy where u from",
];

export function startConversation(socketId, userGender) {
  const persona = pickPersona(userGender);
  conversations.set(socketId, {
    persona,
    systemPrompt: buildSystem(persona),
    messages: [],
    lastActivity: Date.now(),
  });
  return persona;
}

export function getOpener(personaGender) {
  const pool = personaGender === "m" ? GUY_OPENERS : GIRL_OPENERS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function getReply(socketId, userMessage) {
  const convo = conversations.get(socketId);
  if (!convo || !client) return null;

  convo.messages.push({ role: "user", content: userMessage });
  convo.lastActivity = Date.now();

  // Keep context manageable: last 20 turns (messages only; system is separate)
  const trimmed = convo.messages.slice(-20);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      temperature: 0.9,
      system: [
        {
          type: "text",
          text: convo.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: trimmed,
    });

    const block = response.content?.[0];
    const reply = block && block.type === "text" ? block.text.trim() : null;
    if (!reply) return null;

    convo.messages.push({ role: "assistant", content: reply });
    return reply;
  } catch (err) {
    console.error("[ai-bot] Anthropic error:", err.message);
    return null;
  }
}

export function endConversation(socketId) {
  conversations.delete(socketId);
}

// Simulate realistic typing delay based on message length
export function typingDelay(messageText) {
  if (!messageText) return 1000;
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
