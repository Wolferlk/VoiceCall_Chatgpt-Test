import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

const TYPE_FILTERS = [
  { id: "all",              label: "All Records"       },
  { id: "service_calls",    label: "Service Calls"     },
  { id: "chatbot_sessions", label: "Chatbot Sessions"  },
  { id: "trip_plans",       label: "Trip Plans"        },
];

const STATUS_FILTERS = [
  { id: "all",       label: "Any Status"  },
  { id: "completed", label: "Completed"   },
  { id: "active",    label: "Active"      },
  { id: "failed",    label: "Failed"      },
];

const SORT_OPTIONS = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
];

const PROFILE_KEYS = [
  { key: "full_name",              label: "Full Name",       color: "#6366f1", section: "contact"  },
  { key: "contact_number",         label: "WhatsApp",        color: "#10b981", section: "contact"  },
  { key: "current_living_country", label: "Country",         color: "#f59e0b", section: "contact"  },
  { key: "traveler_count",         label: "Travelers",       color: "#3b82f6", section: "booking"  },
  { key: "hotel_star_preference",  label: "Hotel Stars",     color: "#8b5cf6", section: "booking"  },
  { key: "number_of_days",         label: "Days",            color: "#06b6d4", section: "booking"  },
  { key: "travel_start_date",      label: "Start Date",      color: "#ec4899", section: "booking"  },
  { key: "activities",             label: "Activities",      color: "#f97316", section: "booking"  },
  { key: "travel_purpose",         label: "Purpose",         color: "#14b8a6", section: "booking"  },
  { key: "package_state",          label: "Package State",   color: "#94a3b8", section: "booking"  },
];

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusColors(status) {
  const s = (status || "").toLowerCase();
  if (s === "completed")             return { bg: "rgba(16,185,129,0.12)",  text: "#059669",  dot: "#10b981" };
  if (s === "active" || s === "connected") return { bg: "rgba(59,130,246,0.12)", text: "#2563eb", dot: "#3b82f6" };
  if (s === "failed" || s === "timeout")   return { bg: "rgba(239,68,68,0.12)",  text: "#dc2626",  dot: "#ef4444" };
  if (s === "ending")                return { bg: "rgba(249,115,22,0.12)", text: "#ea580c",  dot: "#f97316" };
  return { bg: "rgba(148,163,184,0.12)", text: "#64748b", dot: "#94a3b8" };
}

function parseJsonSafe(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function ProfileRow({ label, value, color }) {
  const filled = value !== undefined && value !== null && value !== "";
  const display = filled ? (Array.isArray(value) ? value.join(", ") : String(value)) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: filled ? color : "#cbd5e1", flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: "#64748b", minWidth: 118 }}>{label}</span>
      <span style={{ fontSize: 12, color: filled ? "#1e293b" : "#94a3b8", fontWeight: filled ? 600 : 400, flex: 1, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {display || "Pending"}
      </span>
    </div>
  );
}

export default function RecordsPage() {
  const [typeFilter,    setTypeFilter]    = useState("all");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [sortOrder,     setSortOrder]     = useState("newest");
  const [search,        setSearch]        = useState("");
  const [refreshKey,    setRefreshKey]    = useState(0);
  const [records,       setRecords]       = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [selectedType,  setSelectedType]  = useState("");
  const [selectedId,    setSelectedId]    = useState("");
  const [loading,       setLoading]       = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error,         setError]         = useState("");
  const [quotationStatus, setQuotationStatus] = useState({});
  const [detailTab,     setDetailTab]     = useState("overview");
  const [copied,        setCopied]        = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadRecords() {
      try {
        setLoading(true);
        setError("");
        const params = new URLSearchParams();
        params.set("type", typeFilter);
        if (search.trim()) params.set("search", search.trim());
        const res  = await fetch(`${API_BASE_URL}/records?${params.toString()}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Could not load stored records.");
        if (!cancelled) setRecords(data.records || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadRecords();
    return () => { cancelled = true; };
  }, [typeFilter, search, refreshKey]);

  async function openRecord(recordType, publicId) {
    try {
      setDetailLoading(true);
      setError("");
      setSelectedType(recordType);
      setSelectedId(publicId);
      setDetailTab("overview");
      const res  = await fetch(`${API_BASE_URL}/records/${recordType}/${publicId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not load the selected record.");
      setSelectedRecord(data.record || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  function downloadRecord(recordType, publicId) {
    window.open(`${API_BASE_URL}/records/${recordType}/${publicId}/download`, "_blank", "noopener,noreferrer");
  }

  async function sendQuotation(publicId, recordType) {
    setQuotationStatus((p) => ({ ...p, [publicId]: { loading: true, sent: false, error: null } }));
    try {
      const isChatbot = recordType === "chatbot_session";
      const endpoint  = isChatbot
        ? `${API_BASE_URL}/chatbot/send-quotation`
        : `${API_BASE_URL}/aahaas-assistent-v01/send-quotation`;
      const body = isChatbot ? { session_id: publicId } : { call_id: publicId };
      const res  = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Server error ${res.status}`);
      const sent = isChatbot ? data.sent === true : data.queued === true;
      setQuotationStatus((p) => ({ ...p, [publicId]: { loading: false, sent, error: null } }));
    } catch (err) {
      setQuotationStatus((p) => ({ ...p, [publicId]: { loading: false, sent: false, error: err.message } }));
    }
  }

  function copyId(id) {
    navigator.clipboard?.writeText(id).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(""), 1800);
    });
  }

  // ── Client-side filter + sort ─────────────────────────────────────────────
  const displayRecords = records
    .filter((r) => statusFilter === "all" || (r.status || "").toLowerCase() === statusFilter)
    .sort((a, b) => {
      const ta = new Date(a.created_at).getTime() || 0;
      const tb = new Date(b.created_at).getTime() || 0;
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalCalls    = records.filter((r) => r.record_type === "service_call").length;
  const totalChats    = records.filter((r) => r.record_type === "chatbot_session").length;
  const totalPlans    = records.filter((r) => r.record_type === "trip_plan").length;
  const totalDone     = records.filter((r) => (r.status || "").toLowerCase() === "completed").length;

  // ── Detail parsers ────────────────────────────────────────────────────────
  const detailProfile      = selectedRecord ? parseJsonSafe(selectedRecord.customer_profile)     : null;
  const detailFinalReport  = selectedRecord ? parseJsonSafe(selectedRecord.final_report)          : null;
  const detailCategories   = selectedRecord?.service_categories;
  const detailConversation = selectedRecord
    ? (parseJsonSafe(selectedRecord.conversation_history) || [])
    : [];

  // ── Style tokens ──────────────────────────────────────────────────────────
  const card = {
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 14,
    padding: "16px 18px",
    boxShadow: "0 2px 12px rgba(15,23,42,0.06)",
  };
  const kicker = {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 7, display: "block",
  };
  const sel = {
    padding: "7px 10px", borderRadius: 8,
    border: "1px solid rgba(15,23,42,0.12)", background: "#fff",
    fontSize: 12, color: "#1e293b", outline: "none", cursor: "pointer",
  };
  const infoBlock = { background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)", borderRadius: 10, padding: "13px 16px" };

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", paddingBottom: 32 }}>

      {/* ── HEADER ── */}
      <header style={{
        background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
        padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
            🗄
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>Stored Data Center</div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>Service calls · Trip plans · Reports · Downloads</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { label: "Total",  val: records.length, color: "#a5b4fc" },
            { label: "Calls",  val: totalCalls,     color: "#6ee7b7" },
            { label: "Chats",  val: totalChats,     color: "#c4b5fd" },
            { label: "Plans",  val: totalPlans,     color: "#fcd34d" },
            { label: "Done",   val: totalDone,      color: "#34d399" },
          ].map((s) => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "6px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── TOOLBAR ── */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "14px 16px", flexWrap: "wrap" }}>
        {/* Type chips */}
        <div style={{ display: "flex", gap: 6 }}>
          {TYPE_FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setTypeFilter(f.id)} style={{
              padding: "7px 15px", borderRadius: 20, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 700,
              background: typeFilter === f.id ? "#6366f1" : "rgba(255,255,255,0.9)",
              color: typeFilter === f.id ? "#fff" : "#475569",
              boxShadow: typeFilter === f.id ? "0 2px 10px rgba(99,102,241,0.28)" : "0 1px 4px rgba(15,23,42,0.08)",
              transition: "all 0.15s",
            }}>{f.label}</button>
          ))}
        </div>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={sel}>
          {STATUS_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>

        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} style={sel}>
          {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by ID, status, or summary..."
          style={{ flex: 1, minWidth: 220, padding: "8px 14px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", fontSize: 13, outline: "none", background: "rgba(255,255,255,0.95)", color: "#1e293b" }}
        />

        <button type="button" onClick={() => setRefreshKey((k) => k + 1)} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", cursor: "pointer", fontSize: 13, color: "#475569", fontWeight: 600 }}>
          ↺ Refresh
        </button>
      </div>

      {error && (
        <div style={{ margin: "0 16px 12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#dc2626" }}>
          {error}
        </div>
      )}

      {/* ── MAIN LAYOUT ── */}
      <div style={{ display: "grid", gridTemplateColumns: "390px 1fr", gap: 14, padding: "0 16px" }}>

        {/* ── LIST PANEL ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Count bar */}
          <div style={{ ...card, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
              {loading ? "Loading…" : `${displayRecords.length} record${displayRecords.length !== 1 ? "s" : ""}`}
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{TYPE_FILTERS.find((f) => f.id === typeFilter)?.label}</span>
          </div>

          {loading ? (
            <div style={{ ...card, textAlign: "center", padding: "36px", color: "#94a3b8", fontSize: 13 }}>Loading records…</div>
          ) : displayRecords.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: "36px" }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>No records matched your filters.</div>
            </div>
          ) : (
            displayRecords.map((rec) => {
              const isActive   = selectedId === rec.public_id;
              const sc         = statusColors(rec.status);
              const qs         = quotationStatus[rec.public_id];
              const isCall     = rec.record_type === "service_call";
              const isChatbot  = rec.record_type === "chatbot_session";
              const isTrip     = rec.record_type === "trip_plan";
              return (
                <div
                  key={`${rec.record_type}-${rec.public_id}`}
                  onClick={() => openRecord(rec.record_type, rec.public_id)}
                  style={{
                    ...card,
                    padding: "14px 16px",
                    cursor: "pointer",
                    border: isActive ? "1.5px solid #6366f1" : "1px solid rgba(15,23,42,0.08)",
                    background: isActive ? "rgba(99,102,241,0.04)" : "rgba(255,255,255,0.95)",
                    transition: "all 0.15s",
                  }}
                >
                  {/* Top row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                        background: isCall ? "rgba(99,102,241,0.1)" : isChatbot ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
                        color: isCall ? "#6366f1" : isChatbot ? "#059669" : "#d97706",
                        padding: "2px 8px", borderRadius: 20, letterSpacing: "0.05em",
                      }}>{isCall ? "Call" : isChatbot ? "Chat" : "Trip"}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#6366f1" : "#1e293b", fontFamily: "monospace" }}>
                        {rec.public_id}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.text, padding: "2px 10px", borderRadius: 20 }}>
                      {rec.status || "Unknown"}
                    </span>
                  </div>

                  {/* Summary */}
                  {rec.summary && (
                    <p style={{ fontSize: 12, color: "#475569", margin: "0 0 8px", lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {rec.summary}
                    </p>
                  )}

                  {/* Date + Category chips */}
                  <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{formatDate(rec.created_at)}</span>
                    {rec.categories?.map((cat) => (
                      <span key={cat} style={{ fontSize: 10, background: "rgba(99,102,241,0.07)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.15)", padding: "1px 8px", borderRadius: 20 }}>
                        {cat}
                      </span>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => openRecord(rec.record_type, rec.public_id)} style={{
                      padding: "5px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                      background: isActive ? "#6366f1" : "rgba(99,102,241,0.1)", color: isActive ? "#fff" : "#6366f1",
                    }}>View</button>

                    <button type="button" onClick={() => downloadRecord(rec.record_type, rec.public_id)} style={{
                      padding: "5px 13px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.1)", cursor: "pointer",
                      fontSize: 11, fontWeight: 600, background: "#fff", color: "#475569",
                    }}>Download</button>

                    <button type="button" onClick={() => copyId(rec.public_id)} style={{
                      padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.1)", cursor: "pointer", fontSize: 11,
                      background: copied === rec.public_id ? "rgba(16,185,129,0.1)" : "#fff",
                      color: copied === rec.public_id ? "#10b981" : "#94a3b8",
                    }}>{copied === rec.public_id ? "✓ Copied" : "⎘ ID"}</button>

                    {(isCall || isChatbot) && (
                      <button type="button" disabled={qs?.loading} onClick={() => sendQuotation(rec.public_id, rec.record_type)} style={{
                        padding: "5px 13px", borderRadius: 8, border: "none",
                        cursor: qs?.loading ? "wait" : "pointer", fontSize: 11, fontWeight: 700,
                        background: qs?.sent ? "rgba(16,185,129,0.12)" : qs?.error ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)",
                        color: qs?.sent ? "#059669" : qs?.error ? "#dc2626" : "#d97706",
                      }}>{qs?.loading ? "Sending…" : qs?.sent ? "✓ Queued" : qs?.error ? "Retry WA" : "📤 Send WA"}</button>
                    )}
                  </div>

                  {qs && !qs.loading && (
                    <div style={{ marginTop: 7, fontSize: 11, color: qs.sent ? "#10b981" : "#ef4444" }}>
                      {qs.sent ? "WhatsApp quotation queued — sending in background" : qs.error}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* ── DETAIL PANEL ── */}
        <div style={{ ...card, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 640, position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)" }}>

          {/* Detail header */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(15,23,42,0.07)", background: "rgba(248,250,252,0.9)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div>
              <span style={kicker}>Record Inspector</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", fontFamily: selectedRecord ? "monospace" : "inherit" }}>
                {selectedRecord ? selectedId : "Detail View"}
              </span>
            </div>
            {selectedRecord && (
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => copyId(selectedId)} style={{ padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", background: copied === selectedId ? "rgba(16,185,129,0.1)" : "#fff", color: copied === selectedId ? "#10b981" : "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  {copied === selectedId ? "✓ Copied" : "⎘ Copy ID"}
                </button>
                <button type="button" onClick={() => downloadRecord(selectedType, selectedId)} style={{ padding: "6px 13px", borderRadius: 8, border: "1px solid rgba(15,23,42,0.12)", background: "#fff", color: "#475569", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  ⬇ Export
                </button>
                {(selectedType === "service_call" || selectedType === "chatbot_session") && (
                  <button type="button" onClick={() => sendQuotation(selectedId, selectedType)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 10px rgba(16,185,129,0.28)" }}>
                    📤 Send WhatsApp
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tabs */}
          {selectedRecord && (
            <div style={{ display: "flex", borderBottom: "1px solid rgba(15,23,42,0.07)", padding: "0 20px", flexShrink: 0 }}>
              {[
                { id: "overview",     label: "Overview"     },
                { id: "profile",      label: "Customer"     },
                { id: "conversation", label: `Chat (${detailConversation.length})` },
                { id: "report",       label: "Report"       },
              ].map((tab) => (
                <button key={tab.id} type="button" onClick={() => setDetailTab(tab.id)} style={{
                  padding: "11px 16px", background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 700, transition: "all 0.15s", marginBottom: -1,
                  color: detailTab === tab.id ? "#6366f1" : "#94a3b8",
                  borderBottom: detailTab === tab.id ? "2px solid #6366f1" : "2px solid transparent",
                }}>{tab.label}</button>
              ))}
            </div>
          )}

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {detailLoading ? (
              <p style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", marginTop: 50 }}>Loading record details…</p>
            ) : !selectedRecord ? (
              <div style={{ textAlign: "center", paddingTop: 70, color: "#94a3b8" }}>
                <div style={{ fontSize: 46, marginBottom: 14 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>Select a record</div>
                <div style={{ fontSize: 13 }}>Click any record on the left to inspect full details, customer data, conversation history, and reports.</div>
              </div>

            /* ── OVERVIEW TAB ── */
            ) : detailTab === "overview" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {[
                    { label: "Record Type",  val: selectedType,                      color: "#6366f1" },
                    { label: "Status",       val: selectedRecord.status,             color: statusColors(selectedRecord.status).dot },
                    { label: "Ended Reason", val: selectedRecord.ended_reason,       color: "#f59e0b" },
                    { label: "Started",      val: formatDate(selectedRecord.started_at), color: "#10b981" },
                    { label: "Ended",        val: formatDate(selectedRecord.ended_at),   color: "#3b82f6" },
                    { label: "Public ID",    val: selectedId,                        color: "#8b5cf6" },
                  ].map((item) => (
                    <div key={item.label} style={infoBlock}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>{item.label}</div>
                      <div style={{ fontSize: 12, color: item.val ? "#1e293b" : "#94a3b8", fontWeight: 600, fontFamily: item.label === "Public ID" ? "monospace" : "inherit", wordBreak: "break-all" }}>
                        {item.val || "—"}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Categories */}
                {detailCategories?.length > 0 && (
                  <div style={infoBlock}>
                    <span style={kicker}>Service Categories</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {(Array.isArray(detailCategories) ? detailCategories : [detailCategories]).map((cat) => (
                        <span key={cat} style={{ background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.2)", padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Latest summary */}
                {selectedRecord.latest_report && (
                  <div style={infoBlock}>
                    <span style={kicker}>Latest Summary</span>
                    <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.7 }}>{selectedRecord.latest_report}</p>
                  </div>
                )}

                {/* Quotation status (if sent from here) */}
                {quotationStatus[selectedId] && !quotationStatus[selectedId].loading && (
                  <div style={{
                    ...infoBlock,
                    background: quotationStatus[selectedId].sent ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)",
                    border: `1px solid ${quotationStatus[selectedId].sent ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                  }}>
                    <span style={{ ...kicker, color: quotationStatus[selectedId].sent ? "#10b981" : "#ef4444" }}>
                      {quotationStatus[selectedId].sent ? "✓ WhatsApp Quotation Queued" : "✕ WhatsApp Send Failed"}
                    </span>
                    <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>
                      {quotationStatus[selectedId].sent
                        ? "Quotation is queued for background delivery."
                        : quotationStatus[selectedId].error || "Unknown error."}
                    </p>
                  </div>
                )}
              </div>

            /* ── CUSTOMER TAB ── */
            ) : detailTab === "profile" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {detailProfile ? (
                  <>
                    <div style={infoBlock}>
                      <span style={kicker}>Contact Information</span>
                      {PROFILE_KEYS.filter((k) => k.section === "contact").map((pk) => (
                        <ProfileRow key={pk.key} label={pk.label} value={detailProfile[pk.key]} color={pk.color} />
                      ))}
                    </div>
                    <div style={infoBlock}>
                      <span style={kicker}>Booking Preferences</span>
                      {PROFILE_KEYS.filter((k) => k.section === "booking").map((pk) => (
                        <ProfileRow key={pk.key} label={pk.label} value={detailProfile[pk.key]} color={pk.color} />
                      ))}
                    </div>
                    {detailProfile.suggested_package && (
                      <div style={{ ...infoBlock, background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.14)" }}>
                        <span style={{ ...kicker, color: "#6366f1" }}>Suggested Package</span>
                        <pre style={{ fontSize: 11, color: "#374151", margin: 0, overflow: "auto", maxHeight: 260, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {typeof detailProfile.suggested_package === "string"
                            ? detailProfile.suggested_package
                            : JSON.stringify(detailProfile.suggested_package, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>No customer profile data available.</p>
                )}
              </div>

            /* ── CONVERSATION TAB ── */
            ) : detailTab === "conversation" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {detailConversation.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>No conversation history recorded for this call.</p>
                ) : (
                  detailConversation.map((msg, idx) => {
                    const isAssistant = msg.role === "assistant";
                    return (
                      <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: isAssistant ? "flex-start" : "flex-end", gap: 3 }}>
                        <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: isAssistant ? "0 0 0 4px" : "0 4px 0 0" }}>
                          {isAssistant ? "AI Assistant" : "Caller"}
                        </span>
                        <div style={{
                          maxWidth: "80%",
                          background: isAssistant ? "rgba(99,102,241,0.08)" : "rgba(16,185,129,0.08)",
                          border: `1px solid ${isAssistant ? "rgba(99,102,241,0.18)" : "rgba(16,185,129,0.18)"}`,
                          borderRadius: isAssistant ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                          padding: "9px 14px", fontSize: 12, color: "#1e293b", lineHeight: 1.65,
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

            /* ── REPORT TAB ── */
            ) : detailTab === "report" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {detailFinalReport ? (
                  <>
                    {detailFinalReport.summary && (
                      <div style={{ ...infoBlock, background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)" }}>
                        <span style={{ ...kicker, color: "#10b981" }}>Summary</span>
                        <p style={{ fontSize: 13, color: "#1e293b", margin: 0, lineHeight: 1.7 }}>{detailFinalReport.summary}</p>
                      </div>
                    )}

                    {detailFinalReport.products_needed?.length > 0 && (
                      <div style={infoBlock}>
                        <span style={kicker}>Products Needed</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {detailFinalReport.products_needed.map((p) => (
                            <span key={p} style={{ background: "rgba(59,130,246,0.08)", color: "#2563eb", border: "1px solid rgba(59,130,246,0.15)", padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{p}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {detailFinalReport.follow_up_actions?.length > 0 && (
                      <div style={infoBlock}>
                        <span style={kicker}>Follow-up Actions</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                          {detailFinalReport.follow_up_actions.map((action, i) => (
                            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(245,158,11,0.12)", color: "#d97706", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                              <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>{action}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {detailFinalReport.service_categories?.length > 0 && (
                      <div style={infoBlock}>
                        <span style={kicker}>Service Categories</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                          {detailFinalReport.service_categories.map((cat) => (
                            <span key={cat} style={{ background: "rgba(99,102,241,0.08)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.2)", padding: "4px 13px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{cat}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={infoBlock}>
                      <span style={kicker}>Raw JSON</span>
                      <pre style={{ fontSize: 10, color: "#374151", margin: 0, overflow: "auto", maxHeight: 280, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {JSON.stringify(detailFinalReport, null, 2)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: 13, color: "#94a3b8" }}>No final report available for this record.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
