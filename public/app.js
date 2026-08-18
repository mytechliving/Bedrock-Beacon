const app = document.querySelector("#app");
let state = {
  user: null,
  servers: [],
  current: null,
  page: "dashboard",
  poll: null,
  propertySchema: null,
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
async function api(url, options = {}) {
  const r = await fetch(url, {
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" },
    ...options,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function toast(message, bad = false) {
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.className = bad ? "show bad" : "show";
  setTimeout(() => (t.className = ""), 2800);
}
function authViewLegacy(setup = false) {
  app.innerHTML = `<main class="auth-page"><section class="auth-art"><span class="eyebrow">Local command center</span><h1>One signal.<br>Every world.</h1><p>Run and discover every Bedrock world from one private control point.</p></section><section class="auth-card"><div class="logo" aria-label="Bedrock Beacon">BB</div><span class="eyebrow">${setup ? "First launch" : "Welcome back"}</span><h2>${setup ? "Create your admin" : "Sign in"}</h2><p class="sub">${setup ? "This account stays on this computer." : "Manage your Bedrock servers."}</p><form id="auth"><div class="field"><label>Username</label><input name="username" autocomplete="username" required minlength="3"></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" required minlength="8"></div><button class="btn primary">${setup ? "Create account" : "Sign in"}</button></form></section></main>`;
  document.querySelector("#auth").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      state.user = (
        await api(setup ? "/api/setup" : "/api/login", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(f)),
        })
      ).user;
      await loadServers();
    } catch (x) {
      toast(x.message, true);
    }
  };
}
function authView(mode = "login") {
  if (mode === true) mode = "setup";
  if (mode === false) mode = "login";
  const creating = mode === "setup";
  app.innerHTML = `<main class="auth-page"><section class="auth-art"><span class="eyebrow">Local command center</span><h1>One signal.<br>Every world.</h1><p>Run and discover every Bedrock world from one private control point.</p></section><section class="auth-card"><div class="logo" aria-label="Bedrock Beacon">BB</div><span class="eyebrow">${creating ? "First launch" : "Welcome back"}</span><h2>${creating ? "Create your Admin account" : "Sign in"}</h2><p class="sub">${creating ? "This first local account has full system access." : "Manage your Bedrock servers."}</p><form id="auth"><div class="field"><label>Username</label><input name="username" autocomplete="username" required minlength="3"></div><div class="field"><label>Password</label><input name="password" type="password" autocomplete="${creating ? "new-password" : "current-password"}" required minlength="8"></div><button class="btn primary">${creating ? "Create Admin account" : "Sign in"}</button></form>${creating ? "" : '<div class="auth-switch"><span>Need an account or password change?</span><span>Ask a Bedrock Beacon Admin.</span></div>'}</section></main>`;
  document.querySelector("#auth").onsubmit = async (event) => {
    event.preventDefault();
    const endpoint = creating ? "/api/setup" : "/api/login";
    try {
      state.user = (
        await api(endpoint, {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(event.target))),
        })
      ).user;
      await loadServers();
    } catch (error) {
      toast(error.message, true);
    }
  };
}
const isAdmin = () => state.user?.role === "admin";
const canManageServers = () => ["admin", "manager"].includes(state.user?.role);
const roleName = () => ({ admin: "Admin", manager: "Manager", user: "User" })[state.user?.role] || "User";
function shell(content, active = "dashboard") {
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><div class="logo">BB</div><span>Bedrock Beacon</span></div><nav class="nav"><button data-short="Servers" class="${active === "dashboard" ? "active" : ""}" onclick="loadServers()">▦ &nbsp; Servers</button><button data-short="Quick View" class="${active === "quick-view" ? "active" : ""}" onclick="quickView()">● &nbsp; Quick View</button>${state.current ? `<button data-short="Status" class="${active === "status" ? "active" : ""}" onclick="openServer('${state.current.id}','status')">◉ &nbsp; Status</button><button data-short="Config" class="${active === "config" ? "active" : ""}" onclick="openServer('${state.current.id}','config')">⚙ &nbsp; Configuration</button>` : ""}</nav><div class="sidebar-bottom">${isAdmin() ? `<button class="sidebar-link ${active === "users" ? "active" : ""}" onclick="usersView()">♙ &nbsp; Users</button><button class="sidebar-link ${active === "admin" ? "active" : ""}" onclick="adminView()">⚙ &nbsp; System Admin</button>` : ""}<div class="signed-in-user"><button class="account-trigger ${active === "account" ? "active" : ""}" onclick="accountView()" aria-label="Open my account settings" title="My Account"><div class="user-avatar">${esc(state.user?.username?.slice(0, 1).toUpperCase() || "U")}</div><div><strong>${esc(state.user?.username || "Unknown user")}</strong><span>${roleName()} · My Account</span></div></button><button class="signout-button" onclick="logout()" aria-label="Sign out" title="Sign out">↪</button></div></div></aside><main class="main">${content}</main></div>`;
}
async function loadServers() {
  clearInterval(state.poll);
  state.page = "dashboard";
  state.current = null;
  try {
    state.servers = await api("/api/servers");
    renderDashboard();
  } catch (e) {
    authView(false);
  }
}
async function quickView() {
  clearInterval(state.poll);
  state.page = "quick-view";
  state.current = null;
  try {
    state.servers = await api("/api/quick-view");
    renderQuickView();
    state.poll = setInterval(async () => {
      try {
        state.servers = await api("/api/quick-view");
        if (state.page === "quick-view") renderQuickView();
      } catch {}
    }, 2500);
  } catch (error) {
    toast(error.message, true);
  }
}
function renderQuickView() {
  const online = state.servers.filter((server) => server.status === "online").length;
  const serverList = state.servers.length
    ? state.servers.map(quickStatusCard).join("")
    : '<div class="quick-empty"><span class="quick-empty-mark">BB</span><h2>No servers yet</h2><p>Created servers will appear here automatically.</p></div>';
  app.innerHTML = `<main class="quick-page"><header class="quick-site-header"><button class="quick-brand" onclick="quickView()" aria-label="Bedrock Beacon home"><span class="logo">BB</span><strong>Bedrock Beacon</strong></button><button class="quick-login-link" onclick="quickViewAction()">${state.user ? "Server Dashboard" : "Log In"}</button></header><div class="quick-page-content"><header class="quick-header"><div><span class="eyebrow">Live server status</span><h1>Quick View</h1><p>A simple live view of every Bedrock world.</p></div><div class="quick-total"><b>${online}</b><span>of ${state.servers.length} online</span></div></header><section class="quick-status-list" aria-label="Server status">${serverList}</section><p class="quick-refresh"><i></i> Status refreshes automatically</p></div></main>`;
}
async function quickViewAction() {
  clearInterval(state.poll);
  if (state.user) return loadServers();
  try {
    const bootstrap = await api("/api/bootstrap");
    authView(bootstrap.needsSetup ? "setup" : "login");
  } catch (error) {
    toast(error.message, true);
  }
}
function quickStatusCard(server) {
  const online = server.status === "online";
  return `<article class="quick-status-card ${online ? "online" : "offline"}"><div class="quick-server-name"><span class="quick-beacon" aria-hidden="true"></span><div><h2>${esc(server.name)}</h2><span>${esc(server.worldName)}</span></div></div><div class="quick-players"><b>${server.playersOnline} / ${server.maxPlayers}</b><span>users online</span></div><div class="quick-state"><i aria-hidden="true"></i><strong>${online ? "Online" : "Offline"}</strong></div></article>`;
}
function renderDashboard() {
  const online = state.servers.filter((s) => s.status === "online").length;
  shell(
    `<header class="topbar"><div><span class="eyebrow">MCServer</span><h1>Server dashboard</h1><div class="stats"><span><b>${state.servers.length}</b> worlds</span><span><b>${online}</b> running</span></div></div></header><section class="grid">${state.servers.map(serverCard).join("")}${canManageServers() ? '<button class="create-card" onclick="createModal()" aria-label="Create a new server">＋</button>' : ""}</section>`,
  );
}
function serverCard(s) {
  const lifecycle = `<button role="menuitem" ${s.status === "online" ? "disabled" : ""} onclick="menuAction(event,'${s.id}','start')">▶ <span>Start Server</span></button><button role="menuitem" ${s.status !== "online" ? "disabled" : ""} onclick="menuAction(event,'${s.id}','stop')">■ <span>Stop Server</span></button>`;
  const management = canManageServers()
    ? `<button role="menuitem" ${s.status !== "online" ? "disabled" : ""} onclick="menuAction(event,'${s.id}','reset')">↻ <span>Reset Server</span></button><div class="menu-separator"></div><button class="delete-action" role="menuitem" onclick="confirmDelete(event,'${s.id}')">× <span>Delete Server</span></button>`
    : "";
  return `<article class="server-card" role="button" tabindex="0" onclick="openServer('${s.id}')"><div class="status-row"><span class="status"><i class="dot ${s.status}"></i>${s.status}</span><div class="card-menu-wrap"><button class="more-button" aria-label="Actions for ${esc(s.name)}" aria-haspopup="menu" aria-expanded="false" onclick="toggleServerMenu(event,'${s.id}')">•••</button><div class="card-menu" id="menu-${s.id}" role="menu">${lifecycle}${management}</div></div></div><h3>${esc(s.name)}</h3><span class="world">${esc(s.worldName)}</span><div class="card-meta"><span>Port ${s.port}</span><span>${s.playersOnline} / ${s.maxPlayers} players</span></div></article>`;
}
function closeServerMenus() {
  document
    .querySelectorAll(".card-menu.open")
    .forEach((menu) => menu.classList.remove("open"));
  document
    .querySelectorAll(".more-button[aria-expanded='true']")
    .forEach((button) => button.setAttribute("aria-expanded", "false"));
}
function toggleServerMenu(event, id) {
  event.stopPropagation();
  const menu = document.querySelector(`#menu-${id}`);
  const wasOpen = menu.classList.contains("open");
  closeServerMenus();
  if (!wasOpen) {
    menu.classList.add("open");
    event.currentTarget.setAttribute("aria-expanded", "true");
    menu.querySelector("button:not(:disabled)")?.focus();
  }
}
async function menuAction(event, id, action) {
  event.stopPropagation();
  closeServerMenus();
  try {
    await api(`/api/servers/${id}/${action}`, { method: "POST", body: "{}" });
    toast(
      action === "start"
        ? "Server is starting"
        : action === "stop"
          ? "Stop requested"
          : "Server reset requested",
    );
    setTimeout(loadServers, 600);
  } catch (error) {
    toast(error.message, true);
  }
}
function confirmDelete(event, id) {
  event.stopPropagation();
  closeServerMenus();
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-wrap" id="delete-modal"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span class="eyebrow danger-text">Permanent action</span><h2 id="delete-title">Delete ${esc(server.name)}?</h2><p class="sub">This permanently removes the server instance, its world <b>${esc(server.worldName)}</b>, configuration, and logs. This cannot be undone.</p><div class="actions"><button class="btn ghost" onclick="document.querySelector('#delete-modal').remove()">Cancel</button><button class="btn danger-solid" onclick="deleteServer('${server.id}')">Delete Server</button></div></div></div>`,
  );
}
async function deleteServer(id) {
  const button = document.querySelector("#delete-modal .danger-solid");
  button.disabled = true;
  button.innerHTML = '<i class="spinner"></i> Deleting…';
  try {
    await api(`/api/servers/${id}`, { method: "DELETE" });
    document.querySelector("#delete-modal")?.remove();
    toast("Server deleted");
    await loadServers();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete Server";
    toast(error.message, true);
  }
}
document.addEventListener("click", closeServerMenus);
function createModal() {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-wrap" id="modal"><div class="modal create-choice"><span class="eyebrow">Add server</span><h2>Create or import</h2><p class="sub">Start a new world or restore a portable Bedrock Beacon archive.</p><div class="choice-grid"><button onclick="showCreateForm()"><span class="choice-icon">＋</span><strong>New Server</strong><small>Create an isolated server from the installed Bedrock template.</small></button><button onclick="showImportForm()"><span class="choice-icon">⇧</span><strong>Import Server</strong><small>Upload a previously exported <code>.bedrock-beacon.zip</code> archive.</small></button></div><div class="actions"><button class="btn ghost" onclick="modal.remove()">Cancel</button></div></div></div>`,
  );
}
function showCreateForm() {
  document.querySelector("#modal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-wrap" id="modal"><form class="modal" id="create"><span class="eyebrow">New instance</span><h2>Create a Bedrock server</h2><p class="sub">A private copy of the installed server template will be created.</p><div class="field"><label>Server name</label><input name="name" placeholder="Survival Realm" required autofocus></div><div class="field"><label>World name</label><input name="worldName" placeholder="My World"></div><div class="actions"><button type="button" class="btn ghost" onclick="modal.remove()">Cancel</button><button class="btn primary">Create server</button></div></form></div>`,
  );
  document.querySelector("#create").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const submit = form.querySelector(
      'button[type="submit"], button:not([type])',
    );
    const cancel = form.querySelector('button[type="button"]');
    submit.disabled = true;
    cancel.disabled = true;
    form.setAttribute("aria-busy", "true");
    submit.innerHTML = '<i class="spinner"></i> Creating server…';
    toast(
      "Creating an isolated server copy. This usually takes 10–30 seconds.",
    );
    try {
      const s = await api("/api/servers", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      modal.remove();
      toast("Server created successfully");
      openServer(s.id, "config");
    } catch (x) {
      toast(x.message, true);
      submit.disabled = false;
      cancel.disabled = false;
      form.removeAttribute("aria-busy");
      submit.textContent = "Create server";
    }
  };
}
function showImportForm() {
  document.querySelector("#modal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-wrap" id="modal"><form class="modal" id="import-server"><span class="eyebrow">Portable archive</span><h2>Import a server</h2><p class="sub">Beacon validates the archive, installs it over the current official Bedrock template, assigns new ports, and requires EULA acceptance again.</p><div class="import-drop"><div class="choice-icon">⇧</div><div class="field"><label>Bedrock Beacon ZIP</label><input name="archive" type="file" accept=".zip,.bedrock-beacon.zip,.bedrock-harbor.zip" required></div></div><div class="actions"><button type="button" class="btn ghost" onclick="modal.remove()">Cancel</button><button class="btn primary">Import Server</button></div></form></div>`,
  );
  document.querySelector("#import-server").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const submit = form.querySelector(
      "button[type='submit'],button:not([type])",
    );
    const cancel = form.querySelector("button[type='button']");
    submit.disabled = true;
    cancel.disabled = true;
    submit.innerHTML = '<i class="spinner"></i> Importing…';
    toast("Uploading and validating server archive…");
    try {
      const server = await api("/api/servers/import", {
        method: "POST",
        body: new FormData(form),
      });
      document.querySelector("#modal")?.remove();
      toast("Server imported successfully");
      await openServer(server.id, "config");
    } catch (error) {
      submit.disabled = false;
      cancel.disabled = false;
      submit.textContent = "Import Server";
      toast(error.message, true);
    }
  };
}
async function openServer(id, tab = "status") {
  clearInterval(state.poll);
  try {
    if (tab === "config" && !state.propertySchema)
      state.propertySchema = await api("/api/property-schema");
    state.current = await api(`/api/servers/${id}`);
    renderServer(tab);
    state.poll = setInterval(async () => {
      try {
        state.current = await api(`/api/servers/${id}`);
        if (tab === "status") renderServer(tab);
      } catch {}
    }, 2500);
  } catch (e) {
    toast(e.message, true);
  }
}
function propertySections(server) {
  const grouped = state.propertySchema
    .filter((field) => field.key !== "allow-list")
    .reduce((groups, field) => {
      (groups[field.section] ||= []).push(field);
      return groups;
    }, {});
  return `<div class="advanced-heading"><div><span class="eyebrow">Complete properties</span><h3>Advanced Bedrock settings</h3></div><span>${state.propertySchema.length} supported properties</span></div><div class="property-sections">${Object.entries(
    grouped,
  )
    .map(
      ([section, fields]) =>
        `<details class="property-section"><summary>${esc(section)}<span>${fields.length} settings</span></summary><div class="property-grid">${fields
          .map((field) => propertyField(field, server.properties?.[field.key]))
          .join("")}</div></details>`,
    )
    .join("")}</div>`;
}
function propertyField(field, stored) {
  const value = stored ?? field.default ?? "";
  const description = field.description
    ? `<small>${esc(field.description)}</small>`
    : "";
  if (field.type === "boolean") {
    const checked = value === true || value === "true";
    return `<label class="property-toggle"><input type="checkbox" name="prop.${field.key}" ${checked ? "checked" : ""} ${field.key === "enable-lan-visibility" ? "disabled" : ""}><span><strong>${esc(field.label)}</strong>${description}</span></label>`;
  }
  if (field.type === "select") {
    return `<div class="field"><label>${esc(field.label)}</label><select name="prop.${field.key}">${field.options.map((option) => `<option value="${esc(option)}" ${String(value) === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select>${description}</div>`;
  }
  return `<div class="field"><label>${esc(field.label)}</label><input name="prop.${field.key}" type="${field.type === "password" ? "password" : field.type === "text" ? "text" : "number"}" value="${esc(value)}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} ${field.step !== undefined ? `step="${field.step}"` : ""}>${description}</div>`;
}
function renderServer(tab) {
  const s = state.current;
  if (tab === "config") {
    shell(
      `<header class="topbar"><div><button class="back" onclick="loadServers()">← All servers</button><h1>${esc(s.name)}</h1></div><button class="admin-btn" onclick="adminView()">System Admin</button></header><section class="panel"><div class="panel-head"><div><span class="eyebrow">Server settings</span><h2>Configuration</h2></div></div><form id="config"><div class="form-grid"><div class="field"><label>Server name</label><input name="name" value="${esc(s.name)}" required></div><div class="field"><label>World name</label><input name="worldName" value="${esc(s.worldName)}" required></div><div class="field"><label>IPv4 port</label><input name="port" type="number" min="1024" max="65534" value="${s.port}" required></div><div class="field"><label>Maximum players</label><input name="maxPlayers" type="number" min="1" max="1000" value="${s.maxPlayers}"></div><div class="field"><label>Game mode</label><select name="gameMode">${["survival", "creative", "adventure"].map((v) => `<option ${s.gameMode === v ? "selected" : ""}>${v}</option>`)}</select></div><div class="field"><label>Difficulty</label><select name="difficulty">${["peaceful", "easy", "normal", "hard"].map((v) => `<option ${s.difficulty === v ? "selected" : ""}>${v}</option>`)}</select></div><div class="field"><label>World type</label><select name="levelType">${["DEFAULT", "FLAT", "LEGACY"].map((v) => `<option ${s.levelType === v ? "selected" : ""}>${v}</option>`)}</select></div><div class="field"><label>Seed (optional)</label><input name="levelSeed" value="${esc(s.levelSeed)}"></div></div><label class="check"><input type="checkbox" name="allowCheats" ${s.allowCheats ? "checked" : ""}> Allow cheats</label><div class="actions"><button class="btn primary">Save configuration</button></div></form></section>`,
      tab,
    );
    document.querySelector(".topbar .admin-btn")?.remove();
    const acceptanceDate = s.eulaAcceptedAt
      ? new Date(s.eulaAcceptedAt).toLocaleString()
      : "Previously recorded";
    document
      .querySelector("#config")
      .insertAdjacentHTML(
        "afterbegin",
        s.eulaAccepted
          ? `<div class="eula-consent accepted eula-confirmed" role="status"><div class="eula-checkmark">✓</div><span><strong>Minecraft EULA accepted</strong><small>Acceptance recorded ${esc(acceptanceDate)}. This server is authorized to start.</small><a href="https://www.minecraft.net/en-us/eula" target="_blank" rel="noopener noreferrer">View Minecraft EULA</a></span><input type="hidden" name="eulaAccepted" value="true"></div>`
          : `<div class="eula-consent"><label><input type="checkbox" name="eulaAccepted"><span><strong>Accept the Minecraft End User License Agreement</strong><small>I have read and agree to the <a href="https://www.minecraft.net/en-us/eula" target="_blank" rel="noopener noreferrer">Minecraft EULA</a>. This must be accepted before this server can start.</small></span></label></div>`,
      );
    document
      .querySelector("#config .actions")
      .insertAdjacentHTML(
        "beforebegin",
        `<label class="check"><input type="checkbox" name="allowList" ${s.allowList ? "checked" : ""}> Require players to be added to the Bedrock allow list</label>${propertySections(s)}`,
      );
    document
      .querySelector("#config .actions")
      .insertAdjacentHTML(
        "afterbegin",
        `<button type="button" class="btn ghost" onclick="exportServer('${s.id}')" ${s.status === "online" ? "disabled" : ""}>Export Server</button>`,
      );
    document
      .querySelector("#config")
      .insertAdjacentHTML(
        "afterend",
        `<section class="danger-zone"><div><strong>Delete world data</strong><p>Remove the <b>${esc(s.worldName)}</b> world folder. The server instance and configuration remain, and Bedrock creates a new world on its next start.</p></div><button type="button" class="btn danger" onclick="confirmWorldDelete('${s.id}')" ${s.status === "online" ? "disabled" : ""}>Delete World</button></section>`,
      );
    if (!canManageServers()) {
      document
        .querySelector("#config")
        .insertAdjacentHTML(
          "afterbegin",
          '<div class="readonly-notice" role="status"><strong>View-only settings</strong><span>Your User role can review this server configuration but cannot change it.</span></div>',
        );
      document
        .querySelectorAll("#config input, #config select, #config button")
        .forEach((control) => (control.disabled = true));
      document.querySelector("#config .actions")?.remove();
      document.querySelector(".danger-zone")?.remove();
      return;
    }
    document.querySelector("#config").onsubmit = async (e) => {
      e.preventDefault();
      const o = Object.fromEntries(new FormData(e.target));
      o.allowCheats = e.target.allowCheats.checked;
      o.allowList = e.target.allowList.checked;
      const eulaControl = e.target.elements.eulaAccepted;
      o.eulaAccepted =
        eulaControl.type === "hidden" ? true : eulaControl.checked;
      o.properties = {};
      for (const field of state.propertySchema) {
        const element = e.target.elements[`prop.${field.key}`];
        o.properties[field.key] =
          field.key === "allow-list"
            ? o.allowList
            : field.type === "boolean"
              ? Boolean(element?.checked)
              : (element?.value ?? field.default);
      }
      try {
        state.current = await api(`/api/servers/${s.id}`, {
          method: "PUT",
          body: JSON.stringify(o),
        });
        toast("Configuration saved");
        await openServer(s.id, "status");
      } catch (x) {
        toast(x.message, true);
      }
    };
    return;
  }
  shell(
    `<header class="topbar"><div><button class="back" onclick="loadServers()">← All servers</button><h1>${esc(s.name)}</h1></div><button class="admin-btn" onclick="adminView()">System Admin</button></header><div class="detail-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">Live console</span><h2>Server status</h2></div><span class="status"><i class="dot ${s.status}"></i>${s.status}</span></div><div class="metric-grid"><div class="metric"><span>Players</span><b>${s.playersOnline} / ${s.maxPlayers}</b></div><div class="metric"><span>Port</span><b>${s.port}</b></div><div class="metric"><span>Process</span><b>${s.pid || "—"}</b></div></div><div class="console ${s.log ? "" : "empty"}">${s.log ? esc(s.log) : "Console output will appear here when the server starts."}</div><form id="command" class="command"><input name="command" placeholder="Enter a Bedrock command" ${s.status !== "online" ? "disabled" : ""}><button class="btn ghost" ${s.status !== "online" ? "disabled" : ""}>Send</button></form></section><aside class="panel"><span class="eyebrow">Controls</span><h2>${esc(s.worldName)}</h2><p class="sub">${s.lastError ? esc(s.lastError) : "Use the controls below to manage this instance."}</p><div class="actions">${s.status === "online" ? `<button class="btn danger" onclick="control('${s.id}','stop')">Stop server</button>` : `<button class="btn primary" onclick="control('${s.id}','start')">Start server</button>`}<button class="btn ghost" onclick="openServer('${s.id}','config')">Configure</button></div></aside></div>`,
    tab,
  );
  document.querySelector(".topbar .admin-btn")?.remove();
  if (!canManageServers()) document.querySelector("#command")?.remove();
  const consoleOutput = document.querySelector(".console");
  if (consoleOutput) {
    requestAnimationFrame(() => {
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    });
  }
  const commandForm = document.querySelector("#command");
  if (commandForm)
    commandForm.onsubmit = async (e) => {
      e.preventDefault();
      const cmd = e.target.command.value;
      if (!cmd) return;
      try {
        await api(`/api/servers/${s.id}/command`, {
          method: "POST",
          body: JSON.stringify({ command: cmd }),
        });
        e.target.reset();
      } catch (x) {
        toast(x.message, true);
      }
    };
}
async function exportServer(id) {
  try {
    toast("Preparing server archive…");
    const response = await fetch(`/api/servers/${id}/export`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Export failed");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = match
      ? decodeURIComponent(match[1])
      : "bedrock-server.bedrock-beacon.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Server export downloaded");
  } catch (error) {
    toast(error.message, true);
  }
}
function confirmWorldDelete(id) {
  const server = state.current;
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-wrap" id="world-delete-modal"><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="world-delete-title"><span class="eyebrow danger-text">Permanent world deletion</span><h2 id="world-delete-title">Delete ${esc(server.worldName)}?</h2><p class="sub">This permanently removes the world and every player build inside it. Type <b>${esc(server.worldName)}</b> to confirm.</p><div class="field"><label>World name</label><input id="world-confirm-name" autocomplete="off"></div><div class="actions"><button class="btn ghost" onclick="document.querySelector('#world-delete-modal').remove()">Cancel</button><button id="confirm-world-delete" class="btn danger-solid" disabled onclick="deleteWorld('${id}')">Delete World</button></div></div></div>`,
  );
  document
    .querySelector("#world-confirm-name")
    .addEventListener("input", (event) => {
      document.querySelector("#confirm-world-delete").disabled =
        event.target.value !== server.worldName;
    });
}
async function deleteWorld(id) {
  const button = document.querySelector("#confirm-world-delete");
  const worldName = document.querySelector("#world-confirm-name").value;
  button.disabled = true;
  button.innerHTML = '<i class="spinner"></i> Deleting…';
  try {
    await api(`/api/servers/${id}/world`, {
      method: "DELETE",
      body: JSON.stringify({ worldName }),
    });
    document.querySelector("#world-delete-modal")?.remove();
    toast("World deleted. A new world will be generated on next start.");
    await openServer(id, "status");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Delete World";
    toast(error.message, true);
  }
}
async function control(id, action) {
  try {
    await api(`/api/servers/${id}/${action}`, { method: "POST", body: "{}" });
    toast(action === "start" ? "Server is starting" : "Stop requested");
    setTimeout(() => openServer(id), 500);
  } catch (e) {
    toast(e.message, true);
  }
}
async function adminView() {
  clearInterval(state.poll);
  try {
    const a = await api("/api/admin");
    state.current = null;
    shell(
      `<header class="topbar"><div><button class="back" onclick="loadServers()">← Server dashboard</button><span class="eyebrow">System</span><h1>Administration</h1></div><button class="admin-btn" onclick="logout()">Sign out</button></header><div class="admin-layout"><section class="panel"><div class="panel-head"><div><h2>Bedrock installation</h2><p class="sub">The clean source used whenever a new server is created.</p></div></div>${a.settings.templateVersion ? `<div class="notice">Template ${esc(a.settings.templateVersion)} is installed and ready.</div>` : '<div class="notice">Install a server template before creating your first world.</div>'}<div class="actions">${a.bundledArchive ? `<button class="btn primary" onclick="installBundled()">Install bundled ${esc(a.bundledArchive)}</button>` : ""}</div><form id="upload" class="dropzone" style="margin-top:18px"><div class="field"><label>Or upload an official Bedrock Server ZIP</label><input name="archive" type="file" accept=".zip" required></div><button class="btn ghost">Upload and install</button></form></section><section class="panel"><h2>Local account</h2><p class="sub">Signed in as <b>${esc(a.username)}</b>. The portal listens only on this computer at <b>localhost:3210</b>.</p></section></div>`,
      "admin",
    );
    document.querySelector(".topbar .admin-btn")?.remove();
    const installNotice = document.querySelector(".notice");
    if (installNotice) {
      installNotice.outerHTML = a.settings.templateVersion
        ? `<div class="install-hero"><div class="install-icon">✓</div><div class="install-copy"><strong>Bedrock server installed</strong><span>Version <code>${esc(a.settings.templateVersion)}</code> is installed and ready for new server instances.</span><span>Source: ${esc(a.settings.templateSource || "official Bedrock archive")}</span></div></div>`
        : `<div class="install-hero missing"><div class="install-icon">!</div><div class="install-copy"><strong>Bedrock server not installed</strong><span>Install the bundled archive or upload an official Bedrock Server ZIP before creating an instance.</span></div></div>`;
    }
    document
      .querySelector(".install-hero")
      .insertAdjacentHTML(
        "afterend",
        `<div class="download-callout"><div class="download-callout-icon" aria-hidden="true">↓</div><div><strong>Need the official Bedrock server?</strong><p>Download the <b>Windows</b> version from Minecraft, then upload the downloaded ZIP below.</p></div><a class="external-button" href="https://www.minecraft.net/en-us/download/server/bedrock" target="_blank" rel="noopener noreferrer">Download for Windows <span aria-hidden="true">↗</span></a></div>`,
      );
    const gateway = a.gateway;
    document
      .querySelector(".admin-layout .panel")
      .insertAdjacentHTML(
        "afterend",
        `<section class="panel gateway-panel"><div class="panel-head"><div><span class="eyebrow">Console access</span><h2>BedrockConnect Gateway</h2><p class="sub">One automatically discovered LAN entry for every Beacon world.</p></div><span class="status"><i class="dot ${gateway.status}"></i>${gateway.status}</span></div><div class="gateway-summary"><div><span>Advertisement</span><strong>${esc(gateway.address)}:${gateway.port}</strong></div><div><span>Backend worlds</span><strong>${gateway.entries}</strong></div><div><span>Version</span><strong>${esc(gateway.version)}</strong></div></div><p class="gateway-note">The gateway reserves UDP ${gateway.port}. Backend servers use ${gateway.port + 2} and higher. On Xbox or PlayStation, look for <b>BedrockConnect</b> in the Worlds tab under LAN Games.</p><div class="actions">${gateway.status === "online" ? `<button class="btn danger" onclick="gatewayControl('stop')">Stop Gateway</button><button class="btn ghost" onclick="gatewayControl('reset')">Refresh Server List</button>` : `<button class="btn primary" onclick="gatewayControl('start')">Start Gateway</button>`}</div>${gateway.log ? `<details class="gateway-log"><summary>Gateway log</summary><pre>${esc(gateway.log)}</pre></details>` : ""}</section>`,
      );
    const service = a.windowsService;
    document
      .querySelector(".gateway-panel")
      .insertAdjacentHTML(
        "afterend",
        `<section class="panel service-panel"><div class="panel-head"><div><span class="eyebrow">Background operation</span><h2>Windows Service</h2><p class="sub">Start Beacon, the gateway, and managed worlds without an interactive terminal.</p></div><span class="service-badge ${service.installed ? "installed" : ""}">${esc(service.state)}</span></div><div class="service-copy"><strong>${service.installed ? "Bedrock Beacon is installed as a Windows service." : "Bedrock Beacon is currently an interactive application."}</strong><p>${service.installed ? "Startup is Automatic (Delayed Start), with restart-on-failure and rolling logs in data/service-logs." : "Installation requires Administrator privileges. After installing, close this interactive Beacon window before starting the service."}</p></div><div class="actions">${service.installed ? `<button class="btn danger" onclick="serviceControl('uninstall')" ${service.state === "running" ? "disabled" : ""}>Uninstall Service</button>` : `<button class="btn primary" onclick="serviceControl('install')">Install Windows Service</button>`}</div></section>`,
      );
    const application = a.application;
    document
      .querySelector(".service-panel")
      .insertAdjacentHTML(
        "afterend",
        `<section class="panel update-panel"><div class="panel-head"><div><span class="eyebrow">Application maintenance</span><h2>Install Update</h2><p class="sub">Replace Beacon with a complete portable application package.</p></div><span class="version-badge">v${esc(application.version)}</span></div><div class="update-warning"><strong>Before installing</strong><p>Stop every managed server and use only a trusted Bedrock Beacon ZIP. Beacon validates and stages the package, preserves accounts, settings, templates, and worlds, then restarts automatically.</p></div><form id="application-update" class="update-form"><div class="field"><label for="update-archive">Complete Bedrock Beacon ZIP</label><input id="update-archive" name="archive" type="file" accept=".zip,application/zip" required><small>The archive must contain the complete Windows x64 application, including its bundled Node.js runtime.</small></div><label class="update-confirm"><input name="confirmed" type="checkbox" required><span>I have stopped all worlds and trust the source of this update package.</span></label><div class="actions"><button class="btn primary" type="submit">Install Update</button></div></form></section>`,
      );
    document
      .querySelector(".update-panel .panel-head")
      .insertAdjacentHTML(
        "afterend",
        `<div class="download-callout release-callout"><div class="download-callout-icon" aria-hidden="true">BB</div><div><strong>Official Bedrock Beacon releases</strong><p>Download the latest Windows x64 release ZIP from the project’s GitHub Releases page.</p></div><a class="external-button" href="https://github.com/mytechliving/Bedrock-Beacon/releases" target="_blank" rel="noopener noreferrer">View Releases <span aria-hidden="true">↗</span></a></div>`,
      );
    document
      .querySelector(".update-panel")
      .insertAdjacentHTML(
        "afterend",
        `<section class="panel support-panel"><div class="support-copy"><span class="eyebrow">Support development</span><h2>Buy me a coffee</h2><p class="sub">If Bedrock Beacon makes managing your worlds easier, you can support its continued development with a one-time contribution through PayPal.</p><form action="https://www.paypal.com/ncp/payment/ZC3R56EUDXHGN" method="post" target="_blank" rel="noopener noreferrer"><button class="paypal-button" type="submit">Buy me a coffee <span aria-hidden="true">↗</span></button><span class="paypal-powered">Secure payment powered by <b>PayPal</b></span></form></div><div class="support-qr"><img src="/assets/buy-me-a-coffee-qr.png" alt="QR code for the Bedrock Beacon Buy me a coffee PayPal payment page"><span>Scan with your phone</span></div></section>`,
      );
    document
      .querySelector(".admin-layout")
      .prepend(document.querySelector(".support-panel"));
    document.querySelector("#upload").onsubmit = async (e) => {
      e.preventDefault();
      try {
        toast("Installing template…");
        await api("/api/admin/upload", {
          method: "POST",
          body: new FormData(e.target),
        });
        toast("Template installed");
        adminView();
      } catch (x) {
        toast(x.message, true);
      }
    };
    document.querySelector("#application-update").onsubmit =
      installApplicationUpdate;
  } catch (e) {
    toast(e.message, true);
  }
}
async function usersView() {
  clearInterval(state.poll);
  try {
    const users = await api("/api/users");
    state.current = null;
    shell(
      `<header class="topbar"><div><span class="eyebrow">Access control</span><h1>Users</h1><p class="sub">Create local accounts and control what each person can manage.</p></div></header><section class="role-grid"><article><span class="role-badge admin">Admin</span><strong>Full system access</strong><p>Manage users, system settings, updates, services, gateways, and every server.</p></article><article><span class="role-badge manager">Manager</span><strong>Server management</strong><p>Create, configure, import, export, delete, reset, start, and stop servers. No System Admin access.</p></article><article><span class="role-badge user">User</span><strong>Operate and observe</strong><p>View status and settings, and start or stop servers. Cannot modify configuration or create or delete servers.</p></article></section><section class="panel user-create-panel"><div class="panel-head"><div><h2>Add user</h2><p class="sub">Accounts are stored only on this computer.</p></div></div><form id="create-user" class="user-form"><div class="field"><label>Username</label><input name="username" minlength="3" autocomplete="off" required></div><div class="field"><label>Temporary password</label><input name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Permission</label><select name="role"><option value="user">User</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div><button class="btn primary" type="submit">Add User</button></form></section><section class="panel"><div class="panel-head"><div><h2>Existing users</h2><p class="sub">${users.length} local ${users.length === 1 ? "account" : "accounts"}</p></div></div><div class="users-list">${users.map(userRow).join("")}</div></section>`,
      "users",
    );
    document.querySelector("#create-user").onsubmit = createUser;
    document.querySelectorAll(".user-row form").forEach((form) => {
      form.onsubmit = saveUser;
    });
  } catch (error) {
    toast(error.message, true);
    if (error.message.includes("permission")) loadServers();
  }
}
function userRow(user) {
  const isSelf = user.id === state.user?.id;
  return `<article class="user-row"><div class="user-identity"><div class="user-avatar">${esc(user.username.slice(0, 1).toUpperCase())}</div><div><strong>${esc(user.username)}</strong><span>${isSelf ? "Current account" : "Local account"}</span></div></div><form data-user-id="${user.id}"><div class="field"><label>Username</label><input name="username" value="${esc(user.username)}" minlength="3" required></div><div class="field"><label>Permission</label><select name="role"><option value="user" ${user.role === "user" ? "selected" : ""}>User</option><option value="manager" ${user.role === "manager" ? "selected" : ""}>Manager</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option></select></div><div class="field"><label>New password <small>optional</small></label><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave unchanged"></div><div class="user-row-actions"><button class="btn ghost" type="submit">Save</button><button class="btn danger" type="button" onclick="deleteUser('${user.id}')" ${isSelf ? "disabled title=\"You cannot delete your signed-in account\"" : ""}>Remove</button></div></form></article>`;
}
function accountView() {
  clearInterval(state.poll);
  state.page = "account";
  state.current = null;
  shell(
    `<header class="topbar"><div><span class="eyebrow">My Account</span><h1>Password & security</h1><p class="sub">Signed in as <b>${esc(state.user?.username)}</b>.</p></div></header><section class="panel account-panel"><div class="panel-head"><div><h2>Change password</h2><p class="sub">Enter your current password before choosing a replacement.</p></div><span class="role-badge ${esc(state.user?.role)}">${roleName()}</span></div><form id="change-password" class="account-password-form"><div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>New password</label><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required><small>Use at least 8 characters.</small></div><div class="field"><label>Confirm new password</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><div class="actions"><button class="btn primary" type="submit">Change password</button></div></form><div class="account-security-note"><strong>Other sessions will be signed out</strong><span>Your current session stays active after the password is changed.</span></div></section>`,
    "account",
  );
  document.querySelector("#change-password").onsubmit = changePassword;
}
async function changePassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  if (values.newPassword !== values.confirmPassword) return toast("New passwords do not match", true);
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await api("/api/account/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword: values.currentPassword, newPassword: values.newPassword }),
    });
    form.reset();
    toast("Password changed successfully");
  } catch (error) {
    toast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}
async function createUser(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
    });
    toast("User added");
    await usersView();
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}
async function saveUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.dataset.userId;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const user = await api(`/api/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    if (state.user?.id === user.id) state.user = user;
    toast("User updated");
    if (isAdmin()) await usersView();
    else await loadServers();
  } catch (error) {
    button.disabled = false;
    toast(error.message, true);
  }
}
async function deleteUser(id) {
  if (!confirm("Remove this user? They will be signed out immediately.")) return;
  try {
    await api(`/api/users/${id}`, { method: "DELETE", body: "{}" });
    toast("User removed");
    await usersView();
  } catch (error) {
    toast(error.message, true);
  }
}
async function installApplicationUpdate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = "Uploading and validating...";
  try {
    const result = await api("/api/update/install", {
      method: "POST",
      body: new FormData(form),
    });
    shell(
      `<div class="restart-view" role="status" aria-live="polite"><div class="restart-spinner" aria-hidden="true"></div><span class="eyebrow">Installing update</span><h1>Beacon is restarting</h1><p>Updating from version ${esc(result.currentVersion)} to <b>${esc(result.installingVersion)}</b>. Your accounts, settings, servers, and worlds are being preserved.</p><p class="sub">This page will reconnect automatically.</p></div>`,
      "admin",
    );
    waitForApplicationRestart();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Install Update";
    toast(error.message, true);
  }
}
async function waitForApplicationRestart() {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  for (;;) {
    try {
      const response = await fetch("/api/bootstrap", { cache: "no-store" });
      if (response.ok) {
        location.reload();
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}
async function gatewayControl(action) {
  try {
    toast(
      action === "start"
        ? "Starting console gateway…"
        : action === "stop"
          ? "Stopping console gateway…"
          : "Refreshing gateway…",
    );
    await api(`/api/gateway/${action}`, { method: "POST", body: "{}" });
    await adminView();
  } catch (error) {
    toast(error.message, true);
  }
}
async function serviceControl(action) {
  try {
    toast(
      action === "install"
        ? "Installing Windows service…"
        : "Removing Windows service…",
    );
    await api(`/api/service/${action}`, { method: "POST", body: "{}" });
    toast(
      action === "install"
        ? "Service installed. Close Beacon before starting it."
        : "Service removed; server data was preserved.",
    );
    await adminView();
  } catch (error) {
    toast(error.message, true);
  }
}
async function installBundled() {
  try {
    toast("Installing bundled server…");
    await api("/api/admin/install-bundled", { method: "POST", body: "{}" });
    toast("Template installed");
    adminView();
  } catch (e) {
    toast(e.message, true);
  }
}
async function logout() {
  await api("/api/logout", { method: "POST", body: "{}" });
  state.user = null;
  quickView();
}
(async () => {
  const b = await api("/api/bootstrap");
  state.user = b.authenticated ? b.user : null;
  quickView();
})().catch((e) => toast(e.message, true));
