import { useState, useEffect, useCallback, useMemo } from "react";
import { SEED_CARDS } from "./cards.js";

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

// ─── Storage (localStorage) ─────────────────────────────────────────
function save(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) { console.error("Save:", e); } }
function load(key, fb) { try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch { return fb; } }

// ─── Fixed modules ──────────────────────────────────────────────────
const MODULES = ["Public Law", "Criminal Law", "Contract Law", "Tort", "Commercial Law", "Property Law", "Jurisprudence", "Equity & Trusts", "Evidence"];

const CARD_TYPES = { principle: "Principle", case: "Case", application: "Application", distinction: "Distinction" };
const TYPE_COLORS = { principle: "#D4A574", case: "#7BA5C4", application: "#8BB874", distinction: "#C49BBD" };
const Q_LABELS = [{ q: 0, l: "Blackout" }, { q: 1, l: "Wrong" }, { q: 2, l: "Struggle" }, { q: 3, l: "OK" }, { q: 4, l: "Good" }, { q: 5, l: "Perfect" }];

function getDue(cards) { return cards.filter(c => c.nextReview <= Date.now()).sort((a, b) => a.nextReview - b.nextReview); }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ─── App ────────────────────────────────────────────────────────────
export default function InterAlia() {
  const [cards, setCards] = useState(SEED_CARDS);
  const [view, setView] = useState("loading");
  const [reviewQueue, setReviewQueue] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [ccFilter, setCcFilter] = useState("all"); // all | cross | single
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, avgQ: 0, qs: [] });
  const [addForm, setAddForm] = useState({ type: "principle", module: MODULES[0], tags: "", front: "", back: "", details: "", crossCutting: false });
  const [searchTerm, setSearchTerm] = useState("");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(null);
  const [selectedModule, setSelectedModule] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState({ principle: true, case: true, application: true, distinction: true });

  const stats = useMemo(() => {
    const now = Date.now();
    return { due: cards.filter(c => c.nextReview <= now).length, learning: cards.filter(c => c.repetitions > 0 && c.repetitions < 3).length, mature: cards.filter(c => c.repetitions >= 3).length, new: cards.filter(c => c.repetitions === 0).length, total: cards.length, crossCutting: cards.filter(c => c.crossCutting).length };
  }, [cards]);

  // Load
  useEffect(() => {
    const d = load("interalia-all", null);
    if (d?.cards?.length) setCards(d.cards);
    if (d?.history?.length) setHistory(d.history);
    setLoaded(true); setView("dashboard");
  }, []);

  // Save
  useEffect(() => { if (loaded) save("interalia-all", { cards, history }); }, [cards, history, loaded]);

  const startReview = useCallback((mode, value, typeFilter) => {
    let pool;
    if (mode === "cross") pool = shuffle(cards.filter(c => c.crossCutting));
    else if (mode === "module") pool = value === "all" ? cards : cards.filter(c => c.module === value);
    else pool = cards;
    if (typeFilter) pool = pool.filter(c => typeFilter[c.type]);
    let due = getDue(pool);
    if (!due.length) due = pool.filter(c => c.repetitions === 0).slice(0, 10);
    if (mode === "cross") due = shuffle(due); // always random for cross-cutting
    if (!due.length) return;
    setReviewQueue(due); setCurrentIdx(0); setFlipped(false); setShowDetails(false);
    setSessionStats({ reviewed: 0, avgQ: 0, qs: [] }); setView("review");
    setSelectedModule(null);
  }, [cards]);

  const rateCard = useCallback((q) => {
    const card = reviewQueue[currentIdx];
    setCards(prev => prev.map(c => c.id === card.id ? sm2(c, q) : c));
    setHistory(prev => [...prev, { cardId: card.id, q, ts: Date.now() }]);
    const nq = [...sessionStats.qs, q];
    setSessionStats({ reviewed: sessionStats.reviewed + 1, avgQ: nq.reduce((a, b) => a + b, 0) / nq.length, qs: nq });
    if (currentIdx < reviewQueue.length - 1) { setCurrentIdx(currentIdx + 1); setFlipped(false); setShowDetails(false); }
    else setView("summary");
  }, [reviewQueue, currentIdx, sessionStats]);

  const addCard = useCallback(() => {
    if (!addForm.front || !addForm.back || !addForm.module) return;
    setCards(prev => [...prev, { id: String(Date.now()), type: addForm.type, module: addForm.module, tags: addForm.tags.split(",").map(t => t.trim()).filter(Boolean), crossCutting: addForm.crossCutting, front: addForm.front, back: addForm.back, details: addForm.details, easeFactor: 2.5, interval: 0, repetitions: 0, nextReview: 0, lastReview: 0 }]);
    setAddForm({ type: "principle", module: MODULES[0], tags: "", front: "", back: "", details: "", crossCutting: false });
  }, [addForm]);

  const resetProgress = useCallback(() => {
    if (!confirm("Reset all review progress? Cards kept.")) return;
    setCards(prev => prev.map(c => ({ ...c, easeFactor: 2.5, interval: 0, repetitions: 0, nextReview: 0, lastReview: 0 })));
    setHistory([]);
  }, []);

  const filtered = useMemo(() => cards.filter(c => {
    if (moduleFilter !== "all" && c.module !== moduleFilter) return false;
    if (typeFilter !== "all" && c.type !== typeFilter) return false;
    if (ccFilter === "cross" && !c.crossCutting) return false;
    if (ccFilter === "single" && c.crossCutting) return false;
    if (searchTerm) { const s = searchTerm.toLowerCase(); return c.front.toLowerCase().includes(s) || c.back.toLowerCase().includes(s) || c.tags?.some(t => t.toLowerCase().includes(s)); }
    return true;
  }), [cards, moduleFilter, typeFilter, ccFilter, searchTerm]);

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
    qb: (q) => { const c = ["#c84848", "#b86838", "#a88838", "#78a060", "#589878", "#4888a8"]; return { flex: 1, padding: "10px 2px", borderRadius: 6, cursor: "pointer", background: `${c[q]}0c`, border: `1px solid ${c[q]}20`, color: c[q], textAlign: "center", minWidth: 0 }; },
    inp: { width: "100%", padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 13, fontFamily: "'Newsreader', Georgia, serif", outline: "none", boxSizing: "border-box" },
    ta: { width: "100%", padding: "8px 10px", borderRadius: 6, minHeight: 64, resize: "vertical", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 13, fontFamily: "'Newsreader', Georgia, serif", outline: "none", boxSizing: "border-box", lineHeight: 1.6 },
    sel: { padding: "6px 8px", borderRadius: 6, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", color: "#e8e4dc", fontSize: 11.5, fontFamily: "'Newsreader', Georgia, serif", outline: "none", cursor: "pointer" },
    sec: { fontSize: 11.5, color: "#5a5650", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "system-ui, sans-serif" },
    sb: { textAlign: "center", padding: 11, background: "rgba(255,255,255,0.015)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.025)" },
  };

  if (view === "loading") return (
    <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "50vh" }}>
      <div style={{ textAlign: "center" }}><div style={S.logo}>Inter Alia</div><div style={{ color: "#5a5650", fontSize: 13, marginTop: 6 }}>Loading...</div></div>
    </div>
  );

  // ─── Dashboard ──────────────────────────────────────────────────
  const Dash = () => {
    const today = history.filter(h => h.ts > Date.now() - 86400000).length;
    return (<div>
      <div style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 17, color: "#e8e4dc", marginBottom: 2, fontWeight: 500 }}>Review Queue</h2>
        <p style={{ color: "#5a5650", fontSize: 12.5, margin: 0 }}>{stats.due > 0 ? `${stats.due} due` : "Nothing due"}{today > 0 ? ` · ${today} today` : ""}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 7, marginBottom: 22 }}>
        {[[stats.due, "Due", "#D4A574"], [stats.new, "New", "#b088a8"], [stats.learning, "Learning", "#7BA5C4"], [stats.mature, "Mature", "#8BB874"]].map(([n, l, c]) => (
          <div key={l} style={S.sb}><div style={{ fontSize: 24, fontWeight: 700, color: c }}>{n}</div><div style={{ fontSize: 10, color: "#5a5650", marginTop: 1, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "system-ui" }}>{l}</div></div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 26, flexWrap: "wrap" }}>
        <button style={S.btn("p")} onClick={() => startReview("module", "all")}>Review All ({stats.due || "new"})</button>
        <button style={{ ...S.btn("p"), background: "rgba(176,136,168,0.08)", color: "#b088a8", border: "1px solid rgba(176,136,168,0.18)" }} onClick={() => startReview("cross")}>
          Cross-cutting ({stats.crossCutting})
        </button>
        <button style={S.btn("g")} onClick={resetProgress}>Reset</button>
      </div>

      <div style={S.sec}>By Module</div>
      <div style={{ display: "grid", gap: 5, marginBottom: 6 }}>
        {MODULES.map(m => { const mc = cards.filter(c => c.module === m); const md = getDue(mc).length; const isOpen = selectedModule === m; if (!mc.length) return (
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
    </div>);
  };

  // ─── Review ─────────────────────────────────────────────────────
  const Rev = () => {
    const card = reviewQueue[currentIdx];
    if (!card) return <div style={{ color: "#5a5650", padding: 28, textAlign: "center" }}>No cards.</div>;
    return (<div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: "#5a5650" }}>{currentIdx + 1} / {reviewQueue.length}</span>
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
        {!flipped ? (
          <button style={{ ...S.btn("p"), width: "100%" }} onClick={() => setFlipped(true)}>Show Answer</button>
        ) : (<div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "#c4c0b8", padding: 15, background: "rgba(212,165,116,0.025)", borderLeft: "3px solid rgba(212,165,116,0.18)", borderRadius: "0 6px 6px 0" }}>{card.back}</div>
          {card.details && (<div>
            <button style={{ ...S.btn("g"), marginTop: 8, fontSize: 11, padding: "3px 8px" }} onClick={() => setShowDetails(!showDetails)}>{showDetails ? "Hide" : "Show"} notes</button>
            {showDetails && <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "#686460", marginTop: 8, padding: 11, background: "rgba(255,255,255,0.012)", borderRadius: 6, fontStyle: "italic" }}>{card.details}</div>}
          </div>)}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, color: "#5a5650", marginBottom: 6, textAlign: "center" }}>How well did you recall this?</div>
            <div style={{ display: "flex", gap: 4 }}>
              {Q_LABELS.map(({ q, l }) => (<button key={q} style={S.qb(q)} onClick={() => rateCard(q)}><div style={{ fontSize: 15, fontWeight: 700, fontFamily: "system-ui" }}>{q}</div><div style={{ fontSize: 9, marginTop: 1, fontFamily: "system-ui" }}>{l}</div></button>))}
            </div>
          </div>
        </div>)}
      </div>
      <div style={{ fontSize: 10, color: "#383430", textAlign: "center" }}>{card.repetitions > 0 ? `${card.repetitions}× · ${card.interval}d · ease ${card.easeFactor.toFixed(2)}` : "First review"}</div>
    </div>);
  };

  // ─── Summary ────────────────────────────────────────────────────
  const Sum = () => (<div style={{ textAlign: "center", paddingTop: 28 }}>
    <div style={{ fontSize: 38, marginBottom: 10 }}>✓</div>
    <h2 style={{ fontSize: 18, color: "#e8e4dc", fontWeight: 500, marginBottom: 4 }}>Session Complete</h2>
    <p style={{ color: "#5a5650", fontSize: 13, marginBottom: 22 }}>{sessionStats.reviewed} cards · Avg {sessionStats.avgQ.toFixed(1)}/5</p>
    <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap", marginBottom: 22 }}>
      {sessionStats.qs.map((q, i) => (<div key={i} style={{ width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 600, background: q >= 4 ? "rgba(120,160,96,0.1)" : q >= 3 ? "rgba(168,136,56,0.1)" : "rgba(200,72,72,0.1)", color: q >= 4 ? "#78a060" : q >= 3 ? "#a88838" : "#c84848", fontFamily: "system-ui" }}>{q}</div>))}
    </div>
    <button style={S.btn("p")} onClick={() => setView("dashboard")}>Dashboard</button>
  </div>);

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
  </div>);
}
