import { useEffect, useState, type FormEvent } from "react";
import "./style.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

type Role = "administrator" | "reviewer";
type Recommendation = "APPROVED" | "DENIED" | "ESCALATED";

interface User {
  id: string;
  username: string;
  role: Role;
}
interface Policy {
  id: string;
  policy_key: string;
  version: number;
  title: string;
  policy_text: string;
  status: string;
  created_at: string;
}
interface PolicyRule {
  id: string;
  name: string;
  rule_type: string;
  target_field: string;
  operator: string;
  threshold: unknown;
  evidence_passage: string;
  status: string;
}
interface PolicyDetails extends Policy {
  rules: PolicyRule[];
}
interface RuleResult {
  ruleId: string;
  ruleName: string;
  status: "PASS" | "FAIL" | "MISSING_INFO";
  observedValue: unknown;
  explanation: string;
}
interface Decision {
  id: string;
  caseId: string;
  policyVersionId: string;
  recommendation: Recommendation;
  escalationReasons: string[];
  ruleResults: RuleResult[];
}
interface QueueDecision {
  id: string;
  caseId: string;
  policyVersionId: string;
  policyTitle: string;
  recommendation: Recommendation;
  escalationReasons: string[];
  applicantData: Record<string, unknown>;
  submittedAt: string;
  createdAt: string;
}
interface HistoryDecision {
  id: string;
  caseId: string;
  recommendation: Recommendation;
  decisionCreatedAt: string;
  reviewAction: string | null;
  reviewOutcome: string;
  reviewReason: string | null;
  reviewCreatedAt: string | null;
  reviewerUsername: string | null;
}
interface ApiError {
  error?: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}
type Page = "overview" | "policies" | "application" | "reviews" | "history";

async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) {
  const apiError = data as ApiError;
  const details = apiError.details
    ?.map((issue) => `${issue.field}: ${issue.message}`)
    .join("; ");

  throw new Error(
    [apiError.error || `Request failed (${response.status}).`, details]
      .filter(Boolean)
      .join(" ")
  );
}
  return data as T;
}
function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("decisiontrace_token") || "");
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("decisiontrace_user");
      return stored ? (JSON.parse(stored) as User) : null;
    } catch {
      return null;
    }
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [policyDetails, setPolicyDetails] = useState<PolicyDetails | null>(null);
  const [queue, setQueue] = useState<QueueDecision[]>([]);
  const [history, setHistory] = useState<HistoryDecision[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState("");
  const [notice, setNotice] = useState("");
  const [applicantAge, setApplicantAge] = useState("30");
  const [organisationRegistered, setOrganisationRegistered] = useState("Yes");
  const [fundingAmount, setFundingAmount] = useState("30000");
  const [submissionDate, setSubmissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [projectDescription, setProjectDescription] = useState("");
  const [impactStatement, setImpactStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [latestDecision, setLatestDecision] = useState<Decision | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState("");

  function logout() {
    localStorage.removeItem("decisiontrace_token");
    localStorage.removeItem("decisiontrace_user");
    setToken("");
    setUser(null);
    setPassword("");
    setPolicies([]);
    setPolicyDetails(null);
    setQueue([]);
    setLatestDecision(null);
    setPage("overview");
  }

  async function loadWorkspace(currentToken: string, currentUser: User | null = user) {
    setLoadingData(true);
    setDataError("");
    try {
      const policyData = await apiRequest<{ policies: Policy[] }>("/policies", currentToken);
      const loadedPolicies = policyData.policies || [];
      setPolicies(loadedPolicies);
      const activePolicy = loadedPolicies.find((policy) => policy.status === "active");
      if (activePolicy) {
        const details = await apiRequest<{
  policy: Policy;
  rules: PolicyRule[];
}>(`/policies/${activePolicy.id}`, currentToken);

setPolicyDetails({
  ...details.policy,
  rules: details.rules,
});
      } else {
        setPolicyDetails(null);
      }
      if (currentUser?.role === "reviewer") {
  const queueData = await apiRequest<{ decisions: QueueDecision[] }>("/decisions/review-queue", currentToken);
  setQueue(queueData.decisions || []);
  setHistory([]);
} else {
  setQueue([]);
  setHistory([]);

  if (currentUser?.role === "administrator") {
    const historyData = await apiRequest<{ decisions: HistoryDecision[] }>(
      "/decisions/history",
      currentToken
    );
    setHistory(historyData.decisions || []);
  } else {
    setHistory([]);
  }
}
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load dashboard.";
      setDataError(message);
      if (/token|authentication|unauthorized|expired/i.test(message)) logout();
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (token && user) void loadWorkspace(token, user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.id]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await response.json()) as { token?: string; user?: User; error?: string };
      if (!response.ok || !data.token || !data.user) throw new Error(data.error || "Unable to sign in.");
      localStorage.setItem("decisiontrace_token", data.token);
      localStorage.setItem("decisiontrace_user", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setPassword("");
      setPage("overview");
    } catch (error) {
      setLoginError(error instanceof TypeError
        ? "Cannot connect to the backend. Check that it is running."
        : error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  }

  async function submitApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setDataError("");
    setLatestDecision(null);
    if (!policyDetails) {
      setDataError("There is no active policy available for submissions.");
      return;
    }
    const age = Number(applicantAge);
    const funding = Number(fundingAmount);
    if (applicantAge.trim() === "" || !Number.isFinite(age) || fundingAmount.trim() === "" || !Number.isFinite(funding)) {
      setDataError("Enter a valid applicant age and funding amount.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiRequest<{ decision: Decision }>("/decisions", token, {
        method: "POST",
        body: JSON.stringify({
          policyId: policyDetails.id,
          applicantData: {
            applicant_age: age,
            organisation_registered: organisationRegistered,
            funding_amount_requested: funding,
            submission_date: submissionDate,
            project_description: projectDescription,
            impact_statement: impactStatement,
          },
        }),
      });
      setLatestDecision(result.decision);
      setNotice("Application submitted and evaluated successfully.");
      setPage("application");
      if (user?.role === "reviewer") await loadWorkspace(token, user);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Application submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

    async function submitReview(decisionId: string, action: "APPROVE" | "OVERRIDE") {
    const reason = (reviewNotes[decisionId] || "").trim();

    if (reason.length < 10) {
      setDataError("Please enter a reviewer reason of at least 10 characters.");
      return;
    }

    setDataError("");
    setNotice("");
    setReviewingId(decisionId);

    try {
      await apiRequest(`/decisions/${decisionId}/review`, token, {
        method: "POST",
        body: JSON.stringify({ action, reason }),
      });

      setNotice(
        `Review recorded: ${action === "APPROVE" ? "Approved" : "Rejected"}. The machine recommendation remains unchanged.`
      );

      await loadWorkspace(token, user);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : "Unable to record review.");
    } finally {
      setReviewingId("");
    }
  
  }

  if (!token || !user) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-mark">DT</div>
          <div><h1>DecisionTrace</h1><p className="subtitle">Policy decisions you can explain.</p></div>
        </header>
        <section className="login-layout">
          <div className="welcome-panel">
            <p className="eyebrow">DECISION INTELLIGENCE</p>
            <h2>Every decision.<br />A clear explanation.</h2>
            <p className="welcome-description">Make consistent, policy-based decisions with transparent rule evaluations and an auditable history.</p>
            <div className="feature-list">
              <div className="feature-item"><span className="feature-icon">✓</span><div><strong>Rule-based evaluation</strong><span>Consistent outcomes from defined policy rules.</span></div></div>
              <div className="feature-item"><span className="feature-icon">◎</span><div><strong>Transparent reasoning</strong><span>See which rules passed, failed, or need review.</span></div></div>
              <div className="feature-item"><span className="feature-icon">↗</span><div><strong>Auditable decisions</strong><span>Keep a traceable record of evaluations and reviews.</span></div></div>
            </div>
          </div>
          <section className="login-card">
            <p className="eyebrow">SECURE ACCESS</p><h2>Sign in</h2>
            <p className="login-intro">Enter your DecisionTrace account details to continue.</p>
            <form onSubmit={handleLogin}>
              <label htmlFor="username">Username</label>
              <input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Enter your username" required />
              <label htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
              {loginError && <div className="error-message">{loginError}</div>}
              <button className="primary-button" disabled={loading}>{loading ? "Signing in..." : "Sign in securely"}</button>
            </form>
            <p className="security-note">Access is restricted to registered administrators and reviewers.</p>
          </section>
        </section>
        <footer>DecisionTrace · Deterministic evaluation · Auditable decisions</footer>
      </main>
    );
  }

  const activePolicy = policies.find((policy) => policy.status === "active");
  const validatedRuleCount = policyDetails?.rules.filter((rule) => rule.status === "validated").length || 0;
  const extractedRuleCount = policyDetails?.rules.filter((rule) => rule.status === "extracted").length || 0;

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark">DT</div><div><strong>DecisionTrace</strong><span>Decision intelligence</span></div></div>
        <p className="nav-heading">WORKSPACE</p>
        <nav className="navigation">
          <button className={page === "overview" ? "nav-item active" : "nav-item"} onClick={() => setPage("overview")}><span>▦</span> Overview</button>
          <button className={page === "policies" ? "nav-item active" : "nav-item"} onClick={() => setPage("policies")}><span>▤</span> Policies</button>
          <button className={page === "application" ? "nav-item active" : "nav-item"} onClick={() => setPage("application")}><span>＋</span> New application</button>
          {user.role === "reviewer" && (
  <button
    className={page === "reviews" ? "nav-item active" : "nav-item"}
    onClick={() => setPage("reviews")}
  >
    <span>◷</span> Review queue
    {queue.length > 0 && (
      <span className="nav-count">{queue.length}</span>
    )}
  </button>
)}

{user.role === "administrator" && (
  <button
    className={page === "history" ? "nav-item active" : "nav-item"}
    onClick={() => setPage("history")}
  >
    <span>▤</span> Decision history
  </button>
)}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card"><div className="avatar">{user.username.slice(0, 1).toUpperCase()}</div><div className="user-info"><strong>{user.username}</strong><span>{user.role}</span></div></div>
          <button className="signout-button" onClick={logout}>↪ Sign out</button>
        </div>
      </aside>

      <section className="main-panel">
                <header className="workspace-header">
          <div>
            <p className="eyebrow">POLICY OPERATIONS</p>
            <h1>
              {page === "overview"
                ? "Overview"
                : page === "policies"
                  ? "Policy library"
                  : page === "application"
                    ? "New application"
                    : page === "reviews"
                      ? "Review queue"
                      : "Decision history"}
            </h1>
          </div>
          <div className="header-user">
            <span className="online-dot" />
            {user.username} · {user.role}
          </div>
        </header>
        {dataError && <div className="error-message page-message" role="alert">{dataError}<button onClick={() => void loadWorkspace(token, user)}>Retry</button></div>}
        {notice && <div className="success-message">{notice}</div>}
        {loadingData && <p className="loading-message">Loading your workspace…</p>}

        {page === "overview" && <>
          <section className="page-intro"><div><h2>Good to see you, {user.username}.</h2><p>Here is the current state of your policy decision workspace.</p></div><button className="primary-button compact" onClick={() => setPage("application")}>+ New application</button></section>
          <section className="stats-grid">
            <article className="stat-card"><span className="stat-label">Policy versions</span><strong>{policies.length}</strong><span className="stat-caption">Available in your library</span></article>
            <article className="stat-card"><span className="stat-label">Active policies</span><strong>{policies.filter((p) => p.status === "active").length}</strong><span className="stat-caption">Accepting submissions</span></article>
            <article className="stat-card"><span className="stat-label">Validated rules</span><strong>{validatedRuleCount}</strong><span className="stat-caption">{extractedRuleCount} awaiting validation</span></article>
            <article className="stat-card"><span className="stat-label">Pending reviews</span><strong>{user.role === "reviewer" ? queue.length : "—"}</strong><span className="stat-caption">{user.role === "reviewer" ? "Escalated cases" : "Reviewer access required"}</span></article>
          </section>
          <section className="content-card">
            <div className="section-heading"><div><h2>Active policy</h2><p>The policy currently available for application evaluation.</p></div><button className="text-button" onClick={() => setPage("policies")}>View policies →</button></div>
            {activePolicy ? <div className="policy-summary"><div className="policy-icon">▤</div><div className="policy-summary-text"><strong>{activePolicy.title}</strong><span>Version {activePolicy.version} · {policyDetails?.rules.length || 0} rules</span></div><span className="badge badge-green">Active</span></div> : <p className="empty-state">No active policy was found.</p>}
          </section>
          <section className="content-card">
            <div className="section-heading"><div><h2>Get started</h2><p>Choose what you want to do next.</p></div></div>
            <div className="quick-actions">
              <button onClick={() => setPage("application")}><span className="quick-icon">＋</span><strong>Submit an application</strong><span>Evaluate an application against the active policy.</span></button>
              <button onClick={() => setPage("policies")}><span className="quick-icon">▤</span><strong>Inspect policy rules</strong><span>Review the current policy and its rule definitions.</span></button>
              {user.role === "reviewer" && <button onClick={() => setPage("reviews")}><span className="quick-icon">◷</span><strong>Review escalated cases</strong><span>Examine cases that need a human decision.</span></button>}
            </div>
          </section>
        </>}

        {page === "policies" && <section className="content-card">
          <div className="section-heading"><div><h2>Policy library</h2><p>Policies available to your account.</p></div></div>
          {policies.length === 0 ? <p className="empty-state">No policies were found.</p> : <div className="policy-list">
            {policies.map((policy) => <article className="policy-row" key={policy.id}>
              <div className="policy-icon">▤</div><div className="policy-summary-text"><strong>{policy.title}</strong><span>Version {policy.version} · {policy.policy_key}</span><span>{policy.policy_text}</span></div><span className={policy.status === "active" ? "badge badge-green" : "badge"}>{policy.status}</span>
            </article>)}
          </div>}
          {policyDetails && <div className="rules-section"><div className="section-heading"><div><h2>Rules in active policy</h2><p>{policyDetails.title} · Version {policyDetails.version}</p></div></div>
            {policyDetails.rules.map((rule) => <article className="rule-row" key={rule.id}><div><strong>{rule.name}</strong><p>{rule.target_field} {rule.operator} {displayValue(rule.threshold)}</p>{rule.evidence_passage && <p>{rule.evidence_passage}</p>}</div><span className={rule.status === "validated" ? "badge badge-green" : "badge"}>{rule.status}</span></article>)}
          </div>}
        </section>}

        {page === "application" && <section className="content-card">
          <div className="section-heading"><div><h2>Submit an application</h2><p>Enter the applicant information to evaluate against the active policy.</p></div></div>
          {!policyDetails && <p className="empty-state">No active policy is available. Please check the policy library.</p>}
          <form className="application-form" onSubmit={submitApplication}>
            <div className="form-grid">
              <div><label htmlFor="applicantAge">Applicant age</label><input id="applicantAge" type="number" min="0" value={applicantAge} onChange={(e) => setApplicantAge(e.target.value)} required /></div>
              <div><label htmlFor="registered">Organisation registered?</label><select id="registered" value={organisationRegistered} onChange={(e) => setOrganisationRegistered(e.target.value)}><option>Yes</option><option>No</option><option>Unknown</option></select></div>
              <div><label htmlFor="funding">Funding amount requested</label><input id="funding" type="number" min="0" step="0.01" value={fundingAmount} onChange={(e) => setFundingAmount(e.target.value)} required /></div>
              <div><label htmlFor="submissionDate">Submission date</label><input id="submissionDate" type="date" value={submissionDate} onChange={(e) => setSubmissionDate(e.target.value)} required /></div>
              <div className="full-width"><label htmlFor="projectDescription">Project description</label><textarea id="projectDescription" rows={3} value={projectDescription} onChange={(e) => setProjectDescription(e.target.value)} required /></div>
              <div className="full-width"><label htmlFor="impactStatement">Impact statement</label><textarea id="impactStatement" rows={3} value={impactStatement} onChange={(e) => setImpactStatement(e.target.value)} /></div>
            </div>
            <button className="primary-button" disabled={submitting || !policyDetails}>{submitting ? "Evaluating…" : "Evaluate application"}</button>
          </form>
          {latestDecision && <section className="decision-result">
            <div className="section-heading"><div><h2>Evaluation result</h2><p>Decision ID: {latestDecision.id}</p></div><span className={`badge ${latestDecision.recommendation === "APPROVED" ? "badge-green" : ""}`}>{latestDecision.recommendation}</span></div>
            {latestDecision.escalationReasons?.length > 0 && <div><h3>Escalation reasons</h3><ul>{latestDecision.escalationReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
            <div className="rule-results">{latestDecision.ruleResults?.map((result, index) => <article className="rule-row" key={`${result.ruleId}-${index}`}><div><strong>{result.ruleName}</strong><p>{result.explanation}</p><span>Observed: {displayValue(result.observedValue)}</span></div><span className={`badge ${result.status === "PASS" ? "badge-green" : ""}`}>{result.status}</span></article>)}</div>
          </section>}
        </section>}

        {page === "reviews" && <section className="content-card">
          <div className="section-heading">
  <div>
    <button
      className="text-button"
      onClick={() => setPage("overview")}
    >
      ← Back to Overview
    </button>
    <h2>Review queue</h2>
    <p>Human review does not change the machine recommendation.</p>
  </div>
  <button
    className="text-button"
    onClick={() => void loadWorkspace(token, user)}
  >
    Refresh queue
  </button>
</div>
          {user.role !== "reviewer" ? <p className="empty-state">Reviewer access is required to view this queue.</p> : queue.length === 0 ? <p className="empty-state">No cases are waiting for review.</p> : queue.map((item) => <article className="review-card" key={item.id}>
            <div className="section-heading"><div><h3>{item.id}</h3><p>{item.policyTitle} · Submitted {formatDate(item.submittedAt || item.createdAt)}</p></div><span className="badge">{item.recommendation}</span></div>
            {item.escalationReasons?.length > 0 && <div><strong>Escalation reasons</strong><ul>{item.escalationReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>}
            <details><summary>Applicant data</summary><pre>{JSON.stringify(item.applicantData, null, 2)}</pre></details>
            <label htmlFor={`notes-${item.id}`}>Reviewer notes</label><textarea id={`notes-${item.id}`} rows={2} value={reviewNotes[item.id] || ""} onChange={(e) => setReviewNotes((old) => ({ ...old, [item.id]: e.target.value }))} />
            <div className="review-actions">
  <button
    className="primary-button"
    disabled={reviewingId === item.id}
    onClick={() => void submitReview(item.id, "APPROVE")}
  >
    Record approval
  </button>

  <button
    className="secondary-button"
    disabled={reviewingId === item.id}
    onClick={() => void submitReview(item.id, "OVERRIDE")}
  >
    Record denial
  </button>
</div>
                    </article>)}
                  </section>}

        {page === "history" && user.role === "administrator" && (
          <section className="content-card">
            <div className="section-heading">
              <div>
                <button
                  className="text-button"
                  onClick={() => setPage("overview")}
                >
                  ← Back to Overview
                </button>
                <h2>Decision history</h2>
                <p>Review machine recommendations and recorded reviewer actions.</p>
              </div>
              <button
                className="text-button"
                onClick={() => void loadWorkspace(token, user)}
              >
                Refresh history
              </button>
            </div>

            {history.length === 0 ? (
              <p className="empty-state">No decision history is available.</p>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <article className="review-card" key={item.id}>
                    <div className="section-heading">
                      <div>
                        <h3>{item.id}</h3>
                        <p>Decision recorded: {formatDate(item.decisionCreatedAt)}</p>
                      </div>
                      <span className="badge">{item.recommendation}</span>
                    </div>

                    <p><strong>Review outcome:</strong> {item.reviewOutcome}</p>
                    <p><strong>Reviewer:</strong> {item.reviewerUsername || "—"}</p>
                    <p><strong>Reviewer reason:</strong> {item.reviewReason || "No review reason recorded."}</p>
                    <p>
                      <strong>Review date:</strong>{" "}
                      {item.reviewCreatedAt ? formatDate(item.reviewCreatedAt) : "Not reviewed"}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
