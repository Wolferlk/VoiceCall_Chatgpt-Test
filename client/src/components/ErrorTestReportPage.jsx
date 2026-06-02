import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_LARAVEL_API_BASE_URL || "http://localhost:8000/api";

function downloadJsonFile(payload, fileName = "error-reports.json") {
  if (typeof window === "undefined") return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function formatDate(value) {
  if (!value) return "just now";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "just now";
  }
}

export default function ErrorTestReportPage() {
  const [title, setTitle] = useState("Realtime Test Report");
  const [severity, setSeverity] = useState("medium");
  const [details, setDetails] = useState("");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadAllSaving, setDownloadAllSaving] = useState(false);
  const [resetSaving, setResetSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState("list"); // list | report | new
  const [filterText, setFilterText] = useState("");

  const selectedReport = useMemo(() => {
    if (!reports.length) return null;
    return reports[Math.max(0, Math.min(selectedIndex, reports.length - 1))] || null;
  }, [reports, selectedIndex]);

  async function loadReports() {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/aahaas-realtime/error-reports`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not load submitted errors.");
      setReports(Array.isArray(data.reports) ? data.reports : []);
      setSelectedIndex((current) => {
        const maxIndex = Math.max(0, (Array.isArray(data.reports) ? data.reports.length : 0) - 1);
        return Math.min(current, maxIndex);
      });
    } catch (err) {
      setMessage(err.message || "Could not load submitted errors.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReport() {
    const cleanTitle = title.trim();
    const cleanDetails = details.trim();
    if (!cleanTitle || !cleanDetails) {
      setMessage("Title and error details are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/aahaas-realtime/error-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          title: cleanTitle,
          details: cleanDetails,
          severity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not save error report.");

      const saved = data.report || null;
      if (saved) {
        setReports((current) => [saved, ...current.filter((report) => report.report_id !== saved.report_id)]);
        setSelectedIndex(0);
        setTab("report");
      }
      setDetails("");
      setMessage(`Saved to the database as ${saved?.report_id || "new error report"}.`);
    } catch (err) {
      setMessage(err.message || "Could not save error report.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadAllReports() {
    setDownloadAllSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/aahaas-realtime/error-reports/download`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not download all error reports.");

      downloadJsonFile(data.payload || {}, data.file_name || "error-reports.json");
      setMessage(`Downloaded ${data.count || 0} error report(s) as one JSON file.`);
    } catch (err) {
      setMessage(err.message || "Could not download all error reports.");
    } finally {
      setDownloadAllSaving(false);
    }
  }

  async function resetAllReports() {
    if (typeof window !== "undefined" && !window.confirm("Delete all submitted error reports? This cannot be undone.")) {
      return;
    }

    setResetSaving(true);
    setMessage("");
    try {
      const res = await fetch(`${API_BASE_URL}/aahaas-realtime/error-reports`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not reset error reports.");

      setReports([]);
      setSelectedIndex(0);
      setTab("new");
      setMessage(`Deleted ${data.deleted || 0} submitted error report(s).`);
    } catch (err) {
      setMessage(err.message || "Could not reset error reports.");
    } finally {
      setResetSaving(false);
    }
  }

  useEffect(() => {
    loadReports().catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedReport) {
      setMessage("");
    }
  }, [selectedReport]);

  const filteredReports = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => {
      const haystack = [
        report.report_id,
        report.title,
        report.severity,
        report.details,
        report.country,
        report.phase,
        report.session_id,
        report.current_error,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [filterText, reports]);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (filteredReports.length === 0) return 0;
      return Math.min(current, filteredReports.length - 1);
    });
  }, [filteredReports.length]);

  const visibleSelectedReport = filteredReports[selectedIndex] || null;

  return (
    <div className="page-shell">
      <div className="top-nav">
        <div>
          <strong className="top-nav-title">Error Test Report</strong>
          <div style={{ color: "#64748b", fontSize: 12 }}>Standalone page for submitted report data, download, and reset.</div>
        </div>
        <div className="top-nav-actions">
          <button type="button" className="top-nav-button" onClick={() => { window.location.hash = "#/"; }}>
            Back to Workspace
          </button>
          <button type="button" className="top-nav-button top-nav-button-active" onClick={() => setTab("new")}>
            New Report
          </button>
          <button type="button" className="top-nav-button" onClick={() => setTab("list")}>
            Stored Data
          </button>
        </div>
      </div>

      <section className="hero-card" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div>
          <p className="eyebrow">Aahaas Realtime V0.2</p>
          <h1>Submit error reports, review them one by one, and export everything as one JSON file.</h1>
          <p className="hero-copy">
            This page is built for testing, QA, and troubleshooting. You can save report data, inspect stored errors,
            download all reports into a single JSON file, or delete everything when you want a clean slate.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <button type="button" className="primary-button" onClick={() => setTab("new")}>
              Write New Error
            </button>
            <button type="button" className="secondary-button" onClick={() => setTab("list")}>
              Open Stored Data
            </button>
          </div>
          {message ? <p className="error-text" style={{ marginTop: 16 }}>{message}</p> : null}
        </div>
        <aside className="status-card">
          <span>Database Status</span>
          <strong>{loading ? "Loading reports..." : `${reports.length} stored report(s)`}</strong>
          <div style={{ fontSize: 13, color: "rgba(247,250,249,0.8)" }}>
            Submitted errors are saved in the database first, then exported only when you ask for a download.
          </div>
        </aside>
      </section>

      <div className="panel-grid" style={{ gridTemplateColumns: "1.1fr 0.9fr" }}>
        <section className="panel" style={{ padding: 24 }}>
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <div>
              <p className="workspace-kicker">Report Tools</p>
              <h2 style={{ marginBottom: 0 }}>Submit and manage error reports</h2>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" className={tab === "new" ? "primary-button" : "secondary-button"} onClick={() => setTab("new")}>
                New Report
              </button>
              <button type="button" className={tab === "list" ? "primary-button" : "secondary-button"} onClick={() => { setTab("list"); loadReports().catch(() => {}); }}>
                Stored Data
              </button>
            </div>
          </div>

          {tab === "new" ? (
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              <label>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#334155" }}>Report Title</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Realtime Test Report"
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.85)" }}
                />
              </label>

              <label>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#334155" }}>Severity</div>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.85)" }}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <label>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: "#334155" }}>Error Details</div>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={10}
                  placeholder="Describe the error, the scenario, and what you want to keep for QA..."
                  style={{ width: "100%", padding: "14px", borderRadius: 18, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.88)", resize: "vertical" }}
                />
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" className="primary-button" onClick={submitReport} disabled={saving}>
                  {saving ? "Saving..." : "Submit Error"}
                </button>
                <button type="button" className="secondary-button" onClick={() => setTab("list")}>
                  View Submitted Errors
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              <div className="records-toolbar">
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" className="primary-button" onClick={loadReports} disabled={loading}>
                    {loading ? "Loading..." : "List All Submitted Errors"}
                  </button>
                  <button type="button" className="secondary-button" onClick={downloadAllReports} disabled={downloadAllSaving || filteredReports.length === 0}>
                    {downloadAllSaving ? "Downloading..." : "Download All"}
                  </button>
                  <button type="button" className="secondary-button" onClick={resetAllReports} disabled={resetSaving || filteredReports.length === 0}>
                    {resetSaving ? "Deleting..." : "Reset All Errors"}
                  </button>
                </div>
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Search reports..."
                  style={{ minWidth: 240, padding: "12px 14px", borderRadius: 14, border: "1px solid rgba(15,23,42,0.12)", background: "rgba(255,255,255,0.85)" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.2fr", gap: 16 }}>
                <div style={{ display: "grid", gap: 10, maxHeight: 620, overflowY: "auto", paddingRight: 4 }}>
                  {filteredReports.length === 0 ? (
                    <div style={{ padding: 16, borderRadius: 16, background: "rgba(255,255,255,0.7)", border: "1px solid rgba(15,23,42,0.08)" }}>
                      No submitted errors yet.
                    </div>
                  ) : (
                    filteredReports.map((report, index) => {
                      const active = index === selectedIndex;
                      return (
                        <button
                          key={report.report_id}
                          type="button"
                          className="panel"
                          onClick={() => setSelectedIndex(index)}
                          style={{
                            textAlign: "left",
                            padding: 16,
                            borderRadius: 18,
                            borderColor: active ? "rgba(99,102,241,0.35)" : "rgba(22,33,31,0.08)",
                            background: active ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.72)",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                            <div>
                              <div style={{ fontWeight: 800, color: "#16211f" }}>
                                {index + 1}. {report.title}
                              </div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                {report.report_id} · {report.severity || "medium"}
                              </div>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>{formatDate(report.created_at)}</span>
                          </div>
                          <p className="panel-copy" style={{ marginTop: 10, marginBottom: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {report.details}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="panel" style={{ padding: 20, minHeight: 620 }}>
                  {visibleSelectedReport ? (
                    <div style={{ display: "grid", gap: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div>
                          <p className="workspace-kicker" style={{ marginBottom: 4 }}>Stored Report</p>
                          <h2 style={{ marginBottom: 0 }}>{visibleSelectedReport.title}</h2>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                            disabled={selectedIndex === 0}
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setSelectedIndex((i) => Math.min(filteredReports.length - 1, i + 1))}
                            disabled={selectedIndex >= filteredReports.length - 1}
                          >
                            Next
                          </button>
                        </div>
                      </div>

                      <div className="mode-preview-card">
                        <strong>{visibleSelectedReport.report_id}</strong>
                        <p>{visibleSelectedReport.severity || "medium"} · {formatDate(visibleSelectedReport.created_at)}</p>
                      </div>

                      <div style={{ display: "grid", gap: 12 }}>
                        <div className="mode-preview-card">
                          <strong>Details</strong>
                          <p style={{ whiteSpace: "pre-wrap" }}>{visibleSelectedReport.details}</p>
                        </div>
                        <div className="mode-preview-card">
                          <strong>Meta</strong>
                          <p>
                            Session: {visibleSelectedReport.session_id || "n/a"}
                            <br />
                            Country: {visibleSelectedReport.country || "n/a"}
                            <br />
                            Phase: {visibleSelectedReport.phase || "n/a"}
                            <br />
                            Package: {visibleSelectedReport.package_status || "n/a"}
                            <br />
                            Quote: {visibleSelectedReport.quotation_status || "n/a"}
                          </p>
                        </div>
                        <div className="mode-preview-card">
                          <strong>Conversation</strong>
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            {(visibleSelectedReport.conversation || []).length
                              ? JSON.stringify(visibleSelectedReport.conversation, null, 2)
                              : "No conversation stored."}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      Select a submitted error to inspect it here.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="panel" style={{ padding: 24 }}>
          <p className="workspace-kicker">Quick Actions</p>
          <h2>What this page does</h2>
          <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
            <div className="mode-preview-card">
              <strong>Submit</strong>
              <p>Save the error report to the database with a title, severity, and details.</p>
            </div>
            <div className="mode-preview-card">
              <strong>List</strong>
              <p>Load all submitted errors and browse them one by one on the right panel.</p>
            </div>
            <div className="mode-preview-card">
              <strong>Download</strong>
              <p>Export all reports as one JSON file from the backend and download it locally.</p>
            </div>
            <div className="mode-preview-card">
              <strong>Reset</strong>
              <p>Delete all submitted error reports when you want to clear the dataset.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
