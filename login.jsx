import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import CalendarHeatmap from "react-calendar-heatmap";
import "react-calendar-heatmap/dist/styles.css";
import "./App.css";

const API_BASE_URL = "http://localhost:5000";

function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [repos, setRepos] = useState([]);
  const [projects, setProjects] = useState([]);
  const [workLogs, setWorkLogs] = useState([]);
  const [workGraph, setWorkGraph] = useState([]);
  const [burnout, setBurnout] = useState(null);
  const [ai, setAi] = useState(null);
  const [commitHeatmap, setCommitHeatmap] = useState([]);
  const [managerOverview, setManagerOverview] = useState(null);
  const [teamAnalytics, setTeamAnalytics] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [employeeGraph, setEmployeeGraph] = useState([]);
  const [employeeBurnout, setEmployeeBurnout] = useState(null);
  const [employeeAi, setEmployeeAi] = useState(null);
  const [demoCount, setDemoCount] = useState(4);

  const safeJSON = async (response) => {
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || "Request failed");
    }

    return data;
  };

  const fetchJSON = async (path) => {
    const response = await fetch(`${API_BASE_URL}${path}`);
    return safeJSON(response);
  };

  const getStatusForDate = (date) => {
    const day = date.toISOString().split("T")[0];
    const log = workLogs.find((entry) => entry?.date?.split("T")[0] === day);
    return log?.status || null;
  };

  const loadEmployeeData = async (id) => {
    const [logGraph, logs, projectsData, burnoutData, aiData, analyticsData, reposData, commitsData] =
      await Promise.all([
        fetchJSON(`/worklog-graph/${id}`).catch(() => []),
        fetchJSON(`/worklog/${id}`).catch(() => []),
        fetchJSON("/projects/me").catch(() => []),
        fetchJSON(`/employee-burnout/${id}`).catch(() => null),
        fetchJSON(`/ai-suggestions/${id}`).catch(() => null),
        fetchJSON("/analytics").catch(() => null),
        fetchJSON("/repos").catch(() => []),
        fetchJSON("/commits").catch(() => [])
      ]);

    setWorkGraph(Array.isArray(logGraph) ? logGraph : []);
    setWorkLogs(Array.isArray(logs) ? logs : []);
    setProjects(Array.isArray(projectsData) ? projectsData : []);
    setBurnout(burnoutData);
    setAi(aiData);
    setAnalytics(analyticsData);
    setRepos(Array.isArray(reposData) ? reposData : []);

    const counts = {};
    (Array.isArray(commitsData) ? commitsData : []).forEach((commit) => {
      if (!commit?.date) {
        return;
      }

      const day = commit.date.split("T")[0];
      counts[day] = (counts[day] || 0) + 1;
    });

    setCommitHeatmap(
      Object.keys(counts).map((date) => ({
        date,
        count: counts[date]
      }))
    );
  };

  const loadManagerData = async () => {
    const [overview, analyticsData] = await Promise.all([
      fetchJSON("/manager-overview").catch(() => null),
      fetchJSON("/team-analytics/me").catch(() => null)
    ]);

    setManagerOverview(overview);
    setTeamAnalytics(analyticsData);
  };

  useEffect(() => {
    let ignore = false;

    const loadDashboard = async () => {
      try {
        const currentUser = await fetchJSON("/me").catch(() => null);

        if (ignore) {
          return;
        }

        setUser(currentUser);

        if (!currentUser?._id) {
          return;
        }

        if (currentUser.role === "manager") {
          await loadManagerData();
        } else {
          await loadEmployeeData(currentUser._id);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError.message || "Failed to load dashboard");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      ignore = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/logout`, {
        method: "POST"
      });

      await safeJSON(response);
      window.location.href = "/";
    } catch (requestError) {
      setError(requestError.message || "Failed to log out");
    }
  };

  const handleSeedDemoData = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/seed-demo-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          count: demoCount
        })
      });

      await safeJSON(response);
      await loadManagerData();
    } catch (requestError) {
      setError(requestError.message || "Failed to prepare demo data");
    }
  };

  const handleEmployeeSelect = async (id) => {
    setSelectedEmployee(id);
    setEmployeeGraph([]);
    setEmployeeBurnout(null);
    setEmployeeAi(null);

    if (!id) {
      return;
    }

    try {
      const [graphData, burnoutData, aiData] = await Promise.all([
        fetchJSON(`/employee-graph/${id}`).catch(() => []),
        fetchJSON(`/employee-burnout/${id}`).catch(() => null),
        fetchJSON(`/ai-suggestions/${id}`).catch(() => null)
      ]);

      setEmployeeGraph(Array.isArray(graphData) ? graphData : []);
      setEmployeeBurnout(burnoutData);
      setEmployeeAi(aiData);
    } catch (requestError) {
      setError(requestError.message || "Failed to load employee detail");
    }
  };

  const handleDemoLogin = async (id) => {
    try {
      const response = await fetch(`${API_BASE_URL}/demo-login/${id}`, {
        method: "POST"
      });

      await safeJSON(response);
      window.location.href = "/dashboard";
    } catch (requestError) {
      setError(requestError.message || "Failed to open demo employee view");
    }
  };

  if (loading) {
    return <p style={{ padding: "40px" }}>Loading dashboard...</p>;
  }

  if (!user) {
    return (
      <div style={{ padding: "40px" }}>
        <h2>You are not logged in</h2>
        <a href="/">Go to Login</a>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <div className="dashboard-header-card">
        <div>
          <p className="eyebrow">DevTrack Workspace</p>
          <h1>{user.name || user.username}</h1>
          <p className="hero-text">Signed in as {user.role}. Monitor developer output, work rhythm, and project health.</p>
        </div>

        <button className="secondary-button" onClick={handleLogout}>
          Logout
        </button>
      </div>

      {error ? (
        <div className="notice-card error-card">
          <strong>Heads up</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {user.role === "employee" ? (
        <>
          <div className="dashboard-grid two-up">
            <section className="surface-card profile-card">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.username} className="avatar-large" />
              ) : (
                <div className="avatar-fallback">{(user.name || "D").slice(0, 1)}</div>
              )}

              <div>
                <h2>{user.name || user.username}</h2>
                <p>@{user.username}</p>
                <p>{user.email || "GitHub email hidden"}</p>
              </div>
            </section>

            <section className="surface-card">
              <h3>Productivity Snapshot</h3>
              <div className="stats-row">
                <div className="metric-box">
                  <span>{analytics?.commitsLast7Days ?? 0}</span>
                  <small>Commits</small>
                </div>
                <div className="metric-box">
                  <span>{analytics?.activeDays ?? 0}</span>
                  <small>Active Days</small>
                </div>
                <div className="metric-box">
                  <span>{burnout?.burnoutLevel || "Low"}</span>
                  <small>Burnout Risk</small>
                </div>
              </div>
            </section>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card">
              <h3>Assigned Projects</h3>
              {projects.length > 0 ? (
                <div className="list-stack">
                  {projects.map((project) => (
                    <div key={project._id} className="info-row">
                      <div>
                        <strong>{project.name}</strong>
                        <p>{project.description}</p>
                      </div>
                      <div className="pill-stack">
                        <span className="tag">{project.status}</span>
                        <span className="tag">{project.progress}% done</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No projects assigned yet.</p>
              )}
            </section>

            <section className="surface-card">
              <h3>Recent Progress Reports</h3>
              {workLogs.slice(-5).reverse().map((log) => (
                <div key={`${log._id}-${log.date}`} className="info-row">
                  <div>
                    <strong>{log.projectName || "General Work"}</strong>
                    <p>{log.summary || "No summary added."}</p>
                  </div>
                  <div className="pill-stack">
                    <span className="tag">{log.tasksCompleted || 0} tasks</span>
                    <span className="tag">{log.hoursWorked || 0} hrs</span>
                  </div>
                </div>
              ))}
            </section>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card chart-card">
              <h3>Work Hours Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={workGraph}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="hours" stroke="#0b6e4f" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="surface-card">
              <h3>GitHub Repositories</h3>
              {repos.length > 0 ? (
                <ul className="plain-list">
                  {repos.slice(0, 8).map((repo) => (
                    <li key={repo.id}>
                      <strong>{repo.name}</strong>
                      <span>{repo.private ? "Private" : "Public"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No repository data available for this account.</p>
              )}
            </section>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card">
              <h3>Work Calendar</h3>
              <Calendar
                tileClassName={({ date }) => {
                  const status = getStatusForDate(date);
                  if (status === "office") return "office-day";
                  if (status === "wfh") return "wfh-day";
                  if (status === "leave") return "leave-day";
                  return null;
                }}
              />
            </section>

            <section className="surface-card">
              <h3>Commit Heatmap</h3>
              <CalendarHeatmap
                startDate={new Date(new Date().setDate(new Date().getDate() - 90))}
                endDate={new Date()}
                values={commitHeatmap}
                classForValue={(value) => {
                  if (!value) return "color-empty";
                  if (value.count >= 4) return "color-github-4";
                  if (value.count >= 3) return "color-github-3";
                  if (value.count >= 2) return "color-github-2";
                  if (value.count >= 1) return "color-github-1";
                  return "color-empty";
                }}
              />
            </section>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card">
              <h3>Burnout Insights</h3>
              <p>Total Hours: {burnout?.totalHours ?? 0}</p>
              <p>Late Days: {burnout?.lateDays ?? 0}</p>
              <strong>{burnout?.burnoutLevel || "Low"}</strong>
            </section>

            <section className="surface-card">
              <h3>AI Suggestions</h3>
              <ul className="plain-list compact">
                {(ai?.suggestions || []).map((suggestion, index) => (
                  <li key={`${suggestion}-${index}`}>{suggestion}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="dashboard-grid three-up">
            <section className="surface-card">
              <h3>Total Employees</h3>
              <div className="feature-stat">{teamAnalytics?.totalEmployees ?? managerOverview?.metrics?.totalEmployees ?? 0}</div>
            </section>
            <section className="surface-card">
              <h3>Project Count</h3>
              <div className="feature-stat">{teamAnalytics?.activeProjects ?? managerOverview?.metrics?.activeProjects ?? 0}</div>
            </section>
            <section className="surface-card">
              <h3>Total Tasks</h3>
              <div className="feature-stat">{teamAnalytics?.totalTasks ?? managerOverview?.metrics?.totalTasks ?? 0}</div>
            </section>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card">
              <h3>Presentation Demo Controls</h3>
              <p>Generate or extend dummy employees and project activity for your live demo.</p>
              <div className="inline-controls">
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={demoCount}
                  onChange={(event) => setDemoCount(Number(event.target.value) || 1)}
                />
                <button className="primary-button" onClick={handleSeedDemoData}>
                  Prepare Demo Data
                </button>
              </div>
            </section>

            <section className="surface-card">
              <h3>Project Activity</h3>
              <div className="list-stack">
                {(managerOverview?.projects || []).map((project) => (
                  <div key={project._id} className="info-row">
                    <div>
                      <strong>{project.name}</strong>
                      <p>{project.description}</p>
                    </div>
                    <div className="pill-stack">
                      <span className="tag">{project.status}</span>
                      <span className="tag">{project.progress}%</span>
                      <span className="tag">{project.memberCount} devs</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="surface-card">
            <h3>All Employees</h3>
            <div className="employee-table">
              {(managerOverview?.employees || []).map((employee) => (
                <div key={employee._id} className="employee-row">
                  <div>
                    <strong>{employee.name}</strong>
                    <p>{employee.email || employee.username}</p>
                  </div>
                  <span>{employee.projectName}</span>
                  <span>{employee.totalHours} hrs</span>
                  <span>{employee.totalTasks} tasks</span>
                  <span>{employee.productivityScore} score</span>
                  <button className="secondary-button small" onClick={() => handleEmployeeSelect(employee._id)}>
                    Inspect
                  </button>
                  {employee.provider === "demo" ? (
                    <button className="primary-button small" onClick={() => handleDemoLogin(employee._id)}>
                      Open Demo View
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="dashboard-grid two-up">
            <section className="surface-card chart-card">
              <h3>Selected Employee Trend</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={employeeGraph}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="hours" stroke="#7c3aed" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            <section className="surface-card">
              <h3>Selected Employee Insight</h3>
              <p>Burnout Risk: {employeeBurnout?.burnoutLevel || "Select an employee"}</p>
              <p>Total Hours: {employeeBurnout?.totalHours ?? 0}</p>
              <p>Late Days: {employeeBurnout?.lateDays ?? 0}</p>
              <ul className="plain-list compact">
                {(employeeAi?.suggestions || []).map((suggestion, index) => (
                  <li key={`${suggestion}-${index}`}>{suggestion}</li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
