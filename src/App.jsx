import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { SEED_CARDS } from "./cards/index.js";

// ─── SM-2 Algorithm ─────────────────────────────────────────────────
function sm2(card, quality) {
  let { easeFactor, interval, repetitions } = card;
  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 3;
    else interval = Math.round(interval * easeFactor);
    repetitions += 1;
  } else { repetitions = 0; interval = 1; }
  easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  return { ...card, easeFactor, interval, repetitions, nextReview: Date.now() + interval * 86400000, lastReview: Date.now() };
}

// ─── Storage ────────────────────────────────────────────────────────
function save(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error("Save:", e); } }
function load(key, fb) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch { return fb; } }

// ─── Constants ──────────────────────────────────────────────────────
const MODULES = ["Public Law", "Criminal Law", "Contract Law", "Tort", "Commercial Law", "Property Law", "Jurisprudence", "Equity & Trusts", "Evidence"];
const CARD_TYPES = { principle: "Principle", case: "Case", application: "Application", distinction: "Distinction" };
const TYPE_COLORS = { principle: "#D4A574", case: "#7BA5C4", application: "#8BB874", distinction: "#C49BBD" };
// ─── Helpers ────────────────────────────────────────────────────────
function getDue(cards) { return cards.filter(c => c.nextReview <= Date.now()).sort((a, b) => a.nextReview - b.nextReview); }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function truncate(s, n) { if (!s) return ""; return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
function isSeedId(id) { return SEED_CARDS.some(c => c.id === id); }
function isUserCard(card) { return !isSeedId(card.id); }

// Build distractors: 3 from same type (+ same module preferred), fall back to same-type any-module.
function buildMcqOptions(card, allCards) {
  const sameTypeModule = allCards.filter(c => c.id !== card.id && c.type === card.type && c.module === card.module && c.back);
  const sameType = allCards.filter(c => c.id !== card.id && c.type === card.type && c.back);
  let pool = sameTypeModule.length >= 3 ? sameTypeModule : sameType;
  const pickedBacks = new Set([card.back]);
  const distractors = [];
  for (const c of shuffle(pool)) {
    if (distractors.length >= 3) break;
    if (pickedBacks.has(c.back)) continue;
    pickedBacks.add(c.back);
    distractors.push(c);
  }
  // If still under 3 (tiny pools), widen to any card of any type.
  if (distractors.length < 3) {
    for (const c of shuffle(allCards.filter(c => c.id !== card.id && c.back && !pickedBacks.has(c.back)))) {
      if (distractors.length >= 3) break;
      pickedBacks.add(c.back);
      distractors.push(c);
    }
  }
  const correct = { text: card.back, correct: true };
  const opts = distractors.map(c => ({ text: c.back, correct: false }));
  return shuffle([correct, ...opts]);
}

// ─── App ────────────────────────────────────────────────────────────
export default function InterAlia() {
  const [cards, setCards] = useState(SEED_CARDS);
  const [view, setView] = useState("loading");
  const [reviewQueue, setReviewQueue] = useState([]);
  const [queueMeta, setQueueMeta] = useState({ label: "", mode: "due" }); // due | new
  const [currentIdx, setCurrentIdx] = useState(0);
  const [mcqOptions, setMcqOptions] = useState([]);
  const [selectedOpt, setSelectedOpt] = useState(null); // index or null
  const [expandedRelated, setExpandedRelated] = useState({}); // { cardId: true }
  const [moduleFilter, setModuleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ccFilter, setCcFilter] = useState("all");
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, correct: 0, results: [] });
  const [addForm, setAddForm] = useState({ type: "principle", module: MODULES[0], tags: "", front: "", back: "", details: "", crossCutting: false });
  const [searchTerm, setSearchTerm] = useState("");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState({ principle: true, case: true, application: true, distinction: true });
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef(null);

  const stats = useMemo(() => {
    const now = Date.now();
    return { due: cards.filter(c => c.nextReview <= now && c.repetitions > 0).length + cards.filter(c => c.nextReview <= now && c.repetitions === 0 && c.lastReview > 0).length, dueIncludingNew: cards.filter(c => c.nextReview <= now).length, learning: cards.filter(c => c.repetitions > 0 && c.repetitions < 3).length, mature: cards.filter(c => c.repetitions >= 3).length, new: cards.filter(c => c.repetitions === 0 && c.lastReview === 0).length, total: cards.length, crossCutting: cards.filter(c => c.crossCutting).length };
  }, [cards]);

  // Strict "due": cards seen before whose nextReview has passed.
  const strictDue = useMemo(() => cards.filter(c => c.lastReview > 0 && c.nextReview <= Date.now()), [cards]);

  // Card lookup for related-link resolution.
  const cardById = useMemo(() => { const m = {}; for (const c of cards) m[c.id] = c; return m; }, [cards]);

  // Load
  useEffect(() => {
    const d = load("interalia-all", null);
    let nextCards = SEED_CARDS.map(c => ({ ...c, related: c.related || [] }));
    if (d?.cards?.length) {
      // Merge saved progress onto current seed, preserve user-added cards.
      const savedById = {}; for (const c of d.cards) savedById[c.id] = c;
      nextCards = nextCards.map(c => {
        const s = savedById[c.id];
        return s ? { ...c, easeFactor: s.easeFactor ?? c.easeFactor, interval: s.interval ?? c.interval, repetitions: s.repetitions ?? c.repetitions, nextReview: s.nextReview ?? c.nextReview, lastReview: s.lastReview ?? c.lastReview } : c;
      });
      // User-added cards (not in seed).
      const seedIds = new Set(SEED_CARDS.map(c => c.id));
      for (const c of d.cards) if (!seedIds.has(c.id)) nextCards.push({ ...c, related: c.related || [] });
    }
    setCards(nextCards);
    if (d?.history?.length) setHistory(d.history);
    setLoaded(true); setView("dashboard");
  }, []);

  // Save
  useEffect(() => { if (loaded) save("interalia-all", { cards, history }); }, [cards, history, loaded]);

  // ─── Review flow ──────────────────────────────────────────────────
  const prepareQueue = useCallback((pool, modeHint) => {
    if (!pool.length) return;
    const due = getDue(pool).filter(c => c.lastReview > 0);
    let queue, mode, label;
    if (modeHint === "new") {
      queue = pool.filter(c => c.lastReview === 0).slice(0, 20);
      mode = "new"; label = `New: ${queue.length} cards`;
    } else if (due.length) {
      queue = due;
      mode = "due"; label = `Review: ${queue.length} due`;
    } else {
      // Ask user to opt in to new cards.
      const newCards = pool.filter(c => c.lastReview === 0);
      if (!newCards.length) return;
      if (!confirm(`Nothing due. Would you like to study ${Math.min(20, newCards.length)} new cards?`)) return;
      queue = newCards.slice(0, 20);
      mode = "new"; label = `New: ${queue.length} cards`;
    }
    if (!queue.length) return;
    setReviewQueue(queue);
    setQueueMeta({ label, mode });
    setCurrentIdx(0);
    setSelectedOpt(null);
    setExpandedRelated({});
    setMcqOptions(buildMcqOptions(queue[0], cards));
    setSessionStats({ reviewed: 0, correct: 0, results: [] });
    setView("review");
    setSelectedModule(null);
  }, [cards]);

  const startReview = useCallback((mode, value, typeFilter) => {
    let pool;
    if (mode === "cross") pool = shuffle(cards.filter(c => c.crossCutting));
    else if (mode === "module") pool = value === "all" ? cards : cards.filter(c => c.module === value);
    else pool = cards;
    if (typeFilter) pool = pool.filter(c => typeFilter[c.type]);
    prepareQueue(pool);
  }, [cards, prepareQueue]);

  const answerCard = useCallback((optIdx) => {
    if (selectedOpt !== null) return;
    setSelectedOpt(optIdx);
    const card = reviewQueue[currentIdx];
    const correct = mcqOptions[optIdx]?.correct;
    const quality = correct ? 4 : 1;
    setCards(prev => prev.map(c => c.id === card.id ? sm2(c, quality) : c));
    setHistory(prev => [...prev, { cardId: card.id, q: quality, correct, ts: Date.now() }]);
    setSessionStats(s => ({ reviewed: s.reviewed + 1, correct: s.correct + (correct ? 1 : 0), results: [...s.results, correct] }));
  }, [selectedOpt, reviewQueue, currentIdx, mcqOptions]);

  const nextCard = useCallback(() => {
    if (currentIdx < reviewQueue.length - 1) {
      const nextIdx = currentIdx + 1;
      setCurrentIdx(nextIdx);
      setSelectedOpt(null);
      setExpandedRelated({});
      setMcqOptions(buildMcqOptions(reviewQueue[nextIdx], cards));
    } else {
      setView("summary");
    }
  }, [currentIdx, reviewQueue, cards]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────
  useEffect(() => {
    if (view !== "review") return;
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Escape") { setView("dashboard"); return; }
      if (selectedOpt === null) {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= 4 && mcqOptions[n - 1]) { e.preventDefault(); answerCard(n - 1); }
      } else {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); nextCard(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, selectedOpt, mcqOptions, answerCard, nextCard]);

  // ─── Add / reset ──────────────────────────────────────────────────
  const addCard = useCallback(() => {
    if (!addForm.front || !addForm.back || !addForm.module) return;
    setCards(prev => [...prev, { id: "u-" + Date.now(), type: addForm.type, module: addForm.module, tags: addForm.tags.split(",").map(t => t.trim()).filter(Boolean), crossCutting: addForm.crossCutting, front: addForm.front, back: addForm.back, details: addForm.details, related: [], easeFactor: 2.5, interval: 0, repetitions: 0, nextReview: 0, lastReview: 0 }]);
    setAddForm({ type: "principle", module: MODULES[0], tags: "", front: "", back: "", details: "", crossCutting: false });
  }, [addForm]);

  const resetProgress = useCallback(() => {
    if (!confirm("Reset all review progress? Cards kept.")) return;
    setCards(prev => prev.map(c => ({ ...c, easeFactor: 2.5, interval: 0, repetitions: 0, nextReview: 0, lastReview: 0 })));
    setHistory([]);
  }, []);

  // ─── Export / import ──────────────────────────────────────────────
  const exportData = useCallback(() => {
    const userCards = cards.filter(isUserCard);
    const seedProgress = cards.filter(c => isSeedId(c.id) && c.lastReview > 0).map(c => ({ id: c.id, easeFactor: c.easeFactor, interval: c.interval, repetitions: c.repetitions, nextReview: c.nextReview, lastReview: c.lastReview }));
    const payload = { version: 1, exportedAt: Date.now(), userCards, seedProgress, history };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `interalia-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [cards, history]);

  const importData = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || typeof data !== "object") throw new Error("Invalid file");
        const userCards = Array.isArray(data.userCards) ? data.userCards : [];
        const seedProgress = Array.isArray(data.seedProgress) ? data.seedProgress : [];
        const importedHistory = Array.isArray(data.history) ? data.history : [];
        setCards(prev => {
          const progressById = {}; for (const p of seedProgress) progressById[p.id] = p;
          const merged = prev.map(c => {
            if (isSeedId(c.id) && progressById[c.id]) return { ...c, ...progressById[c.id] };
            return c;
          });
          // Remove existing user cards then add imported ones.
          const onlySeed = merged.filter(c => isSeedId(c.id));
          const importedUsers = userCards.map(c => ({ ...c, related: c.related || [] }));
          return [...onlySeed, ...importedUsers];
        });
        setHistory(importedHistory);
        setImportMsg(`Imported ${userCards.length} user cards, ${seedProgress.length} progress records, ${importedHistory.length} history entries.`);
        setTimeout(() => setImportMsg(""), 4000);
      } catch (err) {
        setImportMsg("Import failed: " + err.message);
        setTimeout(() => setImportMsg(""), 4000);
      }
    };
    reader.readAsText(file);
  }, []);

  // ─── Derived: filtered library, history viz ──────────────────────
  const filtered = useMemo(() => cards.filter(c => {
    if (moduleFilter !== "all" && c.module !== moduleFilter) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (ccFilter === "cross" && !c.crossCutting) return false;
    if (ccFilter === "single" && c.crossCutting) return false;
    if (searchTerm) { const s = searchTerm.toLowerCase(); return c.front.toLowerCase().includes(s) || c.back.toLowerCase().includes(s) || c.tags?.some(t => t.toLowerCase().includes(s)); }
    return true;
  }), [cards, moduleFilter, typeFilter, ccFilter, searchTerm]);

  const historyViz = useMemo(() => {
    const days = 14;
    const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today0 = startOfDay(Date.now());
    const perDay = new Array(days).fill(0);
    const daySet = new Set();
    for (const h of history) {
      const dayStart = startOfDay(h.ts);
      daySet.add(dayStart);
      const diff = Math.round((today0 - dayStart) / 86400000);
      if (diff >= 0 && diff < days) perDay[days - 1 - diff] += 1;
    }
    // Streak
    let streak = 0;
    for (let i = 0; ; i++) {
      const d = today0 - i * 86400000;
      if (daySet.has(d)) streak += 1;
      else if (i === 0) continue; // today may have no reviews; still count yesterday streak
      else break;
    }
    return { perDay, total: history.length, streak, max: Math.max(1, ...perDay) };
  }, [history]);

  // ─── Styles ─────────────────────────────────────────────────────
  const S = {
    app: { fontFamily: "'Newsreader', Georgia, serif", minHeight: "100vh", background: "#111113", color: "#d4d0c8", maxWidth: 680, margin: "0 auto", padding: "20px 16px" },
    hdr: { display: "flex", alignItems: "baseline", justifyContent: "space-between", borderBottom: "1px solid rgba(212,165,116,0.12)", paddingBottom: 12, marginBottom: 22 },
    logo: { fontSize: 23, fontWeight: 700, letterSpacing: "-0.02em", color: "#D4A574", cursor: "pointer" },
    nav: { display: "flex", gap: 2, flexWrap: "wrap" },
    nb: (a) => ({ background: a ? "rgba(212,165,116,0.1)" : "transparent", border: a ? "1px solid rgba(212,165,116,0.2)" : "1px solid transparent", color: a ? "#D4A574" : "#5a5650", padding: "4px 10px", borderRadius: 5, cursor: "pointer", fontSize: 12, fontFamily: "'Newsreader', Georgia, serif" }),
    card: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 20, marginBottom: 12 },
    bdg: (c) => ({ display: "inline-block", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 14, background: `${c}12`, color: c, textTransform: "uppercase", fontFamily: "system-ui, sans-serif", letterSpacing: "0.03em" }),
    tag: { display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 14, background: "rgba(255,255,255,0.03)", color: "#5a5650", marginLeft: 4 },
    ccTag: { display: "inline-block", fontSize: 10, padding: "2px 7px", borderRadius: 14, background: "rgba(196,155,189,0.07)", color: "#b088a8", marginLeft: 4 },
    btn: (v = "p") => ({ padding: "8px 15px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontFamily: "'Newsreader', Georgia, serif", fontWeight: 500, border: "none", ...(v === "p" ? { background: "rgba(212,165,116,0.1)", color: "#D4A574", border: "1px solid rgba(212,165,116,0.2)" } : v === "d" ? { background: "rgba(200,70,70,0.08)", color: "#b85050", border: "1px solid rgba(200,70,70,0.12)" } : { background: "transparent", color: "#5a5650", border: "1px solid rgba(255,255,255,0.05)" }) }),
    mcq: (state) => {
      // state: idle | selected-right | selected-wrong | reveal-right | reveal-wrong-faded
      const base = { display: "flex", alignItems: "flex-start", gap: 8, width: "100%", minHeight: "auto", height: "auto", textAlign: "left", padding: "12px 14px", borderRadius: 7, cursor: state === "idle" ? "pointer" : "default", fontSize: 13.5, fontFamily: "'Newsreader', Georgia, serif", lineHeight: 1.55, marginBottom: 8, transition: "all 0.2s ease", boxSizing: "border-box", whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "break-word" };
      if (state === "idle") return { ...base, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", color: "#d4d0c8" };
      if (state === "selected-right") return { ...base, background: "rgba(120,160,96,0.15)", border: "1px solid rgba(120,160,96,0.5)", color: "#a6c68a" };
      if (state === "selected-wrong") return { ...base, background: "rgba(200,72,72,0.15)", border: "1px solid rgba(200,72,72,0.5)", color: "#d48080" };
      if (state === "reveal-right") return { ...base, background: "rgba(120,160,96,0.1)", border: "1px solid rgba(120,160,96,0.4)", color: "#8bb874" };
      return { ...base, background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.03)", color: "#4a4640", opacity: 0.55 };
    },
    inp: { width: "100%", padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 13, fontFamily: "'Newsreader', Georgia, serif", outline: "none", boxSizing: "border-box" },
    ta: { width: "100%", padding: "8px 10px", borderRadius: 6, minHeight: 64, resize: "vertical", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 13, fontFamily: "'Newsreader', Georgia, serif", outline: "none", boxSizing: "border-box", lineHeight: 1.6 },
    sel: { padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 11.5, fontFamily: "'Newsreader', Georgia, serif", outline: "none", cursor: "pointer" },
    sec: { fontSize: 11.5, color: "#5a5650", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "system-ui, sans-serif" },
    sb: { textAlign: "center", padding: 11, background: "rgba(255,255,255,0.015)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.025)" },
    footer: { marginTop: 32, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.04)", textAlign: "center", fontSize: 10.5, color: "#3a3830", fontFamily: "system-ui, sans-serif", letterSpacing: "0.04em" },
  };

  if (view === "loading") return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
      <div style={{ textAlign: "center" }}><div style={S.logo}>Inter Alia</div><div style={{ color: "#5a5650", fontSize: 13, marginTop: 6 }}>Loading...</div></div>
    </div>
  );

  // ─── Dashboard ──────────────────────────────────────────────────
  const Dash = () => {
    const today = history.filter(h => h.ts > Date.now() - 86400000).length;
    const dueCount = strictDue.length;
    return (<div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, color: "#e8e4dc", marginBottom: 2, fontWeight: 500 }}>Review Queue</h2>
        <p style={{ color: "#5a5650", fontSize: 12.5, margin: 0 }}>{dueCount > 0 ? `${dueCount} due` : "Nothing due"}{today > 0 ? ` · ${today} today` : ""}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, marginBottom: 22 }}>
        {[[dueCount, "Due", "#D4A574"], [stats.new, "New", "#b088a8"], [stats.learning, "Learning", "#7BA5C4"], [stats.mature, "Mature", "#8BB874"]].map(([n, l, c]) => (
          <div key={l} style={S.sb}><div style={{ fontSize: 24, fontWeight: 700, color: c }}>{n}</div><div style={{ fontSize: 10, color: "#5a5650", marginTop: 1, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "system-ui" }}>{l}</div></div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 22, flexWrap: "wrap" }}>
        <button style={S.btn("p")} onClick={() => startReview("module", "all")}>
          {dueCount > 0 ? `Review Due (${dueCount})` : `Study New`}
        </button>
        <button style={{ ...S.btn("p"), background: "rgba(176,136,168,0.08)", color: "#b088a8", border: "1px solid rgba(176,136,168,0.18)" }} onClick={() => startReview("cross")}>
          Cross-cutting ({stats.crossCutting})
        </button>
        <button style={S.btn("g")} onClick={resetProgress}>Reset</button>
      </div>

      {/* History viz */}
      {historyViz.total > 0 && (
        <div style={{ ...S.card, padding: "14px 16px", marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <div style={S.sec}>Activity · last 14 days</div>
            <div style={{ fontSize: 11, color: "#5a5650", fontFamily: "system-ui" }}>
              <span style={{ color: "#D4A574" }}>{historyViz.total}</span> all-time · <span style={{ color: "#8BB874" }}>{historyViz.streak}</span>d streak
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 42 }}>
            {historyViz.perDay.map((n, i) => (
              <div key={i} title={`${n} reviews`} style={{ flex: 1, height: `${Math.max(3, (n / historyViz.max) * 100)}%`, background: n > 0 ? "rgba(212,165,116,0.5)" : "rgba(255,255,255,0.04)", borderRadius: 2, minHeight: 3 }} />
            ))}
          </div>
        </div>
      )}

      <div style={S.sec}>By Module</div>
      <div style={{ display: "grid", gap: 5, marginBottom: 6 }}>
        {MODULES.map(m => { const mc = cards.filter(c => c.module === m); const md = mc.filter(c => c.lastReview > 0 && c.nextReview <= Date.now()).length; const isOpen = selectedModule === m; if (!mc.length) return (
          <div key={m} style={{ ...S.card, padding: "11px 14px", marginBottom: 0, opacity: 0.4 }}>
            <div style={{ fontSize: 13.5, color: "#8a8680" }}>{m}</div>
            <div style={{ fontSize: 10.5, color: "#5a5650" }}>No cards yet</div>
          </div>
        ); return (
          <div key={m} style={{ ...S.card, padding: "11px 14px", marginBottom: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => { setSelectedModule(isOpen ? null : m); setSelectedTypes({ principle: true, case: true, application: true, distinction: true }); }}>
              <div><div style={{ fontSize: 13.5, color: "#e8e4dc", fontWeight: 500 }}>{m}</div><div style={{ fontSize: 10.5, color: "#5a5650", marginTop: 1 }}>{mc.length} cards · {md} due</div></div>
              <div style={{ color: "#D4A574", fontSize: 12 }}>{isOpen ? "▾" : "→"}</div>
            </div>
            {isOpen && (<div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              <div style={{ fontSize: 10, color: "#5a5650", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "system-ui" }}>Card types to review</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                {Object.entries(CARD_TYPES).map(([k, v]) => { const count = mc.filter(c => c.type === k).length; const active = selectedTypes[k]; return (
                  <button key={k} onClick={() => setSelectedTypes(prev => ({ ...prev, [k]: !prev[k] }))} style={{ padding: "5px 11px", borderRadius: 5, cursor: count ? "pointer" : "default", fontSize: 11, fontFamily: "'Newsreader', Georgia, serif", border: active && count ? `1px solid ${TYPE_COLORS[k]}44` : "1px solid rgba(255,255,255,0.04)", background: active && count ? `${TYPE_COLORS[k]}10` : "transparent", color: active && count ? TYPE_COLORS[k] : "#3a3830", opacity: count ? 1 : 0.35 }} disabled={!count}>
                    {v} ({count})
                  </button>
                ); })}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button style={{ ...S.btn("p"), fontSize: 12, padding: "6px 14px", opacity: Object.values(selectedTypes).some(Boolean) ? 1 : 0.3 }} disabled={!Object.values(selectedTypes).some(Boolean)} onClick={() => startReview("module", m, selectedTypes)}>
                  Start Review ({mc.filter(c => selectedTypes[c.type]).length})
                </button>
                <button style={{ ...S.btn("g"), fontSize: 11, padding: "5px 10px" }} onClick={() => setSelectedModule(null)}>Cancel</button>
              </div>
            </div>)}
          </div>
        ); })}
      </div>

      {/* Export / Import */}
      <div style={{ marginTop: 20, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...S.sec, marginBottom: 0, marginRight: 6 }}>Data</div>
        <button style={{ ...S.btn("g"), fontSize: 11, padding: "5px 10px" }} onClick={exportData}>Export JSON</button>
        <button style={{ ...S.btn("g"), fontSize: 11, padding: "5px 10px" }} onClick={() => fileInputRef.current?.click()}>Import JSON</button>
        <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ""; }} />
        {importMsg && <span style={{ fontSize: 11, color: "#8BB874", fontFamily: "system-ui" }}>{importMsg}</span>}
      </div>
    </div>);
  };

  // ─── Review ─────────────────────────────────────────────────────
  const Rev = () => {
    const card = reviewQueue[currentIdx];
    if (!card) return <div style={{ color: "#5a5650", padding: 28, textAlign: "center" }}>No cards.</div>;
    const answered = selectedOpt !== null;
    const chosenCorrect = answered && mcqOptions[selectedOpt]?.correct;
    const cardIsDue = card.lastReview > 0 && card.nextReview <= Date.now();

    const optState = (i) => {
      if (!answered) return "idle";
      const opt = mcqOptions[i];
      if (i === selectedOpt) return opt.correct ? "selected-right" : "selected-wrong";
      if (opt.correct) return "reveal-right";
      return "reveal-wrong-faded";
    };

    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#5a5650" }}>
          {currentIdx + 1} / {reviewQueue.length}
          <span style={{ marginLeft: 8, fontSize: 9.5, padding: "1px 7px", borderRadius: 10, background: cardIsDue ? "rgba(212,165,116,0.1)" : "rgba(176,136,168,0.08)", color: cardIsDue ? "#D4A574" : "#b088a8", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "system-ui" }}>{cardIsDue ? "Due" : "New"}</span>
        </span>
        <button style={S.btn("g")} onClick={() => setView("dashboard")}>✕ End</button>
      </div>
      <div style={{ height: 2, background: "rgba(255,255,255,0.03)", borderRadius: 1, marginBottom: 20 }}>
        <div style={{ height: "100%", background: "#D4A574", borderRadius: 1, transition: "width 0.3s", width: `${(currentIdx / reviewQueue.length) * 100}%` }} />
      </div>
      <div style={S.card}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={S.bdg(TYPE_COLORS[card.type])}>{CARD_TYPES[card.type]}</span>
          <span style={S.tag}>{card.module}</span>
          {card.crossCutting && <span style={S.ccTag}>⬡ Cross-cutting</span>}
        </div>
        <div style={{ fontSize: 15.5, lineHeight: 1.65, marginTop: 14, marginBottom: 18, color: "#e8e4dc" }}>{card.front}</div>

        {/* MCQ options */}
        <div>
          {mcqOptions.map((opt, i) => (
            <button key={i} disabled={answered} onClick={() => answerCard(i)} style={S.mcq(optState(i))}>
              <span style={{ flexShrink: 0, width: 18, color: "#5a5650", fontFamily: "system-ui", fontSize: 11, paddingTop: 2 }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0 }}>{opt.text}</span>
            </button>
          ))}
        </div>

        {/* Feedback + details + related */}
        {answered && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: chosenCorrect ? "#8BB874" : "#c47070", marginBottom: 10, fontFamily: "system-ui", letterSpacing: "0.03em", textTransform: "uppercase" }}>
              {chosenCorrect ? "✓ Correct" : "✗ Incorrect"}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7, color: "#c4c0b8", padding: 15, background: "rgba(212,165,116,0.025)", borderLeft: "3px solid rgba(212,165,116,0.25)", borderRadius: "0 6px 6px 0", marginBottom: 12 }}>{card.back}</div>
            {card.details && (
              <div style={{ fontSize: 12.5, lineHeight: 1.75, color: "#8a8680", padding: 13, background: "rgba(255,255,255,0.015)", borderRadius: 6, marginBottom: 12 }}>{card.details}</div>
            )}
            {card.related?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: "#5a5650", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "system-ui" }}>Related</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {card.related.map(rid => { const r = cardById[rid]; if (!r) return null; const exp = expandedRelated[rid]; return (
                    <div key={rid} style={{ flex: "1 1 100%" }}>
                      <button onClick={() => setExpandedRelated(e => ({ ...e, [rid]: !e[rid] }))} style={{ ...S.btn("g"), fontSize: 11, padding: "5px 10px", textAlign: "left", width: "100%", borderColor: "rgba(176,136,168,0.18)", color: "#b088a8", background: "rgba(176,136,168,0.05)" }}>
                        {exp ? "▾" : "▸"} {truncate(r.front, 120)}
                      </button>
                      {exp && (
                        <div style={{ marginTop: 4, marginBottom: 4, padding: 11, background: "rgba(176,136,168,0.04)", border: "1px solid rgba(176,136,168,0.1)", borderRadius: 6 }}>
                          <div style={{ display: "flex", gap: 4, marginBottom: 6, flexWrap: "wrap" }}>
                            <span style={S.bdg(TYPE_COLORS[r.type])}>{CARD_TYPES[r.type]}</span>
                            <span style={S.tag}>{r.module}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: "#c4c0b8", lineHeight: 1.6, marginBottom: 6 }}>{r.back}</div>
                          {r.details && <div style={{ fontSize: 11.5, color: "#6a6660", lineHeight: 1.6, fontStyle: "italic" }}>{r.details}</div>}
                        </div>
                      )}
                    </div>
                  ); })}
                </div>
              </div>
            )}
            <button style={{ ...S.btn("p"), width: "100%", marginTop: 4 }} onClick={nextCard}>
              {currentIdx < reviewQueue.length - 1 ? "Next →" : "Finish"}
            </button>
          </div>
        )}
      </div>
      <div style={{ fontSize: 10, color: "#383430", textAlign: "center", marginBottom: 8 }}>{card.repetitions > 0 ? `${card.repetitions}× · ${card.interval}d · ease ${card.easeFactor.toFixed(2)}` : "First review"}</div>
      <div style={{ fontSize: 9.5, color: "#383430", textAlign: "center", fontFamily: "system-ui", letterSpacing: "0.03em" }}>1–4 to answer · Space to continue · Esc to exit</div>
    </div>);
  };

  // ─── Summary ────────────────────────────────────────────────────
  const Sum = () => {
    const pct = sessionStats.reviewed > 0 ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100) : 0;
    return (<div style={{ textAlign: "center", paddingTop: 28 }}>
      <div style={{ fontSize: 38, marginBottom: 10 }}>✓</div>
      <h2 style={{ fontSize: 18, color: "#e8e4dc", fontWeight: 500, marginBottom: 4 }}>Session Complete</h2>
      <p style={{ color: "#5a5650", fontSize: 13, marginBottom: 22 }}>{sessionStats.reviewed} cards · {sessionStats.correct} correct ({pct}%)</p>
      <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap", marginBottom: 22 }}>
        {sessionStats.results.map((c, i) => (<div key={i} style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, background: c ? "rgba(120,160,96,0.12)" : "rgba(200,72,72,0.12)", color: c ? "#8BB874" : "#c47070", fontFamily: "system-ui" }}>{c ? "✓" : "✗"}</div>))}
      </div>
      <button style={S.btn("p")} onClick={() => setView("dashboard")}>Dashboard</button>
    </div>);
  };

  // ─── Browse ─────────────────────────────────────────────────────
  const Lib = () => (<div>
    <h2 style={{ fontSize: 17, color: "#e8e4dc", marginBottom: 14, fontWeight: 500 }}>Card Library</h2>
    <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
      <input style={{ ...S.inp, maxWidth: 160 }} placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
      <select style={S.sel} value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
        <option value="all">All Modules</option>{MODULES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select style={S.sel} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
        <option value="all">All Types</option>{Object.entries(CARD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select style={S.sel} value={ccFilter} onChange={e => setCcFilter(e.target.value)}>
        <option value="all">All</option><option value="cross">Cross-cutting</option><option value="single">Single module</option>
      </select>
    </div>
    <div style={{ fontSize: 11, color: "#5a5650", marginBottom: 10 }}>{filtered.length} cards</div>
    {filtered.map(card => { const open = browseOpen === card.id; return (
      <div key={card.id} style={{ ...S.card, padding: "11px 14px", marginBottom: 5, cursor: "pointer" }} onClick={() => setBrowseOpen(open ? null : card.id)}>
        <div style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={S.bdg(TYPE_COLORS[card.type])}>{CARD_TYPES[card.type]}</span>
          <span style={S.tag}>{card.module}</span>
          {card.crossCutting && <span style={S.ccTag}>⬡ Cross-cutting</span>}
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#383430", fontFamily: "system-ui" }}>{card.repetitions > 0 ? `${card.interval}d` : "new"}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "#8a8680", lineHeight: 1.45 }}>{card.front}</div>
        {open && (<div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.025)" }}>
          <div style={{ fontSize: 12, color: "#a09a92", lineHeight: 1.6, marginBottom: 4 }}>{card.back}</div>
          {card.details && <div style={{ fontSize: 11, color: "#5a5650", lineHeight: 1.5, fontStyle: "italic" }}>{card.details}</div>}
          {card.tags?.length > 0 && <div style={{ marginTop: 5, display: "flex", gap: 3, flexWrap: "wrap" }}>{card.tags.map(t => <span key={t} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 7, background: "rgba(255,255,255,0.025)", color: "#5a5650", fontFamily: "system-ui" }}>{t}</span>)}</div>}
        </div>)}
      </div>
    ); })}
  </div>);

  // ─── Add ─────────────────────────────────────────────────────────
  const Add = () => (<div>
    <h2 style={{ fontSize: 17, color: "#e8e4dc", marginBottom: 14, fontWeight: 500 }}>Add Card</h2>
    <div style={S.card}>
      <div style={{ display: "flex", gap: 8, marginBottom: 11, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Type</label><select style={{ ...S.sel, width: "100%" }} value={addForm.type} onChange={e => setAddForm({ ...addForm, type: e.target.value })}>{Object.entries(CARD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div style={{ flex: 1, minWidth: 120 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Module</label><select style={{ ...S.sel, width: "100%" }} value={addForm.module} onChange={e => setAddForm({ ...addForm, module: e.target.value })}>{MODULES.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
      </div>
      <div style={{ marginBottom: 11 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Tags (comma-separated)</label><input style={S.inp} placeholder="e.g. consideration, estoppel" value={addForm.tags} onChange={e => setAddForm({ ...addForm, tags: e.target.value })} /></div>
      <div style={{ marginBottom: 11 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13, color: addForm.crossCutting ? "#b088a8" : "#5a5650" }}>
          <span style={{ width: 18, height: 18, borderRadius: 4, border: addForm.crossCutting ? "1px solid rgba(176,136,168,0.3)" : "1px solid rgba(255,255,255,0.06)", background: addForm.crossCutting ? "rgba(176,136,168,0.12)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }} onClick={() => setAddForm({ ...addForm, crossCutting: !addForm.crossCutting })}>{addForm.crossCutting ? "✓" : ""}</span>
          <span onClick={() => setAddForm({ ...addForm, crossCutting: !addForm.crossCutting })}>Cross-cutting (spans multiple modules)</span>
        </label>
      </div>
      <div style={{ marginBottom: 11 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Front (question)</label><textarea style={S.ta} value={addForm.front} onChange={e => setAddForm({ ...addForm, front: e.target.value })} /></div>
      <div style={{ marginBottom: 11 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Back (answer)</label><textarea style={S.ta} value={addForm.back} onChange={e => setAddForm({ ...addForm, back: e.target.value })} /></div>
      <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, color: "#5a5650", display: "block", marginBottom: 3 }}>Extended Notes (optional)</label><textarea style={S.ta} value={addForm.details} onChange={e => setAddForm({ ...addForm, details: e.target.value })} /></div>
      <button style={{ ...S.btn("p"), opacity: addForm.front && addForm.back ? 1 : 0.3 }} onClick={addCard} disabled={!addForm.front || !addForm.back}>Add Card</button>
    </div>
  </div>);

  return (<div style={S.app}>
    <div style={S.hdr}>
      <div style={S.logo} onClick={() => setView("dashboard")}>Inter Alia</div>
      <div style={S.nav}>
        {[["dashboard", "Home"], ["browse", "Library"], ["add", "Add"]].map(([v, l]) => (
          <button key={v} style={S.nb(view === v || (view === "summary" && v === "dashboard") || (view === "review" && v === "dashboard"))} onClick={() => setView(v)}>{l}</button>
        ))}
      </div>
    </div>
    {view === "dashboard" && <Dash />}
    {view === "review" && <Rev />}
    {view === "summary" && <Sum />}
    {view === "browse" && <Lib />}
    {view === "add" && <Add />}
    <div style={S.footer}>© Gene Leung</div>
  </div>);
}
