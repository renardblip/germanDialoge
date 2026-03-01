import { useState, useEffect, useRef, useCallback } from "react";

// ── Helpers ────────────────────────────────────────────────────────────────

function parseDialogue(raw) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const result = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z]):\s*(.+)$/);
    if (m) result.push({ speaker: m[1], text: m[2] });
  }
  return result;
}

function maskWords(text, ratio = 0.45) {
  const words = text.split(" ");
  // Mask important words (longer words = more likely content words)
  return words.map((word, i) => {
    const isLong = word.replace(/[^a-zA-ZäöüÄÖÜß]/g, "").length > 4;
    const shouldMask = isLong && Math.random() < ratio;
    return { word, masked: shouldMask };
  });
}

// ── TTS ────────────────────────────────────────────────────────────────────

function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState(0.85);
  const utterRef = useRef(null);

  const speak = useCallback((text, onEnd) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.rate = rate;
    u.onstart = () => setSpeaking(true);
    u.onend = () => { setSpeaking(false); onEnd && onEnd(); };
    u.onerror = () => setSpeaking(false);
    utterRef.current = u;
    window.speechSynthesis.speak(u);
  }, [rate]);

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  return { speak, stop, speaking, rate, setRate };
}

// ── Recording ──────────────────────────────────────────────────────────────

function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch (e) {
      alert("Mikrofon hozzáférés nem engedélyezett.");
    }
  }, []);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
    setRecording(false);
  }, []);

  return { start, stop, recording, audioUrl, clearAudio: () => setAudioUrl(null) };
}

// ── Local Storage ──────────────────────────────────────────────────────────

function getSaved() {
  try { return JSON.parse(localStorage.getItem("de_dialogues") || "[]"); } catch { return []; }
}
function save(list) {
  localStorage.setItem("de_dialogues", JSON.stringify(list));
}

// ── Constants ──────────────────────────────────────────────────────────────

const SAMPLE = `A: Guten Morgen! Wie geht es dir?
B: Mir geht es gut, danke. Und dir?
A: Auch gut. Was machst du heute?
B: Ich gehe zur Arbeit. Und du?
A: Ich lerne Deutsch. Es macht Spaß!
B: Das ist wunderbar! Viel Erfolg!`;

const LEVEL_INFO = [
  { id: 1, label: "Szint 1", name: "Teljes láthatóság", icon: "👁", color: "#4ade80", desc: "Saját szöveg halványítva látható" },
  { id: 2, label: "Szint 2", name: "Hiányos szöveg", icon: "✏️", color: "#facc15", desc: "Egyes szavak kitakarva" },
  { id: 3, label: "Szint 3", name: "Emlékezetből", icon: "🧠", color: "#f87171", desc: "Csak a partner hangját hallod" },
];

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("home"); // home | setup | practice
  const [rawText, setRawText] = useState(SAMPLE);
  const [dialogue, setDialogue] = useState([]);
  const [userRole, setUserRole] = useState("A");
  const [level, setLevel] = useState(1);
  const [lineIndex, setLineIndex] = useState(0);
  const [maskedWords, setMaskedWords] = useState([]);
  const [waitingUser, setWaitingUser] = useState(false);
  const [done, setDone] = useState(false);
  const [savedList, setSavedList] = useState(getSaved);
  const [streak, setStreak] = useState(0);
  const [showSaved, setShowSaved] = useState(false);

  const { speak, stop, speaking, rate, setRate } = useTTS();
  const { start, stop: stopRec, recording, audioUrl, clearAudio } = useRecorder();

  // Parse dialogue when entering practice
  const startPractice = () => {
    const d = parseDialogue(rawText);
    if (d.length === 0) return alert("Nem sikerült párbeszédet értelmezni. Ellenőrizd a formátumot (A: ... B: ...)");
    setDialogue(d);
    setLineIndex(0);
    setWaitingUser(false);
    setDone(false);
    clearAudio();

    // Save dialogue
    const title = d[0]?.text.slice(0, 40) + "…";
    const existing = getSaved();
    if (!existing.find((x) => x.raw === rawText)) {
      const updated = [{ raw: rawText, title, date: new Date().toLocaleDateString("hu") }, ...existing].slice(0, 10);
      save(updated);
      setSavedList(updated);
    }
    setScreen("practice");
  };

  // Advance through dialogue
  useEffect(() => {
    if (screen !== "practice" || done || dialogue.length === 0) return;
    const line = dialogue[lineIndex];
    if (!line) { setDone(true); return; }

    if (line.speaker !== userRole) {
      // Partner's line → TTS
      setWaitingUser(false);
      const delay = lineIndex === 0 ? 600 : 200;
      const t = setTimeout(() => {
        speak(line.text, () => {
          setTimeout(() => advance(), 400);
        });
      }, delay);
      return () => clearTimeout(t);
    } else {
      // User's line
      if (level === 2) {
        setMaskedWords(maskWords(line.text));
      }
      setWaitingUser(true);
    }
  }, [lineIndex, screen, dialogue, userRole, level, done]);

  const advance = () => {
    const next = lineIndex + 1;
    if (next >= dialogue.length) setDone(true);
    else setLineIndex(next);
  };

  const handleUserDone = () => {
    setWaitingUser(false);
    setStreak((s) => s + 1);
    if (recording) stopRec();
    advance();
  };

  const restart = () => {
    stop();
    setLineIndex(0);
    setWaitingUser(false);
    setDone(false);
    clearAudio();
  };

  const currentLine = dialogue[lineIndex];
  const speakers = [...new Set(dialogue.map((l) => l.speaker))];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{css}</style>

      {/* ── HOME ── */}
      {screen === "home" && (
        <div style={styles.page} className="fade-in">
          <div style={styles.hero}>
            <div style={styles.heroIcon}>🇩🇪</div>
            <h1 style={styles.heroTitle}>DeutschDialog</h1>
            <p style={styles.heroSub}>Párbeszéd-alapú német nyelvgyakorlás</p>
            <div style={styles.levelCards}>
              {LEVEL_INFO.map((l) => (
                <div key={l.id} style={{ ...styles.levelCard, borderColor: l.color }} className="card-hover">
                  <span style={styles.levelIcon}>{l.icon}</span>
                  <div>
                    <div style={{ ...styles.levelName, color: l.color }}>{l.name}</div>
                    <div style={styles.levelDesc}>{l.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button style={styles.primaryBtn} className="btn-hover" onClick={() => setScreen("setup")}>
              Kezdjük el →
            </button>
            {savedList.length > 0 && (
              <button style={styles.ghostBtn} onClick={() => setShowSaved((v) => !v)}>
                {showSaved ? "Elrejtés" : `📂 Mentett párbeszédek (${savedList.length})`}
              </button>
            )}
            {showSaved && (
              <div style={styles.savedList}>
                {savedList.map((item, i) => (
                  <div key={i} style={styles.savedItem} className="card-hover" onClick={() => {
                    setRawText(item.raw); setShowSaved(false); setScreen("setup");
                  }}>
                    <span style={styles.savedTitle}>{item.title}</span>
                    <span style={styles.savedDate}>{item.date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SETUP ── */}
      {screen === "setup" && (
        <div style={styles.page} className="fade-in">
          <button style={styles.backBtn} onClick={() => setScreen("home")}>← Vissza</button>
          <h2 style={styles.sectionTitle}>Párbeszéd beállítása</h2>

          <label style={styles.label}>Párbeszéd szövege</label>
          <textarea
            style={styles.textarea}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"A: ...\nB: ...\nA: ..."}
            rows={10}
          />
          <p style={styles.hint}>Formátum: <code>A: szöveg</code> vagy <code>B: szöveg</code> soronként</p>

          {/* Role select */}
          <label style={styles.label}>Melyik szerepet gyakorlod?</label>
          <div style={styles.row}>
            {speakers.length > 0
              ? speakers.map((s) => (
                  <button key={s} style={{ ...styles.chipBtn, ...(userRole === s ? styles.chipActive : {}) }}
                    onClick={() => setUserRole(s)}>Szereplő {s}</button>
                ))
              : ["A","B"].map((s) => (
                  <button key={s} style={{ ...styles.chipBtn, ...(userRole === s ? styles.chipActive : {}) }}
                    onClick={() => setUserRole(s)}>Szereplő {s}</button>
                ))
            }
          </div>

          {/* Level select */}
          <label style={styles.label}>Szint</label>
          <div style={styles.col}>
            {LEVEL_INFO.map((l) => (
              <button key={l.id}
                style={{ ...styles.levelBtn, ...(level === l.id ? { ...styles.levelBtnActive, borderColor: l.color, color: l.color } : {}) }}
                className="card-hover"
                onClick={() => setLevel(l.id)}>
                <span style={{ fontSize: 20 }}>{l.icon}</span>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{l.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Speed */}
          <label style={styles.label}>TTS sebesség: {rate.toFixed(2)}x</label>
          <input type="range" min="0.5" max="1.5" step="0.05" value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            style={styles.slider} />

          <button style={styles.primaryBtn} className="btn-hover" onClick={startPractice}>
            🎯 Gyakorlás indítása
          </button>
        </div>
      )}

      {/* ── PRACTICE ── */}
      {screen === "practice" && (
        <div style={styles.page} className="fade-in">
          <div style={styles.practiceHeader}>
            <button style={styles.backBtn} onClick={() => { stop(); setScreen("setup"); }}>← Beállítások</button>
            <div style={styles.streakBadge}>🔥 {streak}</div>
          </div>

          {/* Progress */}
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${(lineIndex / Math.max(dialogue.length,1)) * 100}%` }} />
          </div>

          <div style={styles.levelTag}>
            {LEVEL_INFO.find((l) => l.id === level)?.icon} {LEVEL_INFO.find((l) => l.id === level)?.name}
          </div>

          {/* Dialogue lines */}
          <div style={styles.dialogueBox}>
            {dialogue.map((line, i) => {
              const isUser = line.speaker === userRole;
              const isPast = i < lineIndex;
              const isCurrent = i === lineIndex;
              const isFuture = i > lineIndex;

              return (
                <div key={i} style={{
                  ...styles.lineWrap,
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  opacity: isFuture ? 0.2 : isPast ? 0.55 : 1,
                  transform: isCurrent ? "scale(1.01)" : "scale(1)",
                  transition: "all 0.3s ease",
                }}>
                  {!isUser && <div style={styles.speakerDot}>{line.speaker}</div>}
                  <div style={{
                    ...styles.bubble,
                    ...(isUser ? styles.bubbleUser : styles.bubblePartner),
                    opacity: isCurrent && isUser && level === 1 ? 0.45 : 1,
                  }}>
                    {isCurrent && isUser && level === 2
                      ? maskedWords.map((w, wi) => (
                          <span key={wi}>
                            {w.masked
                              ? <span style={styles.masked}>{"_".repeat(w.word.length)}</span>
                              : w.word
                            }{" "}
                          </span>
                        ))
                      : isCurrent && isUser && level === 3
                        ? <span style={{ fontStyle: "italic", opacity: 0.5 }}>Emlékezetből…</span>
                        : line.text
                    }
                  </div>
                  {isUser && <div style={{ ...styles.speakerDot, background: "#4ade80", color: "#000" }}>{line.speaker}</div>}
                </div>
              );
            })}
          </div>

          {/* Controls */}
          {!done ? (
            <div style={styles.controls}>
              {speaking && (
                <div style={styles.speakingIndicator}>
                  <div className="wave" /><div className="wave" /><div className="wave" />
                  <span>Partner beszél…</span>
                </div>
              )}

              {waitingUser && (
                <div style={styles.userTurn} className="fade-in">
                  <p style={styles.userTurnLabel}>🎙 A te sorod!</p>
                  <div style={styles.btnRow}>
                    {!recording
                      ? <button style={styles.recBtn} className="btn-hover" onClick={start}>⏺ Felvétel</button>
                      : <button style={{ ...styles.recBtn, background: "#f87171" }} onClick={stopRec}>⏹ Stop</button>
                    }
                    <button style={styles.primaryBtn} className="btn-hover" onClick={handleUserDone}>
                      ✓ Kész, tovább
                    </button>
                  </div>
                  {audioUrl && (
                    <div style={styles.audioPlayer}>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>Visszahallgatás:</span>
                      <audio controls src={audioUrl} style={{ height: 32 }} />
                    </div>
                  )}
                </div>
              )}

              <button style={styles.ghostBtn} onClick={() => {
                const line = dialogue[lineIndex];
                if (line && line.speaker !== userRole) speak(line.text, () => {});
              }}>🔁 Újrajátszás</button>
            </div>
          ) : (
            <div style={styles.doneBox} className="fade-in">
              <div style={styles.doneIcon}>🎉</div>
              <h3 style={styles.doneTitle}>Párbeszéd vége!</h3>
              <p style={styles.doneText}>Streak: 🔥 {streak} &nbsp;|&nbsp; Szint: {level}/3</p>
              {level < 3 && (
                <button style={{ ...styles.primaryBtn, background: "#facc15", color: "#000" }}
                  onClick={() => { setLevel((l) => Math.min(l + 1, 3)); restart(); }}>
                  ⬆ Következő szint
                </button>
              )}
              <button style={styles.primaryBtn} className="btn-hover" onClick={restart}>🔄 Újra</button>
              <button style={styles.ghostBtn} onClick={() => { stop(); setScreen("setup"); }}>⚙ Beállítások</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = {
  root: {
    minHeight: "100vh",
    background: "#0a0a0f",
    color: "#e8e4d9",
    fontFamily: "'Crimson Pro', Georgia, serif",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
  },
  page: {
    width: "100%",
    maxWidth: 480,
    padding: "24px 20px 48px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    paddingTop: 32,
  },
  heroIcon: { fontSize: 64 },
  heroTitle: {
    margin: 0,
    fontSize: 40,
    fontWeight: 700,
    letterSpacing: "-1px",
    background: "linear-gradient(135deg, #e8e4d9 30%, #4ade80)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  heroSub: { margin: 0, fontSize: 15, opacity: 0.55, fontStyle: "italic" },
  levelCards: { display: "flex", flexDirection: "column", gap: 8, width: "100%", marginTop: 8 },
  levelCard: {
    display: "flex", alignItems: "center", gap: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid",
    borderRadius: 12,
    padding: "12px 16px",
    cursor: "default",
  },
  levelIcon: { fontSize: 22 },
  levelName: { fontWeight: 700, fontSize: 14 },
  levelDesc: { fontSize: 12, opacity: 0.6 },
  primaryBtn: {
    background: "#4ade80",
    color: "#000",
    border: "none",
    borderRadius: 12,
    padding: "14px 28px",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    width: "100%",
    letterSpacing: "0.3px",
  },
  ghostBtn: {
    background: "transparent",
    color: "#e8e4d9",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 12,
    padding: "12px 20px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
    width: "100%",
  },
  backBtn: {
    background: "none", border: "none", color: "#888", cursor: "pointer",
    fontSize: 14, fontFamily: "inherit", padding: 0, alignSelf: "flex-start",
  },
  sectionTitle: { margin: 0, fontSize: 24, fontWeight: 700 },
  label: { fontSize: 13, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.8px" },
  textarea: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 12,
    color: "#e8e4d9",
    fontFamily: "'Courier New', monospace",
    fontSize: 14,
    padding: 16,
    resize: "vertical",
    outline: "none",
    lineHeight: 1.7,
  },
  hint: { margin: 0, fontSize: 12, opacity: 0.45 },
  row: { display: "flex", gap: 10 },
  col: { display: "flex", flexDirection: "column", gap: 8 },
  chipBtn: {
    flex: 1, padding: "10px 16px", borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: "transparent", color: "#e8e4d9",
    cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600,
  },
  chipActive: { background: "#4ade80", color: "#000", borderColor: "#4ade80" },
  levelBtn: {
    display: "flex", alignItems: "center", gap: 14,
    padding: "12px 16px", borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.03)",
    color: "#e8e4d9", cursor: "pointer", fontFamily: "inherit",
    textAlign: "left",
  },
  levelBtnActive: { background: "rgba(74,222,128,0.08)" },
  slider: { width: "100%", accentColor: "#4ade80" },
  savedList: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
  savedItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10, padding: "10px 14px", cursor: "pointer",
  },
  savedTitle: { fontSize: 13, flex: 1, marginRight: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  savedDate: { fontSize: 11, opacity: 0.45 },
  practiceHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  streakBadge: {
    background: "rgba(255,150,0,0.15)", border: "1px solid rgba(255,150,0,0.3)",
    borderRadius: 20, padding: "4px 12px", fontSize: 14, fontWeight: 700,
  },
  progressBar: { height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: "100%", background: "#4ade80", transition: "width 0.4s ease", borderRadius: 4 },
  levelTag: {
    fontSize: 12, opacity: 0.5, textAlign: "center",
    fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
  },
  dialogueBox: {
    display: "flex", flexDirection: "column", gap: 12,
    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 16, padding: 16, minHeight: 200, maxHeight: 380, overflowY: "auto",
  },
  lineWrap: { display: "flex", alignItems: "flex-end", gap: 8 },
  speakerDot: {
    width: 28, height: 28, borderRadius: "50%",
    background: "rgba(255,255,255,0.12)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 700, flexShrink: 0,
  },
  bubble: {
    maxWidth: "78%", padding: "10px 14px",
    borderRadius: 14, fontSize: 15, lineHeight: 1.5,
    fontFamily: "'Crimson Pro', Georgia, serif",
  },
  bubblePartner: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderBottomLeftRadius: 4,
  },
  bubbleUser: {
    background: "rgba(74,222,128,0.12)",
    border: "1px solid rgba(74,222,128,0.25)",
    color: "#c8f7d8",
    borderBottomRightRadius: 4,
  },
  masked: {
    background: "rgba(250,204,21,0.25)", borderRadius: 3,
    padding: "1px 4px", color: "#facc15", fontFamily: "monospace", letterSpacing: 2,
  },
  controls: { display: "flex", flexDirection: "column", gap: 12 },
  speakingIndicator: {
    display: "flex", alignItems: "center", gap: 8,
    fontSize: 13, opacity: 0.6, justifyContent: "center",
  },
  userTurn: {
    background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.2)",
    borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12,
  },
  userTurnLabel: { margin: 0, fontWeight: 700, fontSize: 15, color: "#4ade80" },
  btnRow: { display: "flex", gap: 10 },
  recBtn: {
    flex: 1, background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.3)",
    color: "#f87171", borderRadius: 10, padding: "12px", fontSize: 14,
    fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  audioPlayer: {
    display: "flex", flexDirection: "column", gap: 6,
    background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 10,
  },
  doneBox: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
    background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.15)",
    borderRadius: 20, padding: 28,
  },
  doneIcon: { fontSize: 56 },
  doneTitle: { margin: 0, fontSize: 24, fontWeight: 700 },
  doneText: { margin: 0, opacity: 0.55, fontSize: 14 },
};

// ── Global CSS ────────────────────────────────────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400&display=swap');

  * { box-sizing: border-box; }
  body { margin: 0; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

  .fade-in { animation: fadeIn 0.4s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  .btn-hover { transition: transform 0.15s ease, box-shadow 0.15s ease; }
  .btn-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 24px rgba(74,222,128,0.25); }
  .btn-hover:active { transform: translateY(0); }

  .card-hover { transition: background 0.2s ease; }
  .card-hover:hover { background: rgba(255,255,255,0.07) !important; }

  .wave {
    width: 4px; height: 16px;
    background: #4ade80; border-radius: 2px;
    animation: waveAnim 0.8s ease-in-out infinite;
  }
  .wave:nth-child(2) { animation-delay: 0.15s; }
  .wave:nth-child(3) { animation-delay: 0.3s; }
  @keyframes waveAnim {
    0%, 100% { transform: scaleY(0.4); }
    50% { transform: scaleY(1.2); }
  }

  textarea:focus { border-color: rgba(74,222,128,0.4) !important; }
  input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.12); }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #4ade80; cursor: pointer; }
`;
