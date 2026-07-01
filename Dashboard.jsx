import { useState } from "react";
import "./App.css";

const API_BASE_URL = "http://localhost:5000";

function Login() {
  const [role, setRole] = useState("employee");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loginWithGitHub = () => {
    const emailQuery = role === "employee" && email.trim()
      ? `&email=${encodeURIComponent(email.trim().toLowerCase())}`
      : "";

    window.location.href = `${API_BASE_URL}/auth/github?role=${role}${emailQuery}`;
  };

  const handleContinue = async () => {
    setMessage("");

    if (role === "manager") {
      loginWithGitHub();
      return;
    }

    if (!email.trim()) {
      setMessage("Enter your work email to continue as an employee.");
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`${API_BASE_URL}/auth/employee-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase()
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Login failed");
      }

      if (data.mode === "existing") {
        window.location.href = data.redirectTo || "/dashboard";
        return;
      }

      if (data.mode === "github_required") {
        setMessage("No linked employee account found. Continue with GitHub to connect this email.");
        window.location.href = `${API_BASE_URL}${data.redirectTo}`;
      }
    } catch (error) {
      setMessage(error.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-hero">
        <div className="login-copy">
          <p className="eyebrow">Developer Productivity Management</p>
          <h1>DevTrack</h1>
          <p className="hero-text">
            Track developer productivity, project momentum, worklogs, burnout risk,
            and team visibility from one focused dashboard.
          </p>

          <div className="feature-grid">
            <div className="feature-card">
              <strong>Employee View</strong>
              <span>Progress reports, assigned projects, work hours, and productivity signals.</span>
            </div>

            <div className="feature-card">
              <strong>Manager View</strong>
              <span>Team analytics, employee activity, dummy demo data, and project delivery status.</span>
            </div>
          </div>
        </div>

        <div className="login-panel">
          <p className="panel-kicker">Presentation-ready sign in</p>
          <h2>Choose your dashboard</h2>
          <p className="panel-text">
            Employees can try email-based sign-in first. Managers still go straight through GitHub.
          </p>

          <label className="field-label" htmlFor="role-select">
            Login as
          </label>
          <select
            id="role-select"
            className="role-select"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setMessage("");
            }}
          >
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
          </select>

          {role === "employee" ? (
            <>
              <label className="field-label" htmlFor="employee-email">
                Work email
              </label>
              <input
                id="employee-email"
                className="role-select"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </>
          ) : null}

          <button className="primary-button" onClick={handleContinue} disabled={submitting}>
            {submitting ? "Checking..." : "Continue"}
          </button>

          {role === "manager" ? (
            <p className="helper-copy">
              Manager login automatically prepares demo employees and project data for your presentation.
            </p>
          ) : (
            <p className="helper-copy">
              If this email already belongs to an employee account linked through GitHub, DevTrack signs you in directly.
            </p>
          )}

          {message ? <p className="helper-copy">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}

export default Login;
