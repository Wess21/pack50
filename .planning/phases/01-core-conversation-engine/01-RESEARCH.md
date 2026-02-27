# Phase 1: Core Conversation Engine - Research

**Researched:** 2026-02-27
**Domain:** Telegram Bot Development + Conversational AI State Management
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational architecture for a Telegram-based conversational AI bot that maintains stateful, multi-turn dialogues. The core challenge is managing conversation state across Telegram's stateless API while enabling proactive, goal-oriented interactions. The recommended approach uses **grammY framework** (modern TypeScript bot framework) with its **conversations plugin** for multi-turn flows, **Redis-backed sessions** for state persistence across restarts, **Claude Sonnet 4.5 API** for intelligent response generation, and **PostgreSQL** for conversation history and user data storage.

The critical architectural insight: Telegram bots are inherently stateless (each update is independent), so external state management is non-negotiable for multi-turn conversations. Redis provides the low-latency, TTL-enabled session store required for production, while grammY's conversation plugin handles the complex replay mechanism that makes sequential dialogue feel natural despite the stateless protocol underneath.

Key technical decisions validated by research: (1) grammY's conversations plugin uses a replay-based execution model that requires understanding to avoid bugs, (2) Redis TTL automatically expires inactive sessions with no cleanup code needed, (3) Claude API's 200K token context window easily accommodates conversation history + system prompts, (4) webhook + secret token validation is production-standard for security.

**Primary recommendation:** Build conversation engine using grammY conversations plugin + Redis session store + Claude API from day one. Do not start with in-memory sessions or plan to "add persistence later" - the architecture patterns are fundamentally different and will require rewrites.

## Phase Requirements

This phase MUST address the following requirements from REQUIREMENTS.md:

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| BOT-01 | Bot receives messages via Telegram Bot API | grammY framework with webhook/long polling (Standard Stack) |
| BOT-02 | Bot sends text responses to Telegram | grammY ctx.reply() API (Code Examples) |
| BOT-03 | Bot works via webhook (prod) or long polling (dev) | Telegram Bot API supports both modes (Standard Stack) |
| BOT-04 | Bot validates webhook requests via secret token | setWebhook secret_token + X-Telegram-Bot-Api-Secret-Token header (Architecture Patterns) |
| BOT-05 | Bot handles commands (/start, /help, /cancel) | grammY command() and hears() middleware (Architecture Patterns) |
| BOT-06 | Bot supports inline keyboards for quick replies | grammY InlineKeyboard builder API (Code Examples) |
| CONV-01 | Bot remembers conversation context per user | Redis session storage via grammY session plugin (Standard Stack) |
| CONV-02 | Sessions persist in Redis (survive restart) | Redis-backed session adapters with automatic write-back (Architecture Patterns) |
| CONV-03 | Bot conducts multi-turn dialogues (5+ messages) | grammY conversations plugin with replay mechanism (Standard Stack) |
| CONV-04 | Bot asks clarifying questions | Slot-filling patterns + conversation.waitFor() API (Architecture Patterns) |
| CONV-05 | Bot proactively guides users to solution | Proactive slot filling + goal-oriented prompt engineering (Architecture Patterns) |
| CONV-06 | Bot summarizes long dialogues for context management | Hierarchical summarization + sliding window patterns (Common Pitfalls) |
| CONV-07 | Inactive sessions auto-expire (TTL 24 hours) | Redis TTL with passive + active expiration (Standard Stack) |
| DATA-01 | Bot extracts name, email, phone from messages | Regex-based NER patterns + LLM extraction (Don't Hand-Roll) |
| DATA-02 | Bot saves dialogue history to database | PostgreSQL conversation_messages schema (Architecture Patterns) |
| DATA-03 | Bot creates structured requests from data | Slot-filling state machines + data validation (Architecture Patterns) |
| DATA-04 | Bot confirms collected info before submission | Confirmation step in conversation flow with inline keyboard (Code Examples) |

</phase_requirements>

## Standard Stack

### Core Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| grammY | 1.x (latest) | Telegram bot framework | Modern TypeScript-first with built-in conversation flows, superior type safety, active 2026 development. Better than Telegraf for conversation plugin architecture. |
| @grammyjs/conversations | latest | Multi-turn dialogue flows | Official plugin with replay-based execution model, handles sequential conversations despite stateless Telegram API. |
| @grammyjs/storage-redis | latest | Redis session adapter | Official storage adapter, auto-connects with grammY session plugin, handles serialization. |
| @grammyjs/menu | latest | Interactive inline menus | High-level menu abstraction over raw InlineKeyboard, better for complex decision trees. |
| ioredis | 5.x | Redis client | Industry standard Node.js Redis client, cluster support, promise-based, robust error handling. |
| pg | 8.x | PostgreSQL client | Official PostgreSQL driver, connection pooling, prepared statements, widely adopted. |
| @anthropic-ai/sdk | latest | Claude API integration | Official Anthropic SDK for Claude API, handles streaming, context management, errors. |
| express | 4.x | HTTP server for webhooks | Minimal web framework for webhook endpoint, middleware ecosystem, production-proven. |
| zod | 3.x | Runtime type validation | Schema validation for user input, env variables, API responses. TypeScript-first design. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| dotenv | latest | Environment variable management | Loading .env files in dev/production for secrets |
| winston | 3.x | Structured logging | Production logging with levels, transports, JSON formatting |
| helmet | latest | Express security headers | Webhook endpoint security hardening |
| express-rate-limit | latest | Rate limiting middleware | Protect webhook endpoint from abuse |
| node-cron | latest | Scheduled tasks | Periodic session cleanup monitoring, analytics aggregation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| grammY | Telegraf | Telegraf more mature but TypeScript support weaker, conversation flows less elegant. grammY chosen for better DX. |
| Redis | In-memory sessions | In-memory loses data on restart. Only acceptable for dev/testing, never production. |
| @anthropic-ai/sdk | Direct HTTP calls | Raw HTTP works but SDK handles streaming, retries, context management. SDK reduces boilerplate. |
| grammY conversations | Custom state machine | Custom state machines work but require ~500 LOC for replay mechanism, error handling, storage. Plugin proven and tested. |
| PostgreSQL | MongoDB | MongoDB simpler for unstructured data but project needs ACID for user data, relational for reporting. PostgreSQL chosen for data integrity. |

**Installation:**

```bash
npm install grammy @grammyjs/conversations @grammyjs/storage-redis @grammyjs/menu ioredis pg @anthropic-ai/sdk express zod dotenv winston helmet express-rate-limit node-cron

# Dev dependencies
npm install -D @types/node @types/express typescript tsx nodemon
```

## Architecture Patterns

### Recommended Project Structure

```
src/
├── bot/                    # Telegram bot layer
│   ├── index.ts           # Bot initialization, middleware setup
│   ├── commands.ts        # Command handlers (/start, /help, /cancel)
│   ├── conversations/     # Conversation flows
│   │   ├── lead-collection.ts  # Main lead collection flow
│   │   └── helpers.ts     # Shared conversation utilities
│   ├── keyboards.ts       # Inline keyboard definitions
│   └── middleware/        # Custom middleware
│       ├── error-handler.ts
│       ├── logger.ts
│       └── session.ts
├── api/                   # Business logic layer
│   ├── services/
│   │   ├── claude.ts      # Claude API integration
│   │   ├── conversation.ts # Conversation orchestration
│   │   └── data-extraction.ts # NER and slot filling
│   └── repositories/      # Database access
│       ├── users.ts
│       └── conversations.ts
├── db/                    # Database layer
│   ├── client.ts          # PostgreSQL connection pool
│   ├── migrations/        # SQL migration files
│   └── schema.sql         # Database schema
├── config/                # Configuration
│   ├── env.ts             # Environment validation (Zod)
│   └── redis.ts           # Redis client setup
├── types/                 # TypeScript type definitions
│   ├── session.ts         # Session data structure
│   └── context.ts         # Extended grammY context
├── utils/                 # Utilities
│   ├── logger.ts          # Winston logger setup
│   └── validators.ts      # Input validation helpers
└── index.ts               # Application entry point
```

### Pattern 1: Conversation Flow with Slot Filling

**What:** Multi-turn dialogue that collects structured data (name, email, phone) by asking questions sequentially, validating responses, and allowing corrections.

**When to use:** Any goal-oriented conversation where you need to gather specific information from the user.

**Example:**

```typescript
// Source: https://grammy.dev/plugins/conversations
import { createConversation, Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../types/context";

async function leadCollectionFlow(
  conversation: Conversation<MyContext>,
  ctx: MyContext
) {
  // Welcome + ask for name
  await ctx.reply("Hi! I'm here to help. What's your name?");

  // Wait for text response
  const nameCtx = await conversation.waitFor("message:text");
  const name = nameCtx.message.text;

  // Validate and store in session
  await conversation.external(() => {
    ctx.session.leadData = { ...ctx.session.leadData, name };
  });

  // Ask for email with validation loop
  let email: string | undefined;
  while (!email) {
    await ctx.reply("Great! What's your email address?");
    const emailCtx = await conversation.waitFor("message:text");
    const input = emailCtx.message.text;

    // Validate email format
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
      email = input;
    } else {
      await ctx.reply("That doesn't look like a valid email. Please try again.");
    }
  }

  await conversation.external(() => {
    ctx.session.leadData = { ...ctx.session.leadData, email };
  });

  // Ask for phone
  await ctx.reply("Perfect! Last question - what's your phone number?");
  const phoneCtx = await conversation.waitFor("message:text");
  const phone = phoneCtx.message.text;

  await conversation.external(() => {
    ctx.session.leadData = { ...ctx.session.leadData, phone };
  });

  // Confirmation with inline keyboard
  const keyboard = new InlineKeyboard()
    .text("✓ Confirm", "confirm_lead")
    .text("✗ Edit", "edit_lead");

  await ctx.reply(
    `Please confirm your information:\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}`,
    { reply_markup: keyboard }
  );

  // Wait for button press
  const confirmCtx = await conversation.waitFor("callback_query:data");
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === "confirm_lead") {
    // Save to database
    await conversation.external(async () => {
      await saveLeadToDatabase(ctx.session.leadData);
    });
    await ctx.reply("Thank you! Your information has been saved.");
  } else {
    await ctx.reply("No problem! Use /start to begin again.");
  }
}

// Register conversation
bot.use(createConversation(leadCollectionFlow));

// Entry point
bot.command("start", async (ctx) => {
  await ctx.conversation.enter("leadCollectionFlow");
});
```

**Key principles:**
- Use `conversation.waitFor()` to pause execution until specific update arrives
- Wrap session writes in `conversation.external()` to prevent replay issues
- Implement validation loops for data quality
- Use inline keyboards for confirmations (better UX than text)
- Handle cancellation with command handlers

### Pattern 2: Redis Session Storage with TTL

**What:** Persistent session storage that survives bot restarts, with automatic expiration for inactive conversations.

**When to use:** Always in production. Required for multi-instance deployments and restart resilience.

**Example:**

```typescript
// Source: https://grammy.dev/plugins/session
import { session } from "grammy";
import { RedisAdapter } from "@grammyjs/storage-redis";
import { Redis } from "ioredis";

// Redis client setup
const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD,
  db: 0,
});

// Session adapter with TTL
const storage = new RedisAdapter({ instance: redis });

// Enhanced storage with TTL (24 hours)
import { enhanceStorage } from "grammy";

const enhancedStorage = enhanceStorage({
  storage,
  millisecondsToLive: 24 * 60 * 60 * 1000, // 24 hours
});

// Session middleware
bot.use(
  session({
    initial: (): SessionData => ({
      leadData: {},
      conversationState: "idle",
      messageHistory: [],
    }),
    storage: enhancedStorage,
    // Session key: each chat gets own session
    getSessionKey: (ctx) => ctx.chat?.id.toString(),
  })
);
```

**Key principles:**
- Use RedisAdapter for production, not in-memory storage
- Set TTL via enhanceStorage (Redis handles expiration automatically)
- Session keys should be chat-specific (ctx.chat.id)
- Define TypeScript interface for session data structure
- Initial function must create new objects (prevent cross-chat contamination)

### Pattern 3: Webhook with Secret Token Validation

**What:** Production-grade webhook endpoint that validates requests are from Telegram using secret token.

**When to use:** Production deployment. Long polling acceptable for dev/testing only.

**Example:**

```typescript
// Source: https://core.telegram.org/bots/api
import express from "express";
import { webhookCallback } from "grammy";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
});
app.use("/webhook", limiter);

// Secret token validation middleware
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET!;

app.use("/webhook", (req, res, next) => {
  const token = req.header("X-Telegram-Bot-Api-Secret-Token");

  if (token !== WEBHOOK_SECRET) {
    console.error("Invalid webhook secret token");
    return res.status(403).send("Forbidden");
  }

  next();
});

// Webhook endpoint
app.post("/webhook", webhookCallback(bot, "express"));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);

  // Set webhook
  const webhookUrl = `${process.env.WEBHOOK_URL}/webhook`;
  await bot.api.setWebhook(webhookUrl, {
    secret_token: WEBHOOK_SECRET,
    drop_pending_updates: true, // Discard old updates on restart
  });

  console.log(`Webhook set to ${webhookUrl}`);
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
```

**Key principles:**
- Always validate X-Telegram-Bot-Api-Secret-Token header
- Generate random secret token (256 chars, alphanumeric + underscore/hyphen)
- Use helmet for security headers
- Implement rate limiting to prevent abuse
- Set drop_pending_updates: true on webhook setup (avoid stale updates)
- Handle graceful shutdown (SIGINT/SIGTERM)

### Pattern 4: Claude API Integration for Conversation

**What:** Using Claude API to generate contextual responses based on conversation history and user intent.

**When to use:** For natural language responses, proactive questioning, and intent understanding.

**Example:**

```typescript
// Source: https://platform.claude.com/docs/en/api/messages
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface Message {
  role: "user" | "assistant";
  content: string;
}

async function generateResponse(
  conversationHistory: Message[],
  systemPrompt: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4.5-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: conversationHistory,
    });

    return response.content[0].type === "text"
      ? response.content[0].text
      : "";
  } catch (error) {
    console.error("Claude API error:", error);
    throw new Error("Failed to generate response");
  }
}

// System prompt for proactive lead collection
const SYSTEM_PROMPT = `You are a helpful business assistant collecting customer information for a consultation request.

Your goal: Gather name, email, and phone number through natural conversation.

Behavior:
- Ask clarifying questions when information is vague
- Validate data format (email, phone) and politely request corrections
- Be concise (2-3 sentences per response)
- Guide conversation toward completing the lead form
- Acknowledge user corrections gracefully

Current conversation state will be provided in the message history.`;

// Usage in conversation flow
async function aiAssistedConversation(
  conversation: Conversation<MyContext>,
  ctx: MyContext
) {
  const history: Message[] = ctx.session.messageHistory || [];

  while (!isLeadComplete(ctx.session.leadData)) {
    // Generate next question using Claude
    const aiResponse = await conversation.external(() =>
      generateResponse(history, SYSTEM_PROMPT)
    );

    await ctx.reply(aiResponse);
    history.push({ role: "assistant", content: aiResponse });

    // Wait for user response
    const userCtx = await conversation.waitFor("message:text");
    const userMessage = userCtx.message.text;
    history.push({ role: "user", content: userMessage });

    // Extract data from user message
    const extractedData = await conversation.external(() =>
      extractDataFromMessage(userMessage, ctx.session.leadData)
    );

    // Update session
    await conversation.external(() => {
      ctx.session.leadData = { ...ctx.session.leadData, ...extractedData };
      ctx.session.messageHistory = history.slice(-10); // Keep last 10 messages
    });
  }

  // Confirmation...
}

function isLeadComplete(leadData: any): boolean {
  return Boolean(leadData.name && leadData.email && leadData.phone);
}
```

**Key principles:**
- System prompt defines bot personality and goals
- Conversation history sent as messages array with role + content
- Keep history limited (last 5-10 turns) to avoid context window bloat
- Handle API errors gracefully (fallback to predefined questions)
- Store history in session for continuity across updates

### Pattern 5: PostgreSQL Conversation History Schema

**What:** Database schema for storing users, conversations, and messages with proper relationships and indexing.

**When to use:** Always. Required for conversation persistence, analytics, and compliance.

**Example:**

```sql
-- Source: https://medium.com/@levi_stringer/building-stateful-conversations-with-postgres-and-llms-e6bb2a5ff73e

-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  username VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- Conversations table
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  status VARCHAR(50) DEFAULT 'active', -- active, completed, abandoned
  lead_data JSONB, -- Store extracted lead data
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_conversations_status ON conversations(status);

-- Messages table
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- user, assistant, system
  content TEXT NOT NULL,
  metadata JSONB, -- Store message_id, edit history, etc.
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Extracted leads table (structured data)
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  additional_info JSONB,
  confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_leads_email ON leads(email);
CREATE INDEX idx_leads_conversation_id ON leads(conversation_id);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Key principles:**
- One user can have many conversations (one-to-many)
- One conversation can have many messages (one-to-many)
- Use JSONB for flexible metadata storage (message edits, context)
- Index foreign keys for fast joins
- Add updated_at triggers for audit trail
- Store lead_data as JSONB in conversations (flexibility)
- Separate leads table for structured, queryable data

### Pattern 6: Inline Keyboard for Confirmations

**What:** Using inline keyboards to provide quick-reply buttons for confirmations, choices, and navigation.

**When to use:** Confirmations, binary choices, option selection (better UX than text parsing).

**Example:**

```typescript
// Source: https://grammy.dev/plugins/keyboard
import { InlineKeyboard } from "grammy";

// Simple confirmation keyboard
const confirmKeyboard = new InlineKeyboard()
  .text("✓ Confirm", "confirm")
  .text("✗ Cancel", "cancel");

await ctx.reply("Is this information correct?", {
  reply_markup: confirmKeyboard,
});

// Multi-option keyboard with rows
const optionsKeyboard = new InlineKeyboard()
  .text("Option 1", "opt_1").text("Option 2", "opt_2").row()
  .text("Option 3", "opt_3").text("Option 4", "opt_4").row()
  .text("⬅️ Back", "back");

// Handling callbacks
bot.callbackQuery("confirm", async (ctx) => {
  await ctx.answerCallbackQuery(); // Remove loading animation
  await ctx.editMessageText("Confirmed! Processing...");
  // Process confirmation...
});

bot.callbackQuery("cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("Cancelled. Use /start to begin again.");
});

// Catch-all for unhandled callbacks
bot.on("callback_query:data", async (ctx) => {
  console.warn(`Unhandled callback: ${ctx.callbackQuery.data}`);
  await ctx.answerCallbackQuery("Unknown action");
});
```

**Key principles:**
- Always call answerCallbackQuery() to remove loading animation
- Use emoji for visual cues (✓, ✗, ⬅️)
- .row() creates new button row (default: buttons on same row)
- Callback data limited to 64 bytes (use short IDs, not full JSON)
- Catch unhandled callbacks to prevent stuck loading states
- Edit message after callback to show action result

### Anti-Patterns to Avoid

- **Using in-memory sessions in production:** Data lost on restart. Always use Redis/external storage.
- **Not wrapping external operations in conversation.external():** Causes replay bugs where operations execute multiple times.
- **Ignoring conversation replay mechanism:** Code runs multiple times per update. Side effects (DB writes, API calls) need external wrapping.
- **Forgetting to answer callback queries:** Leaves loading animation spinning, poor UX.
- **Not validating webhook secret token:** Security vulnerability, allows fake update injection.
- **Storing large data in sessions:** Redis sessions limited to ~1MB. Store large data in PostgreSQL, reference by ID in session.
- **Not handling conversation cancellation:** Users expect /cancel to work mid-conversation. Implement exit handlers.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-turn conversation flows | Custom state machine with switch/case per step | grammY conversations plugin | Plugin handles replay mechanism, storage, error recovery - ~500 LOC of complex logic you'd need to write and debug. Replay-based execution is non-trivial. |
| Session persistence | Custom Redis save/load logic | @grammyjs/storage-redis adapter | Adapter handles serialization, key namespacing, error handling, connection pooling. Integrates seamlessly with session plugin. |
| Inline keyboard builders | Manual InlineKeyboardMarkup object construction | grammY InlineKeyboard class | Builder API prevents JSON structure errors, provides type safety, chainable methods for readability. |
| Data extraction from text | Custom regex for name/email/phone | Regex patterns + Claude API extraction | Names have complex formats (Jr., titles, non-Latin), phone has country codes, formats. LLMs handle context better than regex alone. |
| Conversation summarization | String concatenation with manual truncation | Hierarchical summarization with Claude | Context window management needs semantic compression, not truncation. Claude preserves important details while reducing token count. |
| Error handling | Try-catch in every handler | bot.catch() + error boundaries | Centralized error handling prevents crashes, logs errors consistently, provides fallback responses. Error boundaries allow scoped handling. |
| Rate limiting | Manual request counting | express-rate-limit middleware | Handles distributed rate limiting, memory-efficient sliding windows, customizable strategies. Battle-tested in production. |

**Key insight:** The grammY ecosystem provides production-ready solutions for all common bot patterns. Custom implementations introduce bugs and maintenance burden. Use plugins unless there's a specific limitation.

## Common Pitfalls

### Pitfall 1: Conversation Replay Mechanism Misunderstanding

**What goes wrong:** Developers write conversation functions assuming linear, one-time execution. Code runs multiple times during replay (once per historical update), causing duplicated database writes, API calls, or state mutations.

**Why it happens:** grammY's conversation plugin uses replay-based execution (similar to React's reconciliation). When a new update arrives, the conversation function replays from the start, skipping past already-awaited updates. This is invisible to developers unfamiliar with the pattern.

**How to avoid:**
- Wrap all side effects (DB writes, API calls, non-deterministic operations) in `conversation.external()`
- Understand that code before `await conversation.waitFor()` runs on every update
- API calls via `ctx.reply()` are automatically handled by grammY, no wrapping needed
- Read grammY conversations documentation thoroughly before implementing flows

**Warning signs:**
- Database records duplicated for single conversation
- API calls executed multiple times (check API logs)
- Session data corrupted or overwritten unexpectedly
- Conversations stuck in infinite loops

**Example of bug:**

```typescript
// ❌ BAD: Database write runs on every update (replay)
async function badConversation(conversation, ctx) {
  await saveToDatabase({ step: "started" }); // Executes multiple times!
  await ctx.reply("What's your name?");
  const { message } = await conversation.waitFor("message:text");
  await saveToDatabase({ name: message.text }); // Executes multiple times!
}

// ✅ GOOD: Wrap external operations
async function goodConversation(conversation, ctx) {
  await conversation.external(() => saveToDatabase({ step: "started" }));
  await ctx.reply("What's your name?");
  const { message } = await conversation.waitFor("message:text");
  await conversation.external(() => saveToDatabase({ name: message.text }));
}
```

### Pitfall 2: Session Data Loss on Restart (No Persistent Storage)

**What goes wrong:** Bot uses in-memory session storage (default), loses all conversation state on restart/redeploy. Users mid-conversation lose context, leads to frustration and dropped leads.

**Why it happens:** grammY defaults to in-memory storage for quick setup. Developers intend to "add persistence later" but forget, or don't realize production needs differ.

**How to avoid:**
- Use Redis-backed sessions from day one (even in development)
- Test bot restart during active conversation (manual QA test)
- Monitor session persistence in production (track session load times)
- Document Redis as hard requirement in deployment docs

**Warning signs:**
- User complaints: "bot forgot our conversation after restart"
- Support tickets about lost data after deployments
- Session store errors in logs (connection refused to Redis)
- Abnormally high conversation abandonment rate after deploys

**Example:**

```typescript
// ❌ BAD: In-memory sessions (default)
bot.use(session({
  initial: () => ({ leadData: {} }),
  // No storage specified = in-memory
}));

// ✅ GOOD: Redis-backed sessions
const redis = new Redis(process.env.REDIS_URL);
const storage = new RedisAdapter({ instance: redis });

bot.use(session({
  initial: () => ({ leadData: {} }),
  storage, // Persists across restarts
}));
```

### Pitfall 3: Not Handling Conversation Cancellation

**What goes wrong:** Users stuck in conversation flow with no way to exit. Typing /cancel or /start mid-conversation doesn't work, forcing users to abandon chat entirely.

**Why it happens:** Conversation plugin takes control of update processing, commands don't trigger unless explicitly handled within conversation.

**How to avoid:**
- Check for cancel commands at start of conversation function
- Use `conversation.wait()` with filter to catch both text and commands
- Provide exit instructions in conversation prompts ("Type /cancel to exit")
- Test cancellation at every conversation step

**Warning signs:**
- User sends /cancel multiple times without effect
- Users type "cancel", "exit", "stop" as free text (intent signals)
- High conversation abandonment rate (users give up)
- Support tickets about "stuck bot"

**Example:**

```typescript
// ✅ GOOD: Handle cancellation
async function robustConversation(conversation, ctx) {
  // Check for cancel at start
  if (ctx.message?.text?.startsWith("/cancel")) {
    await ctx.reply("Conversation cancelled.");
    return; // Exit conversation
  }

  await ctx.reply("What's your name? (Type /cancel to exit)");

  // Wait for response, allowing commands
  const update = await conversation.wait();

  // Check for cancel command
  if (update.message?.text?.startsWith("/cancel")) {
    await ctx.reply("Cancelled. Use /start to begin again.");
    return;
  }

  const name = update.message?.text;
  // Continue conversation...
}
```

### Pitfall 4: Context Window Overflow with Long Conversations

**What goes wrong:** Storing entire conversation history in Claude API calls exceeds 200K token limit, causing API errors or degraded quality ("lost in the middle" problem).

**Why it happens:** Developers store every message naively, not accounting for token growth. 10-message conversation = ~3K tokens, 100-message = ~30K tokens, 500+ messages hit limits.

**How to avoid:**
- Keep last 5-10 message turns in context (sliding window)
- Summarize older turns periodically (hierarchical summarization)
- Monitor context size before API calls (count tokens with tiktoken)
- Implement conversation reset after 50+ turns
- Store full history in PostgreSQL, use subset for LLM context

**Warning signs:**
- Claude API errors: "context too long" (400 Bad Request)
- Response quality degrades in long conversations
- Increased latency on long conversations (large payload)
- Token usage spikes in billing dashboard

**Example:**

```typescript
// ❌ BAD: Unbounded history growth
ctx.session.messageHistory.push({ role: "user", content: message });
const response = await anthropic.messages.create({
  messages: ctx.session.messageHistory, // Could be 1000+ messages!
});

// ✅ GOOD: Sliding window with summarization
const MAX_MESSAGES = 10;

// Keep only recent messages
ctx.session.messageHistory.push({ role: "user", content: message });

if (ctx.session.messageHistory.length > MAX_MESSAGES) {
  // Summarize old messages
  const oldMessages = ctx.session.messageHistory.slice(0, -MAX_MESSAGES);
  const summary = await summarizeMessages(oldMessages);

  ctx.session.conversationSummary = summary;
  ctx.session.messageHistory = ctx.session.messageHistory.slice(-MAX_MESSAGES);
}

// Include summary in system prompt
const systemPrompt = ctx.session.conversationSummary
  ? `${BASE_PROMPT}\n\nPrevious conversation summary: ${ctx.session.conversationSummary}`
  : BASE_PROMPT;

const response = await anthropic.messages.create({
  system: systemPrompt,
  messages: ctx.session.messageHistory, // Limited to 10 recent
});
```

### Pitfall 5: No Webhook Secret Token Validation

**What goes wrong:** Webhook endpoint accepts requests from any source, allowing attackers to send fake updates, inject commands, or spam the bot.

**Why it happens:** Telegram Bot API doesn't enforce secret token (optional parameter). Developers skip it for convenience during development, forget to add in production.

**How to avoid:**
- Set secret_token in setWebhook() call
- Validate X-Telegram-Bot-Api-Secret-Token header in middleware
- Generate cryptographically random token (256 chars)
- Return 403 Forbidden for invalid tokens, not 200 (prevents info leakage)
- Test with curl/Postman to verify validation works

**Warning signs:**
- Unexpected messages in logs (not sent by real users)
- Bot responding to non-existent conversations
- Unusual traffic patterns (spikes from single IP)
- Security audit findings

**Example:**

```typescript
// ❌ BAD: No validation
app.post("/webhook", webhookCallback(bot, "express"));

// ✅ GOOD: Secret token validation
import crypto from "crypto";

// Generate random token (do once, store in .env)
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ||
  crypto.randomBytes(32).toString("hex");

app.post("/webhook", (req, res, next) => {
  const token = req.header("X-Telegram-Bot-Api-Secret-Token");

  if (token !== WEBHOOK_SECRET) {
    console.error("Invalid webhook secret", { ip: req.ip });
    return res.status(403).send("Forbidden");
  }

  next();
}, webhookCallback(bot, "express"));

// Set webhook with secret
await bot.api.setWebhook(`${WEBHOOK_URL}/webhook`, {
  secret_token: WEBHOOK_SECRET,
});
```

### Pitfall 6: Not Answering Callback Queries

**What goes wrong:** User presses inline keyboard button, loading animation spins forever, button appears unresponsive. Poor UX, users click multiple times (duplicate actions).

**Why it happens:** Telegram shows loading animation until bot calls answerCallbackQuery(). Developers forget to call it, or handler throws error before reaching it.

**How to avoid:**
- Call ctx.answerCallbackQuery() at start of callback handler (before async operations)
- Use try-finally to ensure it's called even on error
- Add catch-all handler for unregistered callbacks
- Monitor unhandled callback errors in logs

**Warning signs:**
- Users report "button not working" or "stuck loading"
- Multiple duplicate actions from same button press
- Telegram warnings in bot logs about unanswered callbacks
- User frustration in support tickets

**Example:**

```typescript
// ❌ BAD: Forget to answer callback
bot.callbackQuery("confirm", async (ctx) => {
  await processLead(ctx.session.leadData); // If this throws, no answer
  await ctx.editMessageText("Confirmed!");
});

// ✅ GOOD: Answer immediately, handle errors
bot.callbackQuery("confirm", async (ctx) => {
  try {
    await ctx.answerCallbackQuery(); // Remove loading animation immediately
    await processLead(ctx.session.leadData);
    await ctx.editMessageText("Confirmed!");
  } catch (error) {
    console.error("Callback error:", error);
    await ctx.answerCallbackQuery({ text: "Error occurred" });
    await ctx.editMessageText("Sorry, something went wrong.");
  }
});

// Catch-all for unhandled callbacks
bot.on("callback_query:data", async (ctx) => {
  console.warn(`Unhandled callback: ${ctx.callbackQuery.data}`);
  await ctx.answerCallbackQuery("Unknown action");
});
```

### Pitfall 7: Session Data Exceeding Size Limits

**What goes wrong:** Storing large data (images, long text, full conversation history) in session causes Redis writes to fail or slow down, session data corrupted.

**Why it happens:** Sessions designed for small state (~100KB), not large payloads. Developers use session as general-purpose storage.

**How to avoid:**
- Store only essential state in session (current step, user ID, small flags)
- Store large data (conversation history, documents) in PostgreSQL
- Reference database records by ID in session
- Monitor session sizes (log serialized size on write)
- Set Redis max-value size limit to catch violations

**Warning signs:**
- Redis timeout errors on session save
- Session data mysteriously resets to initial state
- High Redis memory usage
- Slow response times on session-heavy operations

**Example:**

```typescript
// ❌ BAD: Store large data in session
ctx.session.messageHistory = [ /* 1000 messages */ ]; // ~1MB+
ctx.session.uploadedFiles = [ /* base64 encoded images */ ]; // Multi-MB

// ✅ GOOD: Store in database, reference by ID
// Save conversation to database
const conversationId = await saveConversation({
  userId: ctx.from.id,
  messages: messageHistory,
});

// Store only ID in session
ctx.session.conversationId = conversationId;

// Load when needed
const conversation = await loadConversation(ctx.session.conversationId);
```

## Code Examples

Verified patterns from official sources:

### Command Handlers

```typescript
// Source: https://grammy.dev/guide/basics
import { Bot } from "grammy";

const bot = new Bot(process.env.BOT_TOKEN!);

// /start command
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome! I'm here to help you get started. What would you like to know?"
  );
  await ctx.conversation.enter("leadCollectionFlow");
});

// /help command
bot.command("help", async (ctx) => {
  const helpText = `
Available commands:
/start - Begin a new conversation
/help - Show this help message
/cancel - Cancel current conversation
/status - Check your current request status

I can help you with information about our services. Just ask!
`;
  await ctx.reply(helpText);
});

// /cancel command
bot.command("cancel", async (ctx) => {
  await ctx.reply("Current conversation cancelled. Use /start to begin again.");
  // Exit any active conversation
  await ctx.conversation.exit();
});
```

### Error Handling

```typescript
// Source: https://grammy.dev/guide/errors
import { BotError, GrammyError, HttpError } from "grammy";

bot.catch((err: BotError) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
    // Telegram API errors (invalid chat_id, message too long, etc.)
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
    // Network errors
  } else {
    console.error("Unknown error:", e);
    // Other errors
  }

  // Notify user
  ctx.reply("Sorry, something went wrong. Please try again or contact support.")
    .catch(() => console.error("Failed to send error message to user"));
});
```

### Data Extraction with Regex + LLM Fallback

```typescript
// Pattern-based extraction with LLM fallback
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[\+]?[(]?[0-9]{1,3}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{1,9}$/;

interface ExtractedData {
  name?: string;
  email?: string;
  phone?: string;
}

async function extractDataFromMessage(
  message: string,
  existingData: Partial<ExtractedData>
): Promise<Partial<ExtractedData>> {
  const extracted: Partial<ExtractedData> = {};

  // Email extraction
  if (!existingData.email) {
    const emailMatch = message.match(EMAIL_REGEX);
    if (emailMatch) extracted.email = emailMatch[0];
  }

  // Phone extraction
  if (!existingData.phone) {
    const phoneMatch = message.match(PHONE_REGEX);
    if (phoneMatch) extracted.phone = phoneMatch[0];
  }

  // Name extraction via LLM (complex patterns)
  if (!existingData.name && !extracted.email && !extracted.phone) {
    const prompt = `Extract the person's name from this message. Return only the name, or "NONE" if no name present.\n\nMessage: "${message}"`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4.5-20250514",
      max_tokens: 50,
      messages: [{ role: "user", content: prompt }],
    });

    const name = response.content[0].type === "text"
      ? response.content[0].text.trim()
      : null;

    if (name && name !== "NONE") {
      extracted.name = name;
    }
  }

  return extracted;
}
```

### Conversation History Management (Sliding Window)

```typescript
interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const MAX_CONTEXT_MESSAGES = 10;
const SUMMARIZE_THRESHOLD = 20;

async function manageConversationContext(
  session: SessionData
): Promise<{ messages: Message[]; summary?: string }> {
  const history = session.messageHistory || [];

  if (history.length <= MAX_CONTEXT_MESSAGES) {
    return { messages: history };
  }

  // Need summarization
  const oldMessages = history.slice(0, -MAX_CONTEXT_MESSAGES);
  const recentMessages = history.slice(-MAX_CONTEXT_MESSAGES);

  // Generate summary if not exists or outdated
  if (!session.conversationSummary ||
      oldMessages.length > SUMMARIZE_THRESHOLD) {

    const summaryPrompt = `Summarize the key points and context from this conversation concisely (2-3 sentences):\n\n${
      oldMessages.map(m => `${m.role}: ${m.content}`).join("\n")
    }`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4.5-20250514",
      max_tokens: 200,
      messages: [{ role: "user", content: summaryPrompt }],
    });

    session.conversationSummary = response.content[0].type === "text"
      ? response.content[0].text
      : "";
  }

  return {
    messages: recentMessages,
    summary: session.conversationSummary,
  };
}

// Usage in Claude API call
async function generateContextualResponse(session: SessionData, userMessage: string) {
  const { messages, summary } = await manageConversationContext(session);

  const systemPrompt = summary
    ? `${BASE_SYSTEM_PROMPT}\n\nPrevious conversation context: ${summary}`
    : BASE_SYSTEM_PROMPT;

  messages.push({ role: "user", content: userMessage, timestamp: new Date() });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4.5-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Telegraf framework | grammY framework | 2021-2022 | Better TypeScript support, conversation plugin architecture, active development. Telegraf still maintained but grammY preferred for new projects. |
| Custom state machines | grammY conversations plugin | 2022-2023 | Replay-based execution model eliminates boilerplate state management code. Plugin handles persistence, errors, cancellation. |
| In-memory session storage | Redis-backed sessions | Always standard for production | Production apps always needed persistence, but grammY made it easier with official adapters. Now zero-excuse not to use Redis. |
| Long polling only | Webhook preferred for production | Always, emphasized 2020+ | Webhooks lower latency, scale better, but long polling still valid for dev/testing. Webhook with secret token now security standard. |
| Claude 3.5 Sonnet (200K context) | Claude Sonnet 4.5 (200K standard, 1M beta) | 2025-2026 | 1M context window (beta) reduces need for aggressive summarization. 200K standard sufficient for most conversations. |
| Manual callback handling | @grammyjs/menu plugin | 2022+ | High-level menu abstraction reduces inline keyboard boilerplate for complex navigation. Use for multi-level menus. |

**Deprecated/outdated:**

- **node-telegram-bot-api**: Older library, callback-based API (not promise/async). Use grammY or Telegraf for modern projects.
- **In-memory storage in production**: Never acceptable. Redis/external storage is standard.
- **Webhook without secret token**: Security risk. Secret token validation now expected in production deployments.
- **Storing full conversation history in LLM context**: Claude 4.5's extended context helps, but summarization patterns still recommended for cost efficiency and quality.

## Open Questions

### 1. Conversation Timeout Edge Cases

**What we know:** Redis TTL handles basic session expiration (24 hours inactive). grammY enhanceStorage provides millisecondsToLive option.

**What's unclear:** How to handle mid-conversation timeout gracefully? If user returns after TTL expiration, should bot:
- Send "session expired" message (requires tracking last update timestamp)
- Silently start new conversation (user may be confused)
- Prompt user to continue from checkpoint (needs conversation state recovery)

**Recommendation:** Implement soft expiration warnings:
- Store lastActivityAt timestamp in session
- At conversation start, check if session older than 23 hours
- Send warning: "Session expiring soon - please complete in next hour"
- On hard expiration, send /start prompt to restart gracefully

### 2. Data Extraction Accuracy Threshold

**What we know:** Regex patterns work for well-formatted emails/phones. LLM extraction handles complex cases (names with titles, nicknames, etc.).

**What's unclear:** What accuracy level is acceptable? If LLM extracts name with 80% confidence vs 95%, should bot:
- Accept and confirm (risk of wrong data)
- Ask clarification question (better accuracy, more friction)
- Show confidence indicator to user (complex UX)

**Recommendation:** Use confirmation step regardless of confidence. Show extracted data with inline keyboard:
- "I found: Name: John Smith, Email: john@example.com - Correct? [Yes/No/Edit]"
- Shifts validation burden to user (they know correct answer)
- Avoids complex confidence tuning

### 3. Multiple Concurrent Conversations

**What we know:** grammY conversations plugin supports parallel: true option for multiple simultaneous conversations. Default is one conversation per chat.

**What's unclear:** Should Phase 1 support:
- One conversation at a time (simpler, less state complexity)
- Multiple concurrent (e.g., user asks question mid-lead-collection)
- Context switching between conversations (most complex)

**Recommendation:** Start with single conversation (parallel: false). Requirements show linear flow: lead collection, not multi-tasking. Add parallel conversations in later phase if user feedback indicates need.

### 4. Lead Deduplication Strategy

**What we know:** Users might start multiple conversations, submit same email/phone multiple times.

**What's unclear:** How to handle duplicates?
- Detect during conversation, notify user ("We already have your info")
- Allow duplicates, deduplicate in backend/CRM
- Update existing lead with new information

**Recommendation:** Detect duplicates at confirmation step:
```typescript
const existingLead = await findLeadByEmail(email);
if (existingLead) {
  await ctx.reply("We already have your contact info. Would you like to update it? [Yes/No]");
}
```
Prevents frustration, shows system intelligence.

## Sources

### Primary (HIGH confidence)

**Official Documentation:**
- [grammY Documentation](https://grammy.dev/) - Framework overview, plugins, guides
- [grammY Conversations Plugin](https://grammy.dev/plugins/conversations) - Multi-turn dialogue patterns
- [grammY Sessions Plugin](https://grammy.dev/plugins/session) - Session storage with Redis
- [grammY Keyboard Plugin](https://grammy.dev/plugins/keyboard) - Inline keyboard builder
- [grammY Error Handling](https://grammy.dev/guide/errors) - bot.catch() and error boundaries
- [Telegram Bot API](https://core.telegram.org/bots/api) - Webhook setup, secret tokens, rate limits
- [Claude API Documentation](https://platform.claude.com/docs/en/api/messages) - Messages API, context windows

**Verified Web Sources:**
- [Context Window Management Strategies](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/) - Sliding window, hierarchical summarization patterns
- [LLM Chat History Summarization Guide](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025) - Practical summarization techniques
- [Building Stateful Conversations with Postgres and LLMs](https://medium.com/@levi_stringer/building-stateful-conversations-with-postgres-and-llms-e6bb2a5ff73e) - PostgreSQL schema patterns

### Secondary (MEDIUM confidence)

**Community Resources:**
- [Building a Telegram bot with grammY](https://blog.logrocket.com/building-telegram-bot-grammy/) - LogRocket tutorial (Feb 2025)
- [Redis Session Storage Patterns](https://henrywithu.com/building-robust-telegram-bots/) - Robust bot architecture
- [Slot Filling Best Practices](https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/slot-filling-best-practices) - Microsoft Copilot patterns (transferable)
- [Multi-Turn AI Conversations](https://rasa.com/blog/multi-turn-conversation) - Rasa patterns (framework-agnostic concepts)
- [Claude 4.5 Context Window](https://medium.com/llm-stats/claude-sonnet-4-5-complete-guide-pricing-context-window-and-api-5e9c550daafd) - Context window details

**Development Patterns:**
- [CRUD REST API with Node.js, Express, and PostgreSQL](https://blog.logrocket.com/crud-rest-api-node-js-express-postgresql/) - API patterns
- [Redis TTL & Expiration Guide](https://www.redimo.dev/learn/valkey_ttl/TTL-&-EXPIRE) - TTL mechanisms
- [Proactive Slot Filling](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/smart-entity-extraction-and-proactive-slot-filling/) - Entity extraction patterns

### Verification Notes

**What was verified:**
- grammY conversation plugin replay mechanism confirmed via official docs
- Redis TTL automatic cleanup verified (passive + active expiration)
- Claude Sonnet 4.5 context window: 200K standard, 1M beta (requires beta header)
- Telegram webhook secret token: X-Telegram-Bot-Api-Secret-Token header validation
- grammY session plugin: RedisAdapter integration confirmed
- Inline keyboard API: InlineKeyboard builder with callback handling

**What remains hypothesis (needs validation during implementation):**
- Actual conversation timeout behavior at 24-hour mark (test in production)
- LLM data extraction accuracy for Russian/non-English names (test with real user data)
- Redis memory usage patterns for 1000+ concurrent sessions (needs load testing)
- Claude API response time with 10-message context vs 100-message (benchmark needed)
- Webhook secret token validation behavior with empty/malformed header (edge case testing)

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** - grammY, Redis, PostgreSQL, Claude API all documented, production-proven, current as of 2026
- Architecture patterns: **HIGH** - Conversation flows, session storage, webhook setup verified from official sources
- Code examples: **HIGH** - Extracted from official documentation, tested patterns in community
- Pitfalls: **MEDIUM-HIGH** - Replay mechanism, session loss, cancellation handling verified; some edge cases hypothetical
- Open questions: **MEDIUM** - Tactical implementation details requiring user feedback and load testing

**Overall confidence: HIGH**

Research based on:
- Official documentation (grammY, Telegram, Anthropic) - current as of Feb 2026
- Community tutorials and guides - published 2025-2026
- Production architecture patterns - verified across multiple sources
- Code examples - extracted from official docs and working implementations

Confidence limited by:
- Lack of hands-on testing with replay mechanism edge cases
- No production load testing data for Redis session scaling
- LLM extraction accuracy not benchmarked with actual user data
- Conversation timeout UX patterns based on general best practices, not user testing

Confidence strengthened by:
- Multiple source verification for critical patterns (replay mechanism, Redis TTL)
- Official documentation for all core technologies
- Active 2026 development confirmed for grammY framework
- Architecture patterns match project's existing tech decisions (TypeScript, PostgreSQL, Docker)

**Research date:** 2026-02-27
**Valid until:** ~90 days (April 2026) - frameworks stable, but check for grammY plugin updates, Claude API changes

---

**Next Steps for Planner:**
1. Use this research to create detailed PLAN.md files for Phase 1
2. Break down conversation flow implementation into tasks (grammY setup, conversation plugin, Redis integration)
3. Create verification tasks for critical pitfalls (replay mechanism testing, session persistence testing)
4. Reference code examples in task descriptions for implementation guidance
5. Plan testing strategy for open questions (conversation timeout UX, data extraction accuracy)
