import { useCallback, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

// ── Sample presets ────────────────────────────────────────────────────────────
const SAMPLES = [
  {
    group: "System",
    items: [
      {
        label: "Health Check",
        method: "GET", url: `${API_BASE}/health`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
      {
        label: "ElevenLabs Signed URL",
        method: "GET", url: `${API_BASE}/elevenlabs/signed-url`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
    ],
  },
  {
    group: "Records",
    items: [
      {
        label: "List All Records",
        method: "GET", url: `${API_BASE}/records`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
      {
        label: "List Service Calls",
        method: "GET", url: `${API_BASE}/records?type=service_calls`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
      {
        label: "List Chatbot Sessions",
        method: "GET", url: `${API_BASE}/records?type=chatbot_sessions`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
      {
        label: "List Trip Plans",
        method: "GET", url: `${API_BASE}/records?type=trip_plans`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
    ],
  },
  {
    group: "Chatbot",
    items: [
      {
        label: "Start Chatbot Session",
        method: "POST", url: `${API_BASE}/chatbot/session`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ voice_name: "shimmer", voice_speed: 1.0 }, null, 2),
      },
      {
        label: "Send Chatbot Turn",
        method: "POST", url: `${API_BASE}/chatbot/turn`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ session_id: "CHAT-XXXXXXXX", message: "Hello, I want to plan a trip to Sri Lanka", voice_name: "shimmer", voice_speed: 1.0 }, null, 2),
      },
      {
        label: "Package Status",
        method: "GET", url: `${API_BASE}/chatbot/package-status/CHAT-XXXXXXXX`,
        headers: [{ k: "Accept", v: "application/json" }],
        body: "",
      },
      {
        label: "Send Chatbot Quotation",
        method: "POST", url: `${API_BASE}/chatbot/send-quotation`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ session_id: "CHAT-XXXXXXXX" }, null, 2),
      },
    ],
  },
  {
    group: "Aahaas Assistant V0.1",
    items: [
      {
        label: "Start Session",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/session`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ voice_name: "Aria", voice_speed: 1.0 }, null, 2),
      },
      {
        label: "Send Turn",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/turn`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX", message: "I need help with a booking", voice_name: "Aria", voice_speed: 1.0 }, null, 2),
      },
      {
        label: "End Session",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/end`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX" }, null, 2),
      },
      {
        label: "Package Prefetch",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/package-prefetch`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX", package_prompt: "Family tour Sri Lanka 5 days 4 star" }, null, 2),
      },
      {
        label: "Package Status",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/package-status`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX" }, null, 2),
      },
      {
        label: "Send Quotation",
        method: "POST", url: `${API_BASE}/aahaas-assistent-v01/send-quotation`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX" }, null, 2),
      },
      {
        label: "Ambient Music",
        method: "GET", url: `${API_BASE}/aahaas-assistent-v01/ambient-music`,
        headers: [{ k: "Accept", v: "audio/mpeg, */*" }],
        body: "",
      },
    ],
  },
  {
    group: "5v ChatGPT Assistant",
    items: [
      {
        label: "Start Session",
        method: "POST", url: `${API_BASE}/5v-chatgpt-assis/session`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ voice_name: "shimmer", voice_speed: 1.0 }, null, 2),
      },
      {
        label: "Send Turn",
        method: "POST", url: `${API_BASE}/5v-chatgpt-assis/turn`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX", message: "Hello", voice_name: "shimmer" }, null, 2),
      },
      {
        label: "End Session",
        method: "POST", url: `${API_BASE}/5v-chatgpt-assis/end`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ call_id: "CALL-XXXXXXXX" }, null, 2),
      },
    ],
  },
  {
    group: "External — Travel Parser",
    items: [
      {
        label: "Send WhatsApp Quotation",
        method: "POST",
        url: "https://travel-parser-live.aahaas.com/v1/voice/send-whatsapp",
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({
          prompt: "5-night Sri Lanka holiday covering Colombo, Kandy and Ella with hotels, activities and transfers",
          waId: "94778231121",
          customerName: "Parinda",
        }, null, 2),
      },
      {
        label: "Suggest Travel Package",
        method: "POST",
        url: "https://travel-parser-live.aahaas.com/v1/voice/suggest",
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({
          prompt: "5-night Sri Lanka holiday covering Colombo, Kandy and Ella with hotels, activities and transfers",
        }, null, 2),
      },
    ],
  },
  {
    group: "Text / TTS",
    items: [
      {
        label: "Text to Speech",
        method: "POST", url: `${API_BASE}/tts`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ text: "Hello from Aahaas!" }, null, 2),
      },
      {
        label: "Text AI Voice",
        method: "POST", url: `${API_BASE}/text-ai-voice`,
        headers: [{ k: "Content-Type", v: "application/json" }, { k: "Accept", v: "application/json" }],
        body: JSON.stringify({ text: "What is the capital of Sri Lanka?", history: [] }, null, 2),
      },
    ],
  },
];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const METHOD_COLORS = { GET: "#10b981", POST: "#6366f1", PUT: "#f59e0b", PATCH: "#3b82f6", DELETE: "#ef4444" };

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function statusColor(code) {
  if (!code) return "#94a3b8";
  if (code < 300) return "#10b981";
  if (code < 400) return "#f59e0b";
  if (code < 500) return "#ef4444";
  return "#dc2626";
}

function prettyJson(str) {
  try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
}

// ─── sub-components ────────────────────────────────────────────────────────────

function KVEditor({ rows, onChange, placeholder = "Header" }) {
  function update(idx, field, val) {
    const next = rows.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    onChange(next);
  }
  function addRow() { onChange([...rows, { k: "", v: "" }]); }
  function removeRow(idx) { onChange(rows.filter((_, i) => i !== idx)); }

  const inp = {
    padding: "6px 10px", borderRadius: 7, border: "1px solid rgba(15,23,42,0.12)",
    fontSize: 12, color: "#1e293b", background: "#fff", outline: "none", flex: 1,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input value={row.k} onChange={(e) => update(i, "k", e.target.value)} placeholder={placeholder} style={{ ...inp, maxWidth: 200 }} />
          <span style={{ color: "#94a3b8", fontSize: 13 }}>:</span>
          <input value={row.v} onChange={(e) => update(i, "v", e.target.value)} placeholder="Value" style={inp} />
          <button type="button" onClick={() => removeRow(i)} style={{ width: 24, height: 24, borderRadius: 6, border: "none", background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>×</button>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ alignSelf: "flex-start", padding: "5px 13px", borderRadius: 7, border: "1px dashed rgba(99,102,241,0.35)", background: "rgba(99,102,241,0.04)", color: "#6366f1", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
        + Add {placeholder}
      </button>
    </div>
  );
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid rgba(15,23,42,0.08)", marginBottom: 12 }}>
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onSelect(t.id)} style={{
          padding: "9px 16px", background: "none", border: "none", cursor: "pointer",
          fontSize: 12, fontWeight: 700, marginBottom: -1, transition: "all 0.12s",
          color: active === t.id ? "#6366f1" : "#94a3b8",
          borderBottom: active === t.id ? "2px solid #6366f1" : "2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function ApiTestPage() {
  // ── request state
  const [method,  setMethod]  = useState("GET");
  const [url,     setUrl]     = useState(`${API_BASE}/health`);
  const [headers, setHeaders] = useState([{ k: "Accept", v: "application/json" }]);
  const [body,    setBody]    = useState("");
  const [bodyTab, setBodyTab] = useState("json");  // json | form | raw | none
  const [formRows, setFormRows] = useState([{ k: "", v: "" }]);
  const [reqTab,  setReqTab]  = useState("headers"); // headers | body | auth | settings
  const [timeout, setTimeout_] = useState(30);

  // ── response state
  const [res,        setRes]        = useState(null);   // { status, statusText, headers, body, time, size, ok }
  const [resTab,     setResTab]     = useState("body");  // body | headers | info
  const [resView,    setResView]    = useState("pretty"); // pretty | raw
  const [busy,       setBusy]       = useState(false);
  const [err,        setErr]        = useState("");
  const abortRef = useRef(null);

  // ── history
  const [history, setHistory] = useState([]);
  const [histOpen, setHistOpen] = useState(false);

  // ── preset sidebar
  const [sideOpen, setSideOpen] = useState(true);
  const [sideSearch, setSideSearch] = useState("");

  // ── environment variables
  const [envOpen, setEnvOpen] = useState(false);
  const [envVars, setEnvVars] = useState([
    { k: "BASE_URL", v: API_BASE },
    { k: "SESSION_ID", v: "CHAT-XXXXXXXX" },
    { k: "CALL_ID", v: "CALL-XXXXXXXX" },
  ]);

  function applyEnv(str) {
    let out = str;
    envVars.forEach(({ k, v }) => {
      out = out.replaceAll(`{{${k}}}`, v);
    });
    return out;
  }

  // ── load preset
  function loadPreset(item) {
    setMethod(item.method);
    setUrl(item.url);
    setHeaders(item.headers.length ? item.headers : [{ k: "", v: "" }]);
    setBody(item.body || "");
    setBodyTab(item.body ? "json" : "none");
    setRes(null);
    setErr("");
  }

  // ── detect whether to proxy (external origin = not same host as API_BASE)
  function isExternal(resolvedUrl) {
    try {
      const target = new URL(resolvedUrl);
      const base   = new URL(API_BASE);
      return target.origin !== base.origin;
    } catch {
      return false;
    }
  }

  // ── send request
  const sendRequest = useCallback(async () => {
    const resolvedUrl = applyEnv(url.trim());
    if (!resolvedUrl) return;
    setBusy(true);
    setErr("");
    setRes(null);

    const controller = new AbortController();
    abortRef.current = controller;
    // proxy adds server-side timeout; browser abort is a safety net (+5s)
    const timer = window.setTimeout(() => controller.abort(), (timeout + 5) * 1000);
    const t0 = performance.now();

    const useProxy = isExternal(resolvedUrl);

    try {
      let status, statusText, resHeaders, rawText, elapsed, size;

      if (useProxy) {
        // ── route through Laravel proxy to avoid CORS
        const headerMap = {};
        headers.forEach(({ k, v }) => { if (k.trim()) headerMap[k.trim()] = v; });

        let bodyPayload = null;
        if (method !== "GET" && method !== "DELETE") {
          if ((bodyTab === "json" || bodyTab === "raw") && body.trim()) {
            bodyPayload = applyEnv(body);
          } else if (bodyTab === "form") {
            const obj = {};
            formRows.forEach(({ k, v }) => { if (k.trim()) obj[k.trim()] = v; });
            bodyPayload = JSON.stringify(obj);
            headerMap["Content-Type"] = "application/json";
          }
        }

        const proxyRes = await fetch(`${API_BASE}/proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ url: resolvedUrl, method, headers: headerMap, body: bodyPayload, timeout }),
          signal: controller.signal,
        });

        elapsed   = Math.round(performance.now() - t0);
        const data = await proxyRes.json().catch(() => ({}));

        if (!proxyRes.ok && data.error) throw new Error(data.error);

        status     = data.status      ?? proxyRes.status;
        statusText = data.status_text ?? proxyRes.statusText;
        resHeaders = {};
        if (data.headers && typeof data.headers === "object") {
          Object.entries(data.headers).forEach(([k, v]) => {
            resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
          });
        }
        rawText    = data.body        ?? "";
        size       = data.size_bytes  ?? new Blob([rawText]).size;
        elapsed    = data.time_ms     ?? elapsed;

      } else {
        // ── direct fetch (same-origin or CORS-enabled)
        const hdrs = new Headers();
        headers.forEach(({ k, v }) => { if (k.trim()) hdrs.set(k.trim(), v); });

        let fetchBody = undefined;
        if (method !== "GET" && method !== "DELETE") {
          if (bodyTab === "json" && body.trim()) {
            fetchBody = applyEnv(body);
            if (!hdrs.has("Content-Type")) hdrs.set("Content-Type", "application/json");
          } else if (bodyTab === "form") {
            const fd = new FormData();
            formRows.forEach(({ k, v }) => { if (k.trim()) fd.append(k.trim(), v); });
            fetchBody = fd;
            hdrs.delete("Content-Type");
          } else if (bodyTab === "raw" && body.trim()) {
            fetchBody = applyEnv(body);
          }
        }

        const response = await fetch(resolvedUrl, { method, headers: hdrs, body: fetchBody, signal: controller.signal });
        elapsed    = Math.round(performance.now() - t0);
        rawText    = await response.text();
        size       = new Blob([rawText]).size;
        status     = response.status;
        statusText = response.statusText;
        resHeaders = {};
        response.headers.forEach((v, k) => { resHeaders[k] = v; });
      }

      setHistory((h) => [{ id: Date.now(), method, url: resolvedUrl, status, time: elapsed, ts: new Date().toLocaleTimeString(), proxied: useProxy }, ...h].slice(0, 50));

      setRes({
        status, statusText,
        headers: resHeaders,
        body: rawText,
        time: elapsed,
        size,
        ok: status >= 200 && status < 300,
        proxied: useProxy,
      });
      setResTab("body");
    } catch (e) {
      const elapsed = Math.round(performance.now() - t0);
      if (e.name === "AbortError") {
        setErr(`Request timed out after ${elapsed} ms (limit: ${timeout}s).`);
      } else {
        setErr(e.message || "Request failed.");
      }
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }, [method, url, headers, body, bodyTab, formRows, timeout, envVars]);

  function abort() {
    abortRef.current?.abort();
    setBusy(false);
  }

  // ── filtered samples
  const filteredSamples = SAMPLES.map((g) => ({
    ...g,
    items: g.items.filter((i) => !sideSearch || i.label.toLowerCase().includes(sideSearch.toLowerCase()) || i.url.toLowerCase().includes(sideSearch.toLowerCase())),
  })).filter((g) => g.items.length);

  // ── styles
  const card = { background: "rgba(255,255,255,0.95)", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 14, boxShadow: "0 2px 12px rgba(15,23,42,0.06)" };
  const kicker = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#94a3b8", marginBottom: 7, display: "block" };
  const inp = { padding: "8px 12px", borderRadius: 9, border: "1px solid rgba(15,23,42,0.12)", fontSize: 13, color: "#1e293b", background: "#fff", outline: "none", width: "100%", boxSizing: "border-box" };

  const bodyText   = resView === "pretty" ? prettyJson(res?.body || "") : (res?.body || "");
  const isJsonResp = (res?.headers?.["content-type"] || "").includes("json");

  return (
    <div style={{ fontFamily: "'Space Grotesk','Segoe UI',system-ui,sans-serif", background: "#f0f4f8", minHeight: "100vh", display: "flex", flexDirection: "column", paddingBottom: 32 }}>

      {/* ── HEADER ── */}
      <header style={{ background: "linear-gradient(135deg,#1e293b 0%,#0f172a 100%)", padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 4px 24px rgba(0,0,0,0.22)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#f59e0b,#d97706)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⚡</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 16 }}>API Test Lab</div>
            <div style={{ color: "#64748b", fontSize: 11 }}>Send requests · Inspect responses · Speed analytics</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" onClick={() => setEnvOpen((x) => !x)} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: envOpen ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.06)", color: envOpen ? "#a5b4fc" : "#94a3b8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            ⚙ Variables
          </button>
          <button type="button" onClick={() => setHistOpen((x) => !x)} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: histOpen ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.06)", color: histOpen ? "#a5b4fc" : "#94a3b8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            🕐 History ({history.length})
          </button>
          <button type="button" onClick={() => setSideOpen((x) => !x)} style={{ padding: "6px 14px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: sideOpen ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.06)", color: sideOpen ? "#fcd34d" : "#94a3b8", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            📋 Presets
          </button>
        </div>
      </header>

      {/* ── ENV VARIABLES PANEL ── */}
      {envOpen && (
        <div style={{ ...card, margin: "12px 16px 0", padding: "16px 20px" }}>
          <span style={kicker}>Environment Variables — use {"{{KEY}}"} in URL / body</span>
          <KVEditor rows={envVars} onChange={setEnvVars} placeholder="Variable" />
        </div>
      )}

      {/* ── HISTORY PANEL ── */}
      {histOpen && (
        <div style={{ ...card, margin: "12px 16px 0", padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={kicker}>Request History</span>
            <button type="button" onClick={() => setHistory([])} style={{ fontSize: 11, color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Clear All</button>
          </div>
          {history.length === 0 ? (
            <p style={{ fontSize: 12, color: "#94a3b8" }}>No requests sent yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 220, overflowY: "auto" }}>
              {history.map((h) => (
                <div key={h.id} onClick={() => { setMethod(h.method); setUrl(h.url); setHistOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 9, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)", cursor: "pointer" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: METHOD_COLORS[h.method] || "#6366f1", minWidth: 44 }}>{h.method}</span>
                  <span style={{ fontSize: 11, color: "#1e293b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>{h.url}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(h.status) }}>{h.status}</span>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{h.time}ms</span>
                  {h.proxied && <span style={{ fontSize: 9, fontWeight: 800, color: "#d97706", background: "rgba(245,158,11,0.1)", borderRadius: 8, padding: "1px 6px" }}>proxy</span>}
                  <span style={{ fontSize: 10, color: "#64748b" }}>{h.ts}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MAIN 3-COL LAYOUT ── */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: sideOpen ? "230px 1fr" : "1fr", gap: 14, padding: "14px 16px 0", alignItems: "start" }}>

        {/* ── LEFT: PRESETS SIDEBAR ── */}
        {sideOpen && (
          <div style={{ ...card, padding: "14px 14px", display: "flex", flexDirection: "column", gap: 10, maxHeight: "calc(100vh - 140px)", overflowY: "auto" }}>
            <input value={sideSearch} onChange={(e) => setSideSearch(e.target.value)} placeholder="Search presets…" style={{ ...inp, fontSize: 12 }} />
            {filteredSamples.map((g) => (
              <div key={g.group}>
                <span style={{ ...kicker, marginBottom: 5 }}>{g.group}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {g.items.map((item) => (
                    <button key={item.label} type="button" onClick={() => loadPreset(item)} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8,
                      border: "1px solid rgba(15,23,42,0.07)", background: "#f8fafc",
                      cursor: "pointer", textAlign: "left", transition: "all 0.12s",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(99,102,241,0.06)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.2)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#f8fafc"; e.currentTarget.style.borderColor = "rgba(15,23,42,0.07)"; }}
                    >
                      <span style={{ fontSize: 9, fontWeight: 800, color: METHOD_COLORS[item.method] || "#6366f1", minWidth: 32 }}>{item.method}</span>
                      <span style={{ fontSize: 11, color: "#374151", lineHeight: 1.3 }}>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── RIGHT: REQUEST + RESPONSE ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── REQUEST CARD ── */}
          <div style={{ ...card, padding: "18px 20px" }}>
            <span style={kicker}>Request</span>

            {/* URL bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {/* Method */}
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={{
                padding: "8px 12px", borderRadius: 9, border: `2px solid ${METHOD_COLORS[method]}22`,
                fontSize: 13, fontWeight: 800, color: METHOD_COLORS[method], background: `${METHOD_COLORS[method]}12`,
                outline: "none", cursor: "pointer", minWidth: 96,
              }}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>

              {/* URL */}
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/endpoint" style={{ ...inp, flex: 1, fontFamily: "monospace", fontSize: 12 }} onKeyDown={(e) => { if (e.key === "Enter" && !busy) sendRequest(); }} />

              {/* Timeout */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.1)", borderRadius: 9, padding: "0 12px", flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>Timeout</span>
                <input type="number" min={1} max={300} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} style={{ width: 50, border: "none", outline: "none", background: "transparent", fontSize: 13, fontWeight: 700, color: "#1e293b", textAlign: "center" }} />
                <span style={{ fontSize: 11, color: "#94a3b8" }}>s</span>
              </div>

              {/* Send / Abort */}
              {busy ? (
                <button type="button" onClick={abort} style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "rgba(239,68,68,0.15)", color: "#ef4444", fontWeight: 800, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
                  ✕ Abort
                </button>
              ) : (
                <button type="button" onClick={sendRequest} disabled={!url.trim()} style={{
                  padding: "8px 22px", borderRadius: 9, border: "none",
                  background: url.trim() ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "rgba(15,23,42,0.08)",
                  color: url.trim() ? "#fff" : "#94a3b8", fontWeight: 800, fontSize: 13,
                  cursor: url.trim() ? "pointer" : "not-allowed", flexShrink: 0,
                  boxShadow: url.trim() ? "0 3px 12px rgba(99,102,241,0.32)" : "none",
                }}>
                  ▶ Send
                </button>
              )}
            </div>

            {/* Request tabs */}
            <TabBar
              tabs={[
                { id: "headers", label: `Headers (${headers.filter((h) => h.k).length})` },
                { id: "body",    label: "Body" },
                { id: "settings", label: "Settings" },
              ]}
              active={reqTab}
              onSelect={setReqTab}
            />

            {reqTab === "headers" && (
              <KVEditor rows={headers} onChange={setHeaders} placeholder="Header" />
            )}

            {reqTab === "body" && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {["none", "json", "form", "raw"].map((t) => (
                    <button key={t} type="button" onClick={() => setBodyTab(t)} style={{
                      padding: "5px 13px", borderRadius: 7, border: "none", cursor: "pointer",
                      fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                      background: bodyTab === t ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.04)",
                      color: bodyTab === t ? "#6366f1" : "#64748b",
                    }}>{t}</button>
                  ))}
                </div>
                {bodyTab === "none" && <p style={{ fontSize: 12, color: "#94a3b8" }}>No request body.</p>}
                {(bodyTab === "json" || bodyTab === "raw") && (
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder={bodyTab === "json" ? '{\n  "key": "value"\n}' : "Raw body text…"} style={{ ...inp, fontFamily: "monospace", fontSize: 12, resize: "vertical", lineHeight: 1.6 }} />
                )}
                {bodyTab === "form" && (
                  <KVEditor rows={formRows} onChange={setFormRows} placeholder="Field" />
                )}
              </div>
            )}

            {reqTab === "settings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <span style={kicker}>Request Timeout (seconds)</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input type="range" min={1} max={300} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} style={{ flex: 1, accentColor: "#6366f1" }} />
                    <input type="number" min={1} max={300} value={timeout} onChange={(e) => setTimeout_(Number(e.target.value))} style={{ ...inp, width: 80 }} />
                    <span style={{ fontSize: 12, color: "#64748b" }}>seconds</span>
                  </div>
                  <p style={{ fontSize: 12, color: "#94a3b8", margin: "6px 0 0" }}>Request will be aborted after {timeout}s if no response is received.</p>
                </div>
                <div style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 10, padding: "12px 16px" }}>
                  <span style={kicker}>Quick Timeout Presets</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {[5, 10, 15, 30, 60, 90, 120].map((t) => (
                      <button key={t} type="button" onClick={() => setTimeout_(t)} style={{
                        padding: "5px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
                        background: timeout === t ? "#6366f1" : "rgba(99,102,241,0.08)",
                        color: timeout === t ? "#fff" : "#6366f1",
                      }}>{t}s</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── RESPONSE CARD ── */}
          <div style={{ ...card, padding: "18px 20px" }}>

            {/* Response status bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={kicker}>Response</span>
                {res?.proxied && (
                  <span style={{ fontSize: 10, fontWeight: 800, background: "rgba(245,158,11,0.12)", color: "#d97706", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 20, padding: "2px 10px", letterSpacing: "0.05em" }}>
                    🔀 Via Proxy
                  </span>
                )}
              </div>
              {res && (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {/* Status code */}
                  <div style={{ display: "flex", align: "center", gap: 6, background: `${statusColor(res.status)}18`, border: `1px solid ${statusColor(res.status)}40`, borderRadius: 9, padding: "5px 14px" }}>
                    <span style={{ fontSize: 18, fontWeight: 900, color: statusColor(res.status), lineHeight: 1 }}>{res.status}</span>
                    <span style={{ fontSize: 12, color: statusColor(res.status), fontWeight: 600, alignSelf: "center" }}>{res.statusText}</span>
                  </div>
                  {/* Time */}
                  <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 9, padding: "5px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: res.time < 500 ? "#10b981" : res.time < 1500 ? "#f59e0b" : "#ef4444", lineHeight: 1 }}>{res.time} <span style={{ fontSize: 10 }}>ms</span></div>
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Time</div>
                  </div>
                  {/* Size */}
                  <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 9, padding: "5px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: "#6366f1", lineHeight: 1 }}>{formatBytes(res.size)}</div>
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Size</div>
                  </div>
                  {/* Speed rating */}
                  <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 9, padding: "5px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 900, color: res.time < 200 ? "#10b981" : res.time < 500 ? "#34d399" : res.time < 1500 ? "#f59e0b" : "#ef4444", lineHeight: 1 }}>
                      {res.time < 200 ? "Excellent" : res.time < 500 ? "Good" : res.time < 1500 ? "Slow" : "Very Slow"}
                    </div>
                    <div style={{ fontSize: 9, color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Speed</div>
                  </div>
                </div>
              )}
              {busy && (
                <div style={{ display: "flex", align: "center", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#6366f1", animation: "pulse 1s infinite" }} />
                  <span style={{ fontSize: 13, color: "#6366f1", fontWeight: 700 }}>Sending request…</span>
                </div>
              )}
            </div>

            {/* Speed bar (visual) */}
            {res && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ height: 5, background: "rgba(15,23,42,0.06)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 10, transition: "width 0.4s",
                    width: `${Math.min(100, (res.time / 3000) * 100)}%`,
                    background: res.time < 200 ? "#10b981" : res.time < 500 ? "#34d399" : res.time < 1500 ? "#f59e0b" : "#ef4444",
                  }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>0ms</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>500ms</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>1500ms</span>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>3000ms+</span>
                </div>
              </div>
            )}

            {err && (
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 16px", fontSize: 13, color: "#dc2626", marginBottom: 14 }}>
                <strong>Error:</strong> {err}
              </div>
            )}

            {!res && !busy && !err && (
              <div style={{ textAlign: "center", padding: "50px 0", color: "#94a3b8" }}>
                <div style={{ fontSize: 44, marginBottom: 14 }}>⚡</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", marginBottom: 6 }}>Ready to fire</div>
                <div style={{ fontSize: 13 }}>Configure your request above and click Send, or choose a preset from the sidebar.</div>
              </div>
            )}

            {res && (
              <>
                <TabBar
                  tabs={[
                    { id: "body",    label: "Body" },
                    { id: "headers", label: `Headers (${Object.keys(res.headers).length})` },
                    { id: "info",    label: "Analytics" },
                  ]}
                  active={resTab}
                  onSelect={setResTab}
                />

                {resTab === "body" && (
                  <div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
                      {isJsonResp && (
                        <>
                          <button type="button" onClick={() => setResView("pretty")} style={{ padding: "4px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, background: resView === "pretty" ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.05)", color: resView === "pretty" ? "#6366f1" : "#64748b" }}>Pretty</button>
                          <button type="button" onClick={() => setResView("raw")} style={{ padding: "4px 12px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, background: resView === "raw" ? "rgba(99,102,241,0.12)" : "rgba(15,23,42,0.05)", color: resView === "raw" ? "#6366f1" : "#64748b" }}>Raw</button>
                        </>
                      )}
                      <button type="button" onClick={() => navigator.clipboard?.writeText(res.body)} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 7, border: "1px solid rgba(15,23,42,0.1)", fontSize: 11, fontWeight: 600, background: "#fff", color: "#64748b", cursor: "pointer" }}>⎘ Copy</button>
                    </div>
                    <pre style={{ margin: 0, background: "#0f172a", color: "#e2e8f0", borderRadius: 12, padding: "16px 18px", fontSize: 12, lineHeight: 1.65, overflow: "auto", maxHeight: 480, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {bodyText || <span style={{ color: "#475569" }}>(empty body)</span>}
                    </pre>
                  </div>
                )}

                {resTab === "headers" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {Object.entries(res.headers).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", gap: 10, padding: "7px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid rgba(15,23,42,0.05)" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", minWidth: 200, fontFamily: "monospace" }}>{k}</span>
                        <span style={{ fontSize: 12, color: "#374151", flex: 1, wordBreak: "break-all", fontFamily: "monospace" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}

                {resTab === "info" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {/* Speed breakdown */}
                    <div style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 12, padding: "16px 18px" }}>
                      <span style={kicker}>Speed Analytics</span>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                        {[
                          { label: "Total Time",     val: `${res.time} ms`,       color: statusColor(res.status) },
                          { label: "Response Size",  val: formatBytes(res.size),  color: "#6366f1" },
                          { label: "Status Code",    val: res.status,             color: statusColor(res.status) },
                          { label: "Speed Rating",   val: res.time < 200 ? "Excellent" : res.time < 500 ? "Good" : res.time < 1500 ? "Slow" : "Very Slow", color: res.time < 200 ? "#10b981" : res.time < 500 ? "#34d399" : res.time < 1500 ? "#f59e0b" : "#ef4444" },
                        ].map((item) => (
                          <div key={item.label} style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
                            <div style={{ fontSize: 20, fontWeight: 900, color: item.color, lineHeight: 1 }}>{item.val}</div>
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5, fontWeight: 700, textTransform: "uppercase" }}>{item.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Time breakdown visual */}
                    <div style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 12, padding: "16px 18px" }}>
                      <span style={kicker}>Response Time Benchmark</span>
                      {[
                        { label: "Excellent (< 200ms)", threshold: 200, color: "#10b981" },
                        { label: "Good (200–500ms)",     threshold: 500, color: "#34d399" },
                        { label: "Slow (500–1500ms)",    threshold: 1500, color: "#f59e0b" },
                        { label: "Very Slow (> 1500ms)", threshold: 9999, color: "#ef4444" },
                      ].map((tier) => {
                        const inTier = res.time < tier.threshold && (tier.threshold === 200 || res.time >= [200, 500, 1500][["Good (200–500ms)", "Slow (500–1500ms)", "Very Slow (> 1500ms)"].indexOf(tier.label)] || tier.label === "Excellent (< 200ms)");
                        return (
                          <div key={tier.label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: inTier ? tier.color : "#94a3b8", fontWeight: inTier ? 700 : 400, minWidth: 180 }}>{inTier ? "▶ " : "  "}{tier.label}</span>
                            <div style={{ flex: 1, height: 8, background: "rgba(15,23,42,0.06)", borderRadius: 10, overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: 10, width: inTier ? "100%" : "0%", background: tier.color, transition: "width 0.4s" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Request summary */}
                    <div style={{ background: "#f8fafc", border: "1px solid rgba(15,23,42,0.07)", borderRadius: 12, padding: "16px 18px" }}>
                      <span style={kicker}>Request Summary</span>
                      {[
                        { label: "Method",   val: method },
                        { label: "URL",      val: applyEnv(url) },
                        { label: "Timeout",  val: `${timeout}s` },
                        { label: "Headers",  val: `${headers.filter((h) => h.k).length} sent` },
                        { label: "Body",     val: bodyTab === "none" ? "None" : bodyTab.toUpperCase() },
                      ].map((item) => (
                        <div key={item.label} style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid rgba(15,23,42,0.04)" }}>
                          <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 80 }}>{item.label}</span>
                          <span style={{ fontSize: 12, color: "#1e293b", fontWeight: 600, fontFamily: item.label === "URL" ? "monospace" : "inherit", wordBreak: "break-all" }}>{item.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.4;} }
      `}</style>
    </div>
  );
}
