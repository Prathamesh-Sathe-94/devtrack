const axios = require("axios");
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");
const User = require("./models/User");
const Team = require("./models/team");
const Worklog = require("./models/worklog");
const Project = require("./models/Project");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

connectDB();

async function getCurrentUser() {
  return User.findOne({ isLoggedIn: true }).sort({ updatedAt: -1 });
}

function encodeAuthState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeAuthState(value) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch (error) {
    return {};
  }
}

async function getGithubPrimaryEmail(accessToken, fallbackEmail = "") {
  if (fallbackEmail) {
    return fallbackEmail;
  }

  try {
    const response = await axios.get("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const primaryEmail =
      response.data.find((entry) => entry.primary && entry.verified)?.email ||
      response.data.find((entry) => entry.verified)?.email ||
      "";

    return primaryEmail;
  } catch (error) {
    return fallbackEmail;
  }
}

function buildDemoWorklogs(userId, projectName, totalDays = 14) {
  const logs = [];
  const summaries = [
    "Closed pull requests and handled review comments.",
    "Worked on API integration and resolved blockers.",
    "Improved test coverage and cleaned up bugs.",
    "Delivered dashboard UI updates and analytics wiring.",
    "Refined sprint tasks and documented progress."
  ];

  for (let i = 0; i < totalDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const random = Math.random();
    let status = "office";
    let hoursWorked = 7 + Math.floor(Math.random() * 3);
    let tasksCompleted = 3 + Math.floor(Math.random() * 5);

    if (random < 0.12) {
      status = "leave";
      hoursWorked = 0;
      tasksCompleted = 0;
    } else if (random < 0.35) {
      status = "wfh";
      hoursWorked = 6 + Math.floor(Math.random() * 3);
    }

    if (Math.random() < 0.18) {
      hoursWorked = 10 + Math.floor(Math.random() * 3);
    }

    logs.push({
      userId: String(userId),
      date,
      status,
      hoursWorked,
      tasksCompleted,
      projectName,
      summary: summaries[i % summaries.length],
      productivityScore: Math.min(100, 55 + tasksCompleted * 6 + hoursWorked * 2)
    });
  }

  return logs;
}

async function fetchUserRepos(accessToken) {
  const response = await axios.get("https://api.github.com/user/repos", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.data;
}

async function fetchUserCommits(accessToken) {
  const repos = await fetchUserRepos(accessToken);
  let allCommits = [];

  for (const repo of repos) {
    try {
      const commitResponse = await axios.get(
        `https://api.github.com/repos/${repo.full_name}/commits`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          params: {
            per_page: 30
          }
        }
      );

      const commits = commitResponse.data.map((commit) => ({
        repo: repo.name,
        date: commit.commit.author.date
      }));

      allCommits = allCommits.concat(commits);
    } catch (repoError) {
      console.log(`Skipping repo ${repo.name}`);
    }
  }

  return allCommits;
}

async function ensureManagerTeam(managerId) {
  let team = await Team.findOne({ managerId });

  if (!team) {
    team = await Team.create({
      name: "DevTrack Demo Team",
      managerId,
      members: []
    });
  }

  return team;
}

async function ensureDemoDataForManager(managerId, count = 4) {
  const manager = await User.findById(managerId);

  if (!manager) {
    throw new Error("Manager not found");
  }

  const team = await ensureManagerTeam(managerId);
  const demoUsers = [];
  const projectTemplates = [
    {
      name: "Velocity CRM",
      description: "Internal CRM modernization for support and sales teams.",
      status: "Active",
      priority: "High",
      progress: 72
    },
    {
      name: "Pulse Mobile",
      description: "Employee self-service mobile dashboard and notifications.",
      status: "At Risk",
      priority: "Medium",
      progress: 48
    },
    {
      name: "Insight Engine",
      description: "Analytics pipeline for team productivity and sprint reporting.",
      status: "Active",
      priority: "High",
      progress: 63
    }
  ];

  let projects = await Project.find({ managerId });

  if (projects.length === 0) {
    projects = await Project.insertMany(
      projectTemplates.map((template, index) => ({
        ...template,
        managerId,
        dueDate: new Date(Date.now() + (index + 2) * 7 * 24 * 60 * 60 * 1000),
        members: []
      }))
    );
  }

  const existingDemoUsers = await User.find({
    provider: "demo",
    teamId: team._id
  });

  if (existingDemoUsers.length >= count) {
    const populatedTeam = await Team.findById(team._id).populate("members");
    const populatedProjects = await Project.find({ managerId }).populate("members");

    return {
      team: populatedTeam,
      projects: populatedProjects,
      users: existingDemoUsers
    };
  }

  const usersToCreate = count - existingDemoUsers.length;

  for (let i = 0; i < usersToCreate; i++) {
    const serial = `${Date.now()}-${i + 1}`;
    const project = projects[(existingDemoUsers.length + i) % projects.length];

    const demoUser = await User.create({
      githubId: `demo-${serial}`,
      username: `demo.employee.${serial}`,
      name: `Demo Employee ${existingDemoUsers.length + i + 1}`,
      email: `demo${serial}@devtrack.local`,
      avatarUrl: "",
      provider: "demo",
      role: "employee",
      teamId: team._id,
      currentProjectId: project._id
    });

    demoUsers.push(demoUser);

    project.members = [...project.members, demoUser._id];
    project.progress = Math.min(95, project.progress + 3);
    await project.save();

    const logs = buildDemoWorklogs(demoUser._id, project.name);
    await Worklog.insertMany(logs);
  }

  const updatedUsers = await User.find({ teamId: team._id });
  team.members = updatedUsers.map((user) => user._id);
  await team.save();

  const populatedTeam = await Team.findById(team._id).populate("members");
  const populatedProjects = await Project.find({ managerId }).populate("members");

  return {
    team: populatedTeam,
    projects: populatedProjects,
    users: updatedUsers.filter((user) => user.provider === "demo")
  };
}

async function buildManagerOverview(managerId) {
  const team = await Team.findOne({ managerId }).populate("members");
  const projects = await Project.find({ managerId }).populate("members");

  if (!team) {
    return {
      team: null,
      employees: [],
      projects: [],
      metrics: {
        totalEmployees: 0,
        activeProjects: 0,
        totalHours: 0,
        totalTasks: 0
      }
    };
  }

  const employeeIds = team.members.map((member) => String(member._id));
  const logs = await Worklog.find({
    userId: { $in: employeeIds }
  }).sort({ date: -1 });

  const employees = await Promise.all(
    team.members.map(async (member) => {
      const memberLogs = logs.filter((log) => log.userId === String(member._id));
      const totalHours = memberLogs.reduce((sum, log) => sum + (log.hoursWorked || 0), 0);
      const totalTasks = memberLogs.reduce((sum, log) => sum + (log.tasksCompleted || 0), 0);
      const latestLog = memberLogs[0] || null;
      const assignedProject =
        projects.find((project) =>
          project.members.some((projectMember) => String(projectMember._id) === String(member._id))
        ) || null;

      return {
        _id: member._id,
        name: member.name,
        username: member.username,
        email: member.email,
        provider: member.provider,
        role: member.role,
        totalHours,
        totalTasks,
        latestStatus: latestLog?.status || "n/a",
        latestSummary: latestLog?.summary || "No recent updates",
        productivityScore: latestLog?.productivityScore || 0,
        projectName: assignedProject?.name || "Unassigned"
      };
    })
  );

  return {
    team,
    employees,
    projects: projects.map((project) => ({
      _id: project._id,
      name: project.name,
      status: project.status,
      priority: project.priority,
      progress: project.progress,
      dueDate: project.dueDate,
      memberCount: project.members.length,
      description: project.description
    })),
    metrics: {
      totalEmployees: employees.length,
      activeProjects: projects.length,
      totalHours: employees.reduce((sum, employee) => sum + employee.totalHours, 0),
      totalTasks: employees.reduce((sum, employee) => sum + employee.totalTasks, 0)
    }
  };
}

app.get("/", (req, res) => {
  res.json({ message: "DevTrack backend running" });
});

app.get("/users", async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/auth/github", (req, res) => {
  const role = req.query.role === "manager" ? "manager" : "employee";
  const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";
  const state = encodeAuthState({ role, email });
  const githubAuthURL =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(process.env.GITHUB_CALLBACK_URL)}` +
    `&state=${encodeURIComponent(state)}` +
    "&scope=user user:email";

  res.redirect(githubAuthURL);
});

app.post("/auth/employee-login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const existingUser = await User.findOne({
      email,
      role: "employee"
    });

    if (existingUser) {
      await User.updateMany({}, { isLoggedIn: false });
      existingUser.isLoggedIn = true;
      await existingUser.save();

      return res.json({
        success: true,
        mode: "existing",
        redirectTo: "/dashboard"
      });
    }

    res.json({
      success: true,
      mode: "github_required",
      redirectTo: `/auth/github?role=employee&email=${encodeURIComponent(email)}`
    });
  } catch (error) {
    res.status(500).json({ error: "Employee sign-in failed" });
  }
});

app.get("/auth/github/callback", async (req, res) => {
  const { code, state } = req.query;
  const parsedState = decodeAuthState(state);
  const selectedRole = parsedState.role === "manager" ? "manager" : "employee";
  const requestedEmail = typeof parsedState.email === "string" ? parsedState.email.trim().toLowerCase() : "";

  if (!code) {
    return res.status(400).json({ error: "Missing GitHub OAuth code" });
  }

  try {
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        redirect_uri: process.env.GITHUB_CALLBACK_URL,
        code
      },
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

    const accessToken = tokenResponse.data.access_token;

    if (!accessToken) {
      return res.status(401).json({ error: "GitHub access token not returned" });
    }

    const userResponse = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    const githubUser = userResponse.data;
    const resolvedEmail = await getGithubPrimaryEmail(accessToken, githubUser.email || requestedEmail);
    let user =
      (resolvedEmail ? await User.findOne({ email: resolvedEmail }) : null) ||
      await User.findOne({ githubId: githubUser.id });

    await User.updateMany({}, { isLoggedIn: false });

    if (!user) {
      user = await User.create({
        githubId: githubUser.id,
        username: githubUser.login,
        name: githubUser.name || githubUser.login,
        email: resolvedEmail,
        avatarUrl: githubUser.avatar_url,
        provider: "github",
        accessToken,
        role: selectedRole,
        isLoggedIn: true
      });
    } else {
      user.username = githubUser.login;
      user.name = githubUser.name || githubUser.login;
      user.email = resolvedEmail || user.email;
      user.avatarUrl = githubUser.avatar_url;
      user.provider = "github";
      user.accessToken = accessToken;
      user.role = selectedRole;
      user.isLoggedIn = true;
      await user.save();
    }

    if (selectedRole === "manager") {
      await ensureDemoDataForManager(user._id, 4);
    }

    res.redirect("http://localhost:5173/dashboard");
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "GitHub OAuth failed" });
  }
});

app.post("/logout", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return res.json({ message: "Already logged out" });
    }

    user.isLoggedIn = false;
    await user.save();

    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: "Logout failed" });
  }
});

app.post("/demo-login/:userId", async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.userId);

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await User.updateMany({}, { isLoggedIn: false });
    targetUser.isLoggedIn = true;
    await targetUser.save();

    res.json({
      message: "Demo login successful",
      user: targetUser
    });
  } catch (err) {
    res.status(500).json({ error: "Demo login failed" });
  }
});

app.post("/create-team", async (req, res) => {
  try {
    const { name, managerId } = req.body;

    const newTeam = new Team({
      name,
      managerId,
      members: []
    });

    await newTeam.save();
    res.json(newTeam);
  } catch (err) {
    res.status(500).json({ error: "Team creation failed" });
  }
});

app.post("/assign-team", async (req, res) => {
  try {
    const { userId, teamId } = req.body;

    await User.findByIdAndUpdate(userId, { teamId });
    await Team.findByIdAndUpdate(teamId, {
      $addToSet: { members: userId }
    });

    res.json({ message: "User assigned to team" });
  } catch (err) {
    res.status(500).json({ error: "Assignment failed" });
  }
});

app.post("/seed-demo-data", async (req, res) => {
  try {
    const manager = await getCurrentUser();

    if (!manager || manager.role !== "manager") {
      return res.status(403).json({ error: "Manager login required" });
    }

    const count = Math.max(1, Math.min(Number(req.body.count) || 4, 20));
    const data = await ensureDemoDataForManager(manager._id, count);
    const overview = await buildManagerOverview(manager._id);

    res.json({
      message: "Demo data ready",
      users: data.users,
      team: data.team,
      projects: data.projects,
      overview
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to seed demo data" });
  }
});

app.get("/projects/me", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const projects = await Project.find({
      members: user._id
    });

    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch projects" });
  }
});

app.get("/manager-overview", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager login required" });
    }

    const overview = await buildManagerOverview(user._id);
    res.json(overview);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch manager overview" });
  }
});

app.get("/team-analytics/me", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user || user.role !== "manager") {
      return res.status(403).json({ error: "Manager login required" });
    }

    const overview = await buildManagerOverview(user._id);
    res.json({
      totalEmployees: overview.metrics.totalEmployees,
      totalHours: overview.metrics.totalHours,
      totalTasks: overview.metrics.totalTasks,
      activeProjects: overview.metrics.activeProjects
    });
  } catch (err) {
    res.status(500).json({ error: "Analytics failed" });
  }
});

app.get("/team/:managerId", async (req, res) => {
  try {
    const team = await Team.findOne({
      managerId: req.params.managerId
    }).populate("members");

    res.json(team);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch team" });
  }
});

app.get("/team-analytics/:managerId", async (req, res) => {
  try {
    const overview = await buildManagerOverview(req.params.managerId);

    res.json({
      totalEmployees: overview.metrics.totalEmployees,
      totalHours: overview.metrics.totalHours,
      totalTasks: overview.metrics.totalTasks,
      activeProjects: overview.metrics.activeProjects
    });
  } catch (err) {
    res.status(500).json({ error: "Analytics failed" });
  }
});

app.get("/repos", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user || !user.accessToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const repos = await fetchUserRepos(user.accessToken);
    res.json(repos);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

app.get("/analytics", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user || !user.accessToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const data = await fetchUserCommits(user.accessToken);
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const recentCommits = data.filter((commit) => new Date(commit.date) >= sevenDaysAgo);
    const commitsLast7Days = recentCommits.length;
    const activeDays = new Set(
      recentCommits.map((commit) => new Date(commit.date).toISOString().split("T")[0])
    ).size;
    const lateNightCommits = recentCommits.filter((commit) => {
      const hour = new Date(commit.date).getHours();
      return hour >= 23 || hour <= 4;
    }).length;

    let burnoutScore = 0;
    const reasons = [];

    if (activeDays >= 6) {
      burnoutScore += 2;
      reasons.push("Worked 6 or more days this week.");
    }

    if (lateNightCommits >= 3) {
      burnoutScore += 2;
      reasons.push("Multiple late-night commits detected.");
    }

    if (commitsLast7Days > 20) {
      burnoutScore += 1;
      reasons.push("High commit volume this week.");
    }

    let burnoutLevel = "Low";

    if (burnoutScore >= 4) {
      burnoutLevel = "High";
    } else if (burnoutScore >= 2) {
      burnoutLevel = "Medium";
    } else {
      reasons.push("Steady pace detected with a healthy rhythm.");
    }

    res.json({
      commitsLast7Days,
      activeDays,
      lateNightCommits,
      burnoutScore,
      burnoutLevel,
      reasons
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Analytics failed" });
  }
});

app.get("/commits", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user || !user.accessToken) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const commits = await fetchUserCommits(user.accessToken);
    res.json(commits);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch commits" });
  }
});

app.get("/me", async (req, res) => {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return res.json(null);
    }

    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

app.get("/employee-graph/:userId", async (req, res) => {
  try {
    const logs = await Worklog.find({ userId: req.params.userId }).sort({ date: 1 });

    const graph = logs.map((log) => ({
      date: log.date.toISOString().split("T")[0],
      hours: log.hoursWorked,
      tasks: log.tasksCompleted
    }));

    res.json(graph);
  } catch (error) {
    res.status(500).json({ error: "Graph failed" });
  }
});

app.get("/employee-burnout/:userId", async (req, res) => {
  try {
    const logs = await Worklog.find({ userId: req.params.userId });

    let totalHours = 0;
    let lateDays = 0;

    logs.forEach((log) => {
      totalHours += log.hoursWorked || 0;
      if ((log.hoursWorked || 0) > 10) {
        lateDays++;
      }
    });

    let level = "Low";

    if (lateDays > 5) {
      level = "High";
    } else if (lateDays > 2) {
      level = "Medium";
    }

    res.json({
      totalHours,
      lateDays,
      burnoutLevel: level
    });
  } catch (error) {
    res.status(500).json({ error: "Burnout failed" });
  }
});

app.get("/worklog/:userId", async (req, res) => {
  try {
    const logs = await Worklog.find({ userId: req.params.userId }).sort({ date: 1 });
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.post("/worklog/:userId", async (req, res) => {
  try {
    const { userId, date, status, hoursWorked, tasksCompleted, projectName, summary } = req.body;

    const newLog = new Worklog({
      userId,
      date,
      status,
      hoursWorked,
      tasksCompleted,
      projectName,
      summary,
      productivityScore: Math.min(100, 50 + (tasksCompleted || 0) * 8 + (hoursWorked || 0) * 2)
    });

    await newLog.save();
    res.json({ message: "Worklog added successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add work log" });
  }
});

app.get("/ai-suggestions/:userId", async (req, res) => {
  try {
    const logs = await Worklog.find({ userId: req.params.userId });
    const suggestions = [];
    const highHours = logs.filter((log) => (log.hoursWorked || 0) > 10).length;
    const lowTasks = logs.filter((log) => (log.tasksCompleted || 0) <= 2).length;

    if (highHours > 5) {
      suggestions.push("Employee is overworked. Suggest rest days.");
    }

    if (lowTasks > 4) {
      suggestions.push("Task throughput dipped. Review blockers and sprint planning.");
    }

    if (logs.length < 10) {
      suggestions.push("Low activity detected. Check engagement.");
    }

    if (suggestions.length === 0) {
      suggestions.push("Employee performance is stable.");
    }

    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: "AI failed" });
  }
});

app.get("/worklog-graph/:userId", async (req, res) => {
  try {
    const logs = await Worklog.find({
      userId: req.params.userId
    }).sort({ date: 1 });

    const graphData = logs.map((log) => ({
      date: log.date.toISOString().split("T")[0],
      hours: log.hoursWorked
    }));

    res.json(graphData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate graph data" });
  }
});

app.listen(PORT, () => {
  console.log(`DevTrack backend listening on port ${PORT}`);
});
