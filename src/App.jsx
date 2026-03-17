import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MessageCircle, Heart, Sparkles, BookOpen, Send, Bookmark, Trash2 } from "lucide-react";

const MODES = {
  basics: {
    label: "Basics",
    icon: BookOpen,
    accent: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    chip: "border-sky-500/30 text-sky-300",
    starterPrompts: [
      "How do I say 'what are you doing?'",
      "Teach me 5 ways to greet a friend",
      "How do I say 'I'm tired'",
      "How do I ask where someone is from?",
    ],
  },
  social: {
    label: "Social",
    icon: MessageCircle,
    accent: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    chip: "border-emerald-500/30 text-emerald-300",
    starterPrompts: [
      "How do I say 'what are you up to later?'",
      "Give me a casual way to say 'that's funny'",
      "How do I say 'I miss talking to you'",
      "How would a real person text this?",
    ],
  },
  flirting: {
    label: "Flirting",
    icon: Heart,
    accent: "text-fuchsia-400 border-fuchsia-500/30 bg-fuchsia-500/10",
    chip: "border-fuchsia-500/30 text-fuchsia-300",
    starterPrompts: [
      "Make this sound flirty but not cringe",
      "How do I say 'you look really good'",
      "Give me 3 soft flirting lines in Levantine",
      "How do I text 'I like talking to you'",
    ],
  },
};

const QUICK_ACTIONS = [
  "Understand",
  "Make simpler",
  "More natural",
  "Make it flirty",
];

const STORAGE_KEYS = {
  mode: "ihkili-mode",
  messages: "ihkili-messages",
  saved: "ihkili-saved",
};

function parseAssistantPayload(raw) {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const jsonSlice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = JSON.parse(jsonSlice);
    return {
      arabic: parsed.arabic || "",
      transliteration: parsed.transliteration || "",
      english: parsed.english || "",
      note: parsed.note || "",
      variations: Array.isArray(parsed.variations) ? parsed.variations : [],
    };
  } catch {
    return {
      arabic: "",
      transliteration: "",
      english: "",
      note: "Model returned malformed output.",
      variations: [],
    };
  }
}

function systemPromptForMode(modeKey) {
  const modeLabel = MODES[modeKey]?.label || "Basics";
  return `You are Iḥkili, a Levantine Arabic tutor chatbot.

Rules:
- Use spoken Levantine Arabic only.
- Prioritize Lebanese and Palestinian speech.
- Avoid MSA unless the user explicitly asks for it.
- Keep answers short, natural, and beginner-friendly.
- Arabic should be the main answer.
- Only explain grammar when the user asks.
- Focus on this conversation mode: ${modeLabel}.
- Do not give long paragraphs unless needed.
- Do not add emojis.

Critical output rules:
- In the "arabic" field, use Arabic script only.
- Do NOT use Chinese characters.
- Do NOT use Japanese characters.
- Do NOT use Korean characters.
- Do NOT mix English words inside the Arabic field.
- The "transliteration" field must contain Latin letters only.
- The "english" field must contain English only.
- If unsure, return a very short simple Levantine phrase rather than guessing.
- If you cannot answer confidently, return a simple correct phrase and leave note empty.

Return ONLY valid JSON in this exact shape:
{
  "arabic": "main Arabic reply here",
  "transliteration": "latin transliteration here",
  "english": "concise English meaning here",
  "note": "short note about tone, usage, dialect, or context",
  "variations": ["optional variant 1", "optional variant 2", "optional variant 3"]
}

Do not include markdown fences.
Do not include any text before or after the JSON.`;
}

async function callOllama({ prompt, mode, history }) {
  const context = history
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === "string" ? m.content : m.content?.arabic || ""}`)
    .join("\n");

  const fullPrompt = `${systemPromptForMode(mode)}\n\nConversation context:\n${context || "None"}\n\nUSER: ${prompt}\nASSISTANT:`;

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen2.5:7b",
      prompt: fullPrompt,
      stream: false,
      options: {
        temperature: 0.4,
        num_predict: 300,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to reach Ollama.");
  }

  const data = await res.json();
  return parseAssistantPayload(data.response || "");
}

function isArabicScript(text) {
  if (!text) return false;
  return /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s؟،ءآأؤإئىةابتثجحخدذرزسشصضطظعغفقكلمنهوىي\-]+$/.test(text);
}

function isLatinish(text) {
  if (!text) return false;
  return /^[A-Za-z0-9\s'",.?!\-()]+$/.test(text);
}

function MessageCard({ msg, mode, onAction, onSave, onRetry }) {
  const [open, setOpen] = useState(false)
  const modeChip = MODES[mode]?.chip || "border-zinc-700 text-zinc-300"
  const primaryChip = "border-zinc-600 text-zinc-100 bg-zinc-900/80"

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-sm animate-[fadeIn_.18s_ease-out]">
          {msg.content}
        </div>
      </div>
    )
  }

  const content = msg.content
  const arabicText = content?.arabic || "";
  const translitText = content?.transliteration || "";

  const looksBrokenArabic = !isArabicScript(arabicText);
  const looksBrokenTranslit = translitText && !isLatinish(translitText);

  const weakNote = !content?.note || content.note.length < 12;
  const isLowQuality = looksBrokenArabic || looksBrokenTranslit;

  const validVariations = (content.variations || []).filter((v) => isArabicScript(v));

  return (
    <div className="space-y-3">
      <div className="max-w-[89%] rounded-2xl rounded-bl-md border border-zinc-900 bg-zinc-950 px-4 py-5 shadow-sm animate-[fadeIn_.22s_ease-out]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isLowQuality ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
                <div className="text-sm font-medium text-amber-200">
                  This reply may be inaccurate
                </div>
                <div className="mt-1 text-xs leading-5 text-amber-100/80">
                  The model returned mixed or malformed text. Try again or simplify the request.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onRetry(content)}
                    className="rounded-full border border-amber-400/30 px-3 py-1.5 text-xs text-amber-200 transition active:scale-[0.98] hover:bg-white/5"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => onAction("Make simpler", content)}
                    className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition active:scale-[0.98] hover:bg-white/5"
                  >
                    Make simpler
                  </button>
                </div>
              </div>
            ) : (
              <div dir="rtl" className="text-right text-[1.55rem] leading-9 tracking-tight text-zinc-50">
                {content.arabic || "—"}
              </div>
            )}
          </div>

          <button
            onClick={() => onSave(content)}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:bg-zinc-900 active:scale-[0.98]"
            aria-label="Save phrase"
          >
            <Bookmark size={14} />
          </button>
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-xs text-zinc-500"
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? "Hide breakdown" : "Breakdown"}
        </button>

        {open && (
          <div className="mt-3 space-y-3 border-t border-zinc-900 pt-3 text-sm">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                Transliteration
              </div>
              <div className="text-zinc-200">{content.transliteration || "—"}</div>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                English
              </div>
              <div className="text-zinc-200">{content.english || "—"}</div>
            </div>

            {!weakNote && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                  Note
                </div>
                <div className="text-zinc-300">{content.note}</div>
              </div>
            )}

            {validVariations.length > 0 && (
              <div>
                <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                  Variations
                </div>
                <div className="space-y-2">
                  {validVariations.map((v, i) => (
                    <div
                      key={i}
                      dir="rtl"
                      className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-right text-zinc-200"
                    >
                      {v}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pl-1">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            onClick={() => onAction(action, content)}
            className={`rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98] hover:bg-white/5 ${
              action === "Understand" ? primaryChip : modeChip
            }`}
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState(() => localStorage.getItem(STORAGE_KEYS.mode) || "basics");
  const [messages, setMessages] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.messages);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });
  const [saved, setSaved] = useState(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.saved);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.mode, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(saved));
  }, [saved]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const modeConfig = useMemo(() => MODES[mode], [mode]);

  async function sendPrompt(promptText) {
    const text = promptText.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const payload = await callOllama({ prompt: text, mode, history: nextMessages });
      setMessages([...nextMessages, { role: "assistant", content: payload, mode }]);
    } catch (err) {
      setError(
        "Could not reach Ollama. Make sure Ollama is running locally and that you pulled a model like qwen2.5:3b."
      );
    } finally {
      setLoading(false);
    }
  }

  function handleAction(action, content) {
    const arabic = content?.arabic || "";
    const promptMap = {
      Understand: `Explain this Levantine Arabic phrase simply: ${arabic}`,
      "Make simpler": `Make this simpler for a beginner in Levantine Arabic: ${arabic}`,
      "More natural": `Make this sound more natural in Lebanese/Palestinian spoken Arabic: ${arabic}`,
      "Make it flirty": `Make this more flirty but still natural and not cringe in Levantine Arabic: ${arabic}`,
    };
    sendPrompt(promptMap[action] || `${action}: ${arabic}`);
  }

  function handleSave(content) {
    setSaved((prev) => [{ ...content, id: crypto.randomUUID(), mode, createdAt: Date.now() }, ...prev]);
    setShowSaved(true);
  }

  function handleRetry(content) {
    const prompt = `Retry this request and return a cleaner Levantine Arabic answer only in the required JSON format. Prior broken answer: ${content?.arabic || ""}`
    sendPrompt(prompt)
  }

  function clearChat() {
    setMessages([]);
    setError("");
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 [@keyframes_fadeIn]{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}">
      <div className="mx-auto flex min-h-screen max-w-md flex-col border-x border-zinc-900 bg-zinc-950">
        <header className="sticky top-0 z-20 border-b border-zinc-900 bg-zinc-950/90 px-4 pb-4 pt-safe backdrop-blur">
          <div className="flex items-center justify-between pt-4">
            <div>
              <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Iḥkili</h1>
              <p className="mt-1 text-sm text-zinc-400">إحكيلي</p>
              <div dir="rtl" className="mt-2 text-right text-lg tracking-wide text-zinc-600">
                Learn to speak in the Levant
              </div>
            </div>
            </div>
            <button
              onClick={() => setShowSaved((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 text-zinc-300 transition hover:bg-zinc-900 active:scale-[0.98]"
              aria-label="Open saved phrases"
            >
              <Bookmark size={15} />
            </button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {Object.entries(MODES).map(([key, cfg]) => {
              const Icon = cfg.icon;
              const active = key === mode;
              return (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm transition duration-150 active:scale-[0.98] ${
                    active ? `${cfg.accent} scale-[1.03] shadow-[0_0_20px_rgba(255,255,255,0.03)]` : "border-zinc-800 bg-zinc-900 text-zinc-300"
                  }`}
                >
                  <Icon size={15} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </header>

        <main ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-4">
              <div className="rounded-3xl border border-zinc-900 bg-zinc-950 p-4">
                <div className="text-sm text-zinc-400">Mode</div>
                <div className="mt-1 text-lg font-medium text-zinc-100">{modeConfig.label}</div>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Arabic appears first. Open the breakdown only when you need support.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Starter prompts</div>
                {modeConfig.starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendPrompt(prompt)}
                    className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-left text-sm text-zinc-200 transition hover:bg-zinc-900/70"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <MessageCard
              key={`${msg.role}-${idx}`}
              msg={msg}
              mode={msg.mode || mode}
              onAction={handleAction}
              onSave={handleSave}
              onRetry={handleRetry}
            />
          ))}

          {loading && (
            <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-950 px-4 py-4 text-sm text-zinc-400">
              Thinking...
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </main>

        <footer className="sticky bottom-0 border-t border-zinc-900 bg-zinc-950 px-4 pb-4 pt-3">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={clearChat}
              className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition active:scale-[0.98]"
            >
              <span className="inline-flex items-center gap-1"><Trash2 size={12} /> Clear</span>
            </button>
            <button
              onClick={() => sendPrompt("Teach me 3 very common beginner social phrases in Levantine Arabic")}
              className={`rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98] ${modeConfig.chip}`}
            >
              <span className="inline-flex items-center gap-1"><Sparkles size={12} /> Quick drill</span>
            </button>
          </div>

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendPrompt(input);
                }
              }}
              rows={1}
              placeholder='Try: "what are you doing?"'
              className="max-h-36 min-h-[52px] flex-1 resize-none rounded-[1.35rem] border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-600 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.04)]"
            />
            <button
              onClick={() => sendPrompt(input)}
              disabled={loading || !input.trim()}
              className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl bg-zinc-100 text-black transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
        </footer>

        {showSaved && (
          <div className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm">
            <div className="absolute inset-x-0 bottom-0 max-h-[78vh] rounded-t-3xl border-t border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-medium text-zinc-100">Saved phrases</h2>
                  <p className="text-sm text-zinc-500">Tap outside to close.</p>
                </div>
                <button onClick={() => setShowSaved(false)} className="text-sm text-zinc-400">
                  Close
                </button>
              </div>

              <div className="space-y-3 overflow-y-auto pb-8">
                {saved.length === 0 && <div className="text-sm text-zinc-500">No saved phrases yet.</div>}
                {saved.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-zinc-800 bg-black p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${MODES[item.mode]?.chip || "border-zinc-700 text-zinc-300"}`}>
                        {MODES[item.mode]?.label || item.mode}
                      </span>
                      <button
                        onClick={() => setSaved((prev) => prev.filter((x) => x.id !== item.id))}
                        className="text-xs text-zinc-500"
                      >
                        Remove
                      </button>
                    </div>
                    <div dir="rtl" className="text-right text-xl leading-8 text-zinc-50">
                      {item.arabic}
                    </div>
                    <div className="mt-2 text-sm text-zinc-400">{item.transliteration}</div>
                    <div className="mt-1 text-sm text-zinc-300">{item.english}</div>
                  </div>
                ))}
              </div>
            </div>
            <button className="absolute inset-0 -z-10 h-full w-full" onClick={() => setShowSaved(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
