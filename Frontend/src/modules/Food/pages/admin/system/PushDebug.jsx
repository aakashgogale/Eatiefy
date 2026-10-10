import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info, Loader2, Search, XCircle } from "lucide-react";
import { adminAPI } from "@food/api";

const OWNER_TYPES = [
  { value: "USER", label: "Customer (user app)" },
  { value: "RESTAURANT", label: "Restaurant" },
  { value: "DELIVERY_PARTNER", label: "Delivery partner" },
];

const LEVEL_STYLES = {
  error: { icon: XCircle, box: "border-red-200 bg-red-50 text-red-800", iconColor: "text-red-600" },
  warn: { icon: AlertTriangle, box: "border-amber-200 bg-amber-50 text-amber-900", iconColor: "text-amber-600" },
  info: { icon: Info, box: "border-emerald-200 bg-emerald-50 text-emerald-900", iconColor: "text-emerald-600" },
};

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
};

function FirebaseAnswer({ label, answer }) {
  if (!answer) return null;
  return (
    <div className={`text-xs ${answer.ok ? "text-emerald-700" : "text-red-700"}`}>
      <span className="font-semibold">{label}: </span>
      {answer.ok
        ? `accepted${answer.messageId ? ` (${answer.messageId})` : ""}`
        : `${answer.errorCode || answer.status || "failed"} — ${answer.error}`}
    </div>
  );
}

export default function PushDebug() {
  const [ownerType, setOwnerType] = useState("USER");
  const [query, setQuery] = useState("");
  const [testSend, setTestSend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const run = async (event) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await adminAPI.runPushDebug({ ownerType, query: query.trim(), testSend });
      setResult(response?.data?.data || response?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || "Diagnostics failed");
    } finally {
      setLoading(false);
    }
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy automatically — select and copy the report manually.");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Push Debug</h1>
        <p className="text-sm text-gray-600">
          Checks the whole chain for one account: saved tokens, what the app reported, and what Firebase says about
          each token. Search by phone number or account id.
        </p>
      </div>

      <form onSubmit={run} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
          <select
            value={ownerType}
            onChange={(e) => setOwnerType(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {OWNER_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone number or account id"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={testSend} onChange={(e) => setTestSend(e.target.checked)} />
          Also send a real test push to this account&apos;s devices
        </label>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#D91F3A] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Checking…" : "Run diagnostics"}
        </button>
      </form>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      {result && (
        <div className="space-y-4">
          <div className="space-y-2">
            {(result.findings || []).map((finding, index) => {
              const style = LEVEL_STYLES[finding.level] || LEVEL_STYLES.info;
              const Icon = style.icon;
              return (
                <div key={index} className={`flex gap-2 rounded-lg border p-3 text-sm ${style.box}`}>
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
                  <span>{finding.text}</span>
                </div>
              );
            })}
          </div>

          {result.found && (
            <>
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-gray-900">{result.owner.label}</div>
                    <div className="text-gray-600">
                      {result.owner.phone} · {result.owner.type} · id {result.owner.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyReport}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                  >
                    {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy report"}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-gray-50 p-2">Web tokens: <b>{result.counts.web}</b></div>
                  <div className="rounded-lg bg-gray-50 p-2">Mobile tokens: <b>{result.counts.mobile}</b></div>
                  <div className="rounded-lg bg-gray-50 p-2">VoIP devices: <b>{result.counts.voipDevices}</b></div>
                  <div className="rounded-lg bg-gray-50 p-2">
                    In broadcasts: <b>{result.owner.eligibleForBroadcast ? "yes" : "no"}</b>
                  </div>
                </div>
              </div>

              {result.tokens.length > 0 && (
                <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
                  <h2 className="text-sm font-semibold text-gray-900">Saved tokens</h2>
                  {result.tokens.map((row, index) => (
                    <div key={index} className="rounded-lg border border-gray-100 p-3">
                      <div className="text-xs text-gray-700">
                        <b>{row.platform}</b> · {row.token} · {row.length} chars · type: {row.kind}
                      </div>
                      {row.sharedWith.length > 0 && (
                        <div className="text-xs text-amber-700">Also on: {row.sharedWith.join(", ")}</div>
                      )}
                      <FirebaseAnswer label="Firebase validation" answer={row.validation} />
                      <FirebaseAnswer label="Real test push" answer={row.send} />
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 text-sm">
                <h2 className="font-semibold text-gray-900">App reports (native token failures)</h2>
                {result.clientReports.length === 0 ? (
                  <p className="text-gray-600">None. The app has not reported a token problem.</p>
                ) : (
                  result.clientReports.map((report, index) => (
                    <div key={index} className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                      <div className="font-semibold">
                        {formatDate(report.at)} · bridge present: {String(report.hasCallHandler)} · token found:{" "}
                        {String(report.tokenFound)}
                      </div>
                      {report.env && (
                        <div>
                          Device: Flutter bridge {report.env.flutter ? "yes" : "NO"} · installed web app{" "}
                          {report.env.standalone ? "yes" : "no"} · web permission {report.env.webPermission}
                        </div>
                      )}
                      <div>
                        Notification permission:{" "}
                        {!report.permission
                          ? "not reported"
                          : report.permission.handler
                            ? `${report.permission.handler} answered "${report.permission.result}"`
                            : "NO permission handler in the app"}
                      </div>
                      {report.tokenFound ? null : Object.keys(report.handlers || {}).length === 0 ? (
                        <div>No bridge handler answered in time.</div>
                      ) : (
                        Object.entries(report.handlers).map(([name, outcome]) => (
                          <div key={name}>
                            {name}: {outcome}
                          </div>
                        ))
                      )}
                      <div className="mt-1 break-all text-gray-500">{report.userAgent}</div>
                    </div>
                  ))
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                  <h2 className="mb-2 font-semibold text-gray-900">Recent broadcasts that targeted this account</h2>
                  {result.recentBroadcasts.length === 0 ? (
                    <p className="text-gray-600">None.</p>
                  ) : (
                    result.recentBroadcasts.map((b, index) => (
                      <div key={index} className="text-xs text-gray-700">
                        {formatDate(b.at)} · {b.title}
                      </div>
                    ))
                  )}
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm">
                  <h2 className="mb-2 font-semibold text-gray-900">Recent in-app inbox items</h2>
                  {result.recentInbox.length === 0 ? (
                    <p className="text-gray-600">None.</p>
                  ) : (
                    result.recentInbox.map((n, index) => (
                      <div key={index} className="text-xs text-gray-700">
                        {formatDate(n.at)} · {n.title}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
