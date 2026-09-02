import { useState, useRef, useEffect } from "react";

type Lang = "EN" | "KZ" | "RU";
type Message = { role: "user" | "ai"; text: string; timestamp: string };

const SAMPLE_RESPONSES: Record<string, string> = {
  exam: "📋 **Algorithm Analysis Exam Guide**\n\nKey topics from your syllabus:\n• Big-O complexity analysis (O1, O log n, O n²)\n• Sorting algorithms: QuickSort, MergeSort, HeapSort\n• Graph algorithms: Dijkstra, Bellman-Ford, BFS/DFS\n• Dynamic programming patterns\n• NP-completeness & reductions\n\n💡 Prof. Seitkali focuses heavily on complexity proofs. Review lecture slides 8–12.",
  gpa: "📊 **GPA Analysis**\n\nCurrent CUM GPA: **3.82 / 4.0**\n\nTo reach Summa Cum Laude (≥3.90):\n• Semester average needed: **4.0** across 30 credits\n• Priority courses: Higher Math II, Data Structures\n\n🎯 Your predicted graduation GPA: **3.89** if current trend continues.",
  default: "👋 I'm your KazNU AI Copilot. I can help you with:\n• 📚 Exam prep from your syllabus\n• 📊 GPA analysis & planning\n• 🌐 Translate course materials (KZ/RU/EN)\n• 📅 Schedule optimization\n• 🎯 Assignment help\n\nWhat would you like to explore?",
};

const SUGGESTIONS = [
  "📚 Generate exam prep for Algorithms",
  "📊 Analyze my GPA trajectory",
  "🌐 Translate syllabus to Kazakh",
  "📅 Optimize my weekly schedule",
];

const LANG_FLAGS: Record<Lang, string> = { EN: "🇬🇧", KZ: "🇰🇿", RU: "🇷🇺" };

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}>
        <svg viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
          <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
        </svg>
      </div>
      <div className="px-4 py-3 squircle-md" style={{ background: "rgba(28,28,30,0.9)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex gap-1.5 items-center h-4">
          {[0, 0.2, 0.4].map((delay) => (
            <div key={delay} className="w-1.5 h-1.5 rounded-full" style={{ background: "#007AFF", animation: `pulse-glow 1.2s ease-in-out ${delay}s infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  const lines = msg.text.split("\n").map((line, i) => {
    if (line.startsWith("**") && line.endsWith("**")) {
      return <p key={i} className="font-bold text-white mb-0.5">{line.slice(2, -2)}</p>;
    }
    if (line.startsWith("• ")) {
      return <p key={i} className="text-sm pl-2" style={{ color: "rgba(235,235,245,0.8)" }}>• {line.slice(2)}</p>;
    }
    if (line.startsWith("💡") || line.startsWith("🎯") || line.startsWith("📊") || line.startsWith("📋") || line.startsWith("👋")) {
      return <p key={i} className="text-sm text-white">{line}</p>;
    }
    return line ? <p key={i} className="text-sm" style={{ color: "rgba(235,235,245,0.75)" }}>{line}</p> : <div key={i} className="h-1.5" />;
  });

  return (
    <div className={`flex items-end gap-2 mb-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #0033A0, #007AFF)" }}>
          <svg viewBox="0 0 20 20" fill="white" className="w-3.5 h-3.5">
            <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" />
          </svg>
        </div>
      )}
      <div
        className="max-w-xs px-4 py-3 squircle-md"
        style={{
          background: isUser ? "linear-gradient(135deg, #0033A0, #007AFF)" : "rgba(28,28,30,0.9)",
          border: isUser ? "none" : "1px solid rgba(255,255,255,0.08)",
          boxShadow: isUser ? "0 4px 16px rgba(0,122,255,0.25)" : undefined,
        }}
      >
        <div className="space-y-0.5">{lines}</div>
        <p className="text-xs mt-2" style={{ color: isUser ? "rgba(255,255,255,0.5)" : "rgba(235,235,245,0.3)", fontFamily: "JetBrains Mono" }}>
          {msg.timestamp}
        </p>
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ai", text: SAMPLE_RESPONSES.default, timestamp: "Now" },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [lang, setLang] = useState<Lang>("EN");
  const [showLangMenu, setShowLangMenu] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  function now() {
    return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  function send(text?: string) {
    const t = text || input.trim();
    if (!t) return;
    setInput("");
    const userMsg: Message = { role: "user", text: t, timestamp: now() };
    setMessages((m) => [...m, userMsg]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      const lower = t.toLowerCase();
      const response = lower.includes("exam") || lower.includes("algorithm")
        ? SAMPLE_RESPONSES.exam
        : lower.includes("gpa") || lower.includes("grade")
        ? SAMPLE_RESPONSES.gpa
        : "🤔 Great question! I can access your Univer academic record and course materials to give you a detailed answer. This feature uses your uploaded syllabi and real-time grade data.\n\n💬 Try asking: \"Generate exam prep for Algorithms\" or \"Analyze my GPA trajectory\"";
      setMessages((m) => [...m, { role: "ai", text: response, timestamp: now() }]);
    }, 1400);
  }

  return (
    <div className="h-full flex flex-col" style={{ background: "#000" }}>
      {/* Header */}
      <div className="px-4 pt-2 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white" style={{ letterSpacing: "-0.5px" }}>AI Copilot</h1>
            <p className="text-xs mt-0.5" style={{ color: "rgba(235,235,245,0.4)" }}>Powered by KazNU LLM · Your academic context loaded</p>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowLangMenu(!showLangMenu)}
              className="flex items-center gap-2 px-3 py-1.5 squircle-sm"
              style={{ background: "rgba(28,28,30,0.9)", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              <span className="text-base">{LANG_FLAGS[lang]}</span>
              <span className="text-xs font-semibold" style={{ color: "rgba(235,235,245,0.7)" }}>{lang}</span>
              <svg viewBox="0 0 12 12" fill="rgba(235,235,245,0.4)" className="w-2.5 h-2.5">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
            {showLangMenu && (
              <div className="absolute right-0 top-10 glass squircle-md overflow-hidden z-30 card-shadow" style={{ minWidth: 120 }}>
                {(["EN", "KZ", "RU"] as Lang[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setShowLangMenu(false); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-white transition-colors"
                    style={{ background: lang === l ? "rgba(0,122,255,0.15)" : "transparent" }}
                  >
                    <span>{LANG_FLAGS[l]}</span>
                    <span>{l === "EN" ? "English" : l === "KZ" ? "Қазақша" : "Русский"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Upload Strip */}
        <div className="mt-3 flex items-center gap-2 px-3 py-2.5 squircle-sm" style={{ background: "rgba(94,92,230,0.1)", border: "1px dashed rgba(94,92,230,0.3)" }}>
          <svg viewBox="0 0 20 20" fill="#5E5CE6" className="w-4 h-4 shrink-0">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <p className="text-xs font-medium" style={{ color: "#7B79F7" }}>Upload syllabus PDF for smarter responses</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4">
        {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
        {typing && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="px-4 py-2 shrink-0">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s.replace(/^[^\s]+ /, ""))}
              className="shrink-0 px-3 py-1.5 squircle-sm text-xs font-medium whitespace-nowrap transition-opacity active:opacity-70"
              style={{ background: "rgba(28,28,30,0.9)", color: "rgba(235,235,245,0.7)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="px-4 pb-3 shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}>
        <div className="flex items-end gap-2.5">
          <div className="flex-1 flex items-center gap-2 px-4 py-3 squircle-lg" style={{ background: "rgba(28,28,30,0.9)", border: "1px solid rgba(255,255,255,0.1)", minHeight: 48 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask about courses, exams, GPA..."
              className="flex-1 bg-transparent text-sm text-white placeholder-opacity-40 outline-none"
              style={{ color: "white", fontSize: 14 }}
            />
          </div>
          <button
            onClick={() => send()}
            disabled={!input.trim() && !typing}
            className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{
              background: input.trim() ? "linear-gradient(135deg, #0033A0, #007AFF)" : "rgba(28,28,30,0.9)",
              border: input.trim() ? "none" : "1px solid rgba(255,255,255,0.08)",
              boxShadow: input.trim() ? "0 4px 16px rgba(0,122,255,0.35)" : "none",
            }}
          >
            <svg viewBox="0 0 20 20" fill={input.trim() ? "white" : "rgba(235,235,245,0.3)"} className="w-5 h-5" style={{ transform: "rotate(90deg)" }}>
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
