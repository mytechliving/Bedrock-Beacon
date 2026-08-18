const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const PROPERTY_SCHEMA = require('./property-schema');
const APP_MANIFEST = require('./app-manifest.json');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SERVERS = path.join(ROOT, 'Servers');
const TEMPLATE = path.join(DATA, 'template');
const DB_FILE = path.join(DATA, 'manager.json');
const UPLOADS = path.join(DATA, 'uploads');
const GATEWAY_DIR = path.join(DATA, 'bedrockconnect');
const GATEWAY_JAR = path.join(GATEWAY_DIR, 'BedrockConnect-1.69.0.jar');
const GATEWAY_CONFIG = path.join(GATEWAY_DIR, 'custom_servers.json');
const BUNDLED_JAVA = path.join(ROOT, 'runtime', 'java', 'jdk-21.0.12+8-jre', 'bin', 'java.exe');
const SERVICE_WRAPPER = path.join(ROOT, 'service', 'BedrockHarborService.exe');
const UPDATES = path.join(DATA, 'updates');
for (const dir of [DATA, SERVERS, UPLOADS, UPDATES]) fs.mkdirSync(dir, { recursive: true });

const defaults = { user: null, users: [], settings: { portalPort: 3210, templateVersion: null, templateSource: null, gatewayEnabled: false, gatewayPort: 19132, gatewayVersion: '1.69.0' }, servers: [] };
let db = fs.existsSync(DB_FILE) ? { ...defaults, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } : structuredClone(defaults);
db.settings = { ...defaults.settings, ...db.settings };
db.users = Array.isArray(db.users) ? db.users : [];
const processes = new Map();
const sessions = new Map();
const logs = new Map();
const players = new Map();
const creatingServers = new Set();
let gatewayProcess = null;
let gatewayLog = '';
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
if (!db.users.length && db.user) {
  db.users.push({ id: crypto.randomBytes(8).toString('hex'), username: db.user.username, salt: db.user.salt, hash: db.user.hash, role: 'admin' });
  db.user = null;
  save();
}
const safeId = value => String(value || '').replace(/[^a-z0-9-]/gi, '');
const serverById = id => db.servers.find(s => s.id === safeId(id));
const instanceDir = id => path.join(SERVERS, safeId(id));
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') });
const validPassword = (password, user) => crypto.timingSafeEqual(Buffer.from(hashPassword(password, user.salt).hash, 'hex'), Buffer.from(user.hash, 'hex'));
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => v.trim().split('=').map(decodeURIComponent)));

const publicUser = user => ({ id: user.id, username: user.username, role: user.role });
function currentUser(req) {
  const token = parseCookies(req).bh_session;
  const userId = token && sessions.get(token);
  return userId ? db.users.find(user => user.id === userId) || null : null;
}
function auth(req, res, next) {
  req.user = currentUser(req);
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}
const allowRoles = (...roles) => (req, res, next) => {
  auth(req, res, () => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to perform this action' }));
};
const adminOnly = allowRoles('admin');
const manageServers = allowRoles('admin', 'manager');
function serverJson(s) {
  const p = processes.get(s.id);
  const file = path.join(instanceDir(s.id), 'server.properties');
  const properties = fs.existsSync(file) ? parseProperties(fs.readFileSync(file, 'utf8')) : propertyValues(s);
  return { ...s, properties, status: p ? 'online' : (s.lastError ? 'error' : 'offline'), pid: p?.pid || null, playersOnline: players.get(s.id)?.size || 0 };
}
function appendLog(id, chunk) {
  const text = String(chunk);
  const roster = players.get(id) || new Set();
  for (const line of text.split(/\r?\n/)) {
    const joined = line.match(/Player connected:\s*([^,]+)/i);
    const left = line.match(/Player disconnected:\s*([^,]+)/i);
    if (joined) roster.add(joined[1].trim());
    if (left) roster.delete(left[1].trim());
  }
  players.set(id, roster);
  const current = (logs.get(id) || '') + text;
  logs.set(id, current.slice(-50000));
  const file = path.join(instanceDir(id), 'manager.log');
  if (fs.existsSync(instanceDir(id))) fs.appendFile(file, text, () => {});
}
function parseProperties(content) {
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('='); out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}
function writeProperties(file, values) {
  let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const seen = new Set();
  const lines = content.split(/\r?\n/).map(line => {
    if (!line || line.startsWith('#') || !line.includes('=')) return line;
    const key = line.slice(0, line.indexOf('='));
    if (!(key in values)) return line;
    seen.add(key); return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) if (!seen.has(key)) lines.push(`${key}=${value}`);
  fs.writeFileSync(file, lines.join('\r\n'));
}
function configuredPorts(exceptId = null) {
  return new Set([Number(db.settings.gatewayPort || 19132), Number(db.settings.gatewayPort || 19132) + 1, ...db.servers.filter(s => s.id !== exceptId).flatMap(s => [Number(s.port), Number(s.port) + 1])]);
}
function findAvailablePortPair() {
  const used = configuredPorts();
  let port = 19134;
  while (used.has(port) || used.has(port + 1)) port += 2;
  return port;
}
function localLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) if (address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.')) return address.address;
  }
  return '127.0.0.1';
}
function writeGatewayConfig() {
  fs.mkdirSync(GATEWAY_DIR, { recursive: true });
  const address = localLanAddress();
  const entries = db.servers.map(s => ({ name: s.name, address, port: Number(s.port) }));
  fs.writeFileSync(GATEWAY_CONFIG, JSON.stringify(entries, null, 2));
  return entries;
}
function gatewayJson() {
  return { installed: fs.existsSync(GATEWAY_JAR), enabled: db.settings.gatewayEnabled === true, status: gatewayProcess ? 'online' : 'offline', pid: gatewayProcess?.pid || null, port: Number(db.settings.gatewayPort || 19132), version: db.settings.gatewayVersion, address: localLanAddress(), entries: db.servers.length, log: gatewayLog };
}
async function startGateway() {
  if (gatewayProcess) return gatewayJson();
  if (!fs.existsSync(GATEWAY_JAR)) throw new Error('BedrockConnect is not installed');
  await probeUdp(Number(db.settings.gatewayPort || 19132), 'udp4');
  writeGatewayConfig(); gatewayLog = '';
  const args = ['-Xms128M', '-Xmx512M', '-jar', GATEWAY_JAR, `port=${db.settings.gatewayPort || 19132}`, 'bindip=0.0.0.0', `custom_servers=${GATEWAY_CONFIG}`, 'user_servers=false', 'featured_servers=false'];
  const javaExecutable = fs.existsSync(BUNDLED_JAVA) ? BUNDLED_JAVA : 'java';
  const child = spawn(javaExecutable, args, { cwd: GATEWAY_DIR, windowsHide: true }); gatewayProcess = child;
  const capture = chunk => { gatewayLog = (gatewayLog + String(chunk)).slice(-30000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', error => { gatewayLog += `\n${error.message}`; gatewayProcess = null; });
  child.on('exit', code => { gatewayLog += `\nGateway exited with code ${code}`; gatewayProcess = null; });
  return gatewayJson();
}
function stopGateway() { if (!gatewayProcess) return false; gatewayProcess.kill(); gatewayProcess = null; return true; }
function windowsServiceJson() {
  try {
    const output = execFileSync('sc.exe', ['query', 'BedrockHarbor'], { encoding: 'utf8', windowsHide: true });
    const state = output.match(/STATE\s*:\s*\d+\s+(\w+)/i)?.[1]?.toLowerCase() || 'unknown';
    return { installed: true, state, automatic: true };
  } catch { return { installed: false, state: 'not installed', automatic: false }; }
}
function migrateGatewayPorts() {
  const reserved = new Set([19132, 19133]); let next = 19134; let changed = false;
  for (const s of [...db.servers].sort((a, b) => Number(a.port) - Number(b.port))) {
    if (reserved.has(Number(s.port)) || reserved.has(Number(s.port) + 1)) {
      while (reserved.has(next) || reserved.has(next + 1)) next += 2;
      s.port = next; writeProperties(path.join(instanceDir(s.id), 'server.properties'), propertyValues(s)); changed = true;
    }
    reserved.add(Number(s.port)); reserved.add(Number(s.port) + 1); next = Math.max(next, Number(s.port) + 2);
  }
  if (changed) save(); writeGatewayConfig();
}
function probeUdp(port, type) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(type);
    socket.once('error', error => { socket.close(); reject(error); });
    socket.bind(port, type === 'udp4' ? '0.0.0.0' : '::', () => socket.close(() => resolve()));
  });
}
async function assertPortsAvailable(s) {
  try {
    await probeUdp(Number(s.port), 'udp4');
    await probeUdp(Number(s.port) + 1, 'udp6');
  } catch (error) {
    throw new Error(`UDP port ${error?.port || `${s.port}/${Number(s.port) + 1}`} is already in use. Stop the conflicting server or choose another port pair.`);
  }
}
function installTemplate(zipPath) {
  const zip = new AdmZip(zipPath);
  if (!zip.getEntry('bedrock_server.exe')) throw new Error('Archive does not contain bedrock_server.exe');
  const staging = `${TEMPLATE}.new`;
  fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
  zip.extractAllTo(staging, true);
  fs.rmSync(TEMPLATE, { recursive: true, force: true }); fs.renameSync(staging, TEMPLATE);
  const match = path.basename(zipPath).match(/bedrock-server-(.+)\.zip/i);
  db.settings.templateVersion = match?.[1] || 'Installed'; db.settings.templateSource = path.basename(zipPath); save();
}
function stopServer(id) {
  const child = processes.get(id); if (!child) return false;
  child.stdin.write('stop\n');
  setTimeout(() => { if (processes.has(id)) child.kill(); }, 10000).unref();
  return true;
}

const app = express();
const upload = multer({ dest: UPLOADS, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });
function runProcess(executable, args, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true }); let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${executable} exited with code ${code}`)));
  });
}
app.use(express.json({ limit: '1mb' }));
app.get('/api/bootstrap', (req, res) => { const user = currentUser(req); res.json({ needsSetup: db.users.length === 0, authenticated: Boolean(user), user: user ? publicUser(user) : null, template: db.settings }); });
app.get('/api/quick-view', (req, res) => res.json(db.servers.map(server => ({
  name: server.name,
  worldName: server.worldName,
  status: processes.has(server.id) ? 'online' : 'offline',
  playersOnline: players.get(server.id)?.size || 0,
  maxPlayers: server.maxPlayers,
}))));
app.post('/api/setup', (req, res) => {
  if (db.users.length) return res.status(409).json({ error: 'Account already exists' });
  const username = String(req.body.username || '').trim(); const password = String(req.body.password || '');
  if (username.length < 3 || password.length < 8) return res.status(400).json({ error: 'Use a 3+ character username and 8+ character password' });
  db.users.push({ id: crypto.randomBytes(8).toString('hex'), username, role: 'admin', ...hashPassword(password) }); save(); return login(req, res);
});
app.post('/api/reset-account', (req, res) => {
  if (db.users.length) return res.status(403).json({ error: 'Ask an administrator to manage accounts from the Users page' });
  const username = String(req.body.username || '').trim(); const password = String(req.body.password || '');
  if (username.length < 3 || password.length < 8) return res.status(400).json({ error: 'Use a 3+ character username and 8+ character password' });
  db.users.push({ id: crypto.randomBytes(8).toString('hex'), username, role: 'admin', ...hashPassword(password) }); sessions.clear(); save(); return login(req, res);
});
function login(req, res) {
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = db.users.find(candidate => candidate.username.toLowerCase() === username);
  if (!user || !validPassword(String(req.body.password || ''), user)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, user.id);
  res.setHeader('Set-Cookie', `bh_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`); res.json({ user: publicUser(user) });
}
app.post('/api/login', login);
app.post('/api/logout', auth, (req, res) => { sessions.delete(parseCookies(req).bh_session); res.setHeader('Set-Cookie', 'bh_session=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.put('/api/account/password', auth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || ''); const newPassword = String(req.body.newPassword || '');
  if (!validPassword(currentPassword, req.user)) return res.status(401).json({ error: 'Current password is incorrect' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must contain at least 8 characters' });
  if (currentPassword === newPassword) return res.status(400).json({ error: 'Choose a password different from your current password' });
  Object.assign(req.user, hashPassword(newPassword));
  const currentToken = parseCookies(req).bh_session;
  for (const [token, userId] of sessions) if (userId === req.user.id && token !== currentToken) sessions.delete(token);
  save(); res.json({ ok: true });
});
app.get('/api/users', adminOnly, (req, res) => res.json(db.users.map(publicUser)));
app.post('/api/users', adminOnly, (req, res) => {
  const username = String(req.body.username || '').trim(); const password = String(req.body.password || ''); const role = String(req.body.role || '').toLowerCase();
  if (username.length < 3 || password.length < 8) return res.status(400).json({ error: 'Use a 3+ character username and 8+ character password' });
  if (!['admin', 'manager', 'user'].includes(role)) return res.status(400).json({ error: 'Choose Admin, Manager, or User' });
  if (db.users.some(user => user.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username already exists' });
  const user = { id: crypto.randomBytes(8).toString('hex'), username, role, ...hashPassword(password) }; db.users.push(user); save(); res.status(201).json(publicUser(user));
});
app.put('/api/users/:id', adminOnly, (req, res) => {
  const user = db.users.find(candidate => candidate.id === safeId(req.params.id)); if (!user) return res.status(404).json({ error: 'User not found' });
  const username = String(req.body.username ?? user.username).trim(); const role = String(req.body.role ?? user.role).toLowerCase(); const password = String(req.body.password || '');
  if (username.length < 3) return res.status(400).json({ error: 'Username must contain at least 3 characters' });
  if (!['admin', 'manager', 'user'].includes(role)) return res.status(400).json({ error: 'Choose Admin, Manager, or User' });
  if (db.users.some(candidate => candidate.id !== user.id && candidate.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error: 'That username already exists' });
  if (user.role === 'admin' && role !== 'admin' && db.users.filter(candidate => candidate.role === 'admin').length === 1) return res.status(409).json({ error: 'At least one Admin account is required' });
  if (password && password.length < 8) return res.status(400).json({ error: 'New passwords must contain at least 8 characters' });
  user.username = username; user.role = role; if (password) Object.assign(user, hashPassword(password)); save(); res.json(publicUser(user));
});
app.delete('/api/users/:id', adminOnly, (req, res) => {
  const user = db.users.find(candidate => candidate.id === safeId(req.params.id)); if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(409).json({ error: 'You cannot delete your signed-in account' });
  if (user.role === 'admin' && db.users.filter(candidate => candidate.role === 'admin').length === 1) return res.status(409).json({ error: 'At least one Admin account is required' });
  db.users = db.users.filter(candidate => candidate.id !== user.id); for (const [token, userId] of sessions) if (userId === user.id) sessions.delete(token); save(); res.json({ ok: true });
});
app.get('/api/admin', adminOnly, (req, res) => res.json({ username: req.user.username, settings: db.settings, bundledArchive: findBundledArchive(), gateway: gatewayJson(), windowsService: windowsServiceJson(), application: APP_MANIFEST }));
function findBundledArchive() { return fs.readdirSync(ROOT).find(n => /^bedrock-server-.*\.zip$/i.test(n)) || null; }
app.post('/api/admin/install-bundled', adminOnly, (req, res) => { try { const name = findBundledArchive(); if (!name) throw new Error('No Bedrock server ZIP found beside the application'); installTemplate(path.join(ROOT, name)); res.json(db.settings); } catch (e) { res.status(400).json({ error: e.message }); } });
app.post('/api/admin/upload', adminOnly, upload.single('archive'), (req, res) => { try { if (!req.file) throw new Error('Choose a ZIP archive'); installTemplate(req.file.path); fs.rmSync(req.file.path, { force: true }); res.json(db.settings); } catch (e) { if (req.file) fs.rmSync(req.file.path, { force: true }); res.status(400).json({ error: e.message }); } });
app.post('/api/gateway/start', adminOnly, async (req, res) => { try { db.settings.gatewayEnabled = true; migrateGatewayPorts(); save(); res.json(await startGateway()); } catch (e) { res.status(500).json({ error: e.code === 'EADDRINUSE' ? 'UDP 19132 is still in use. Stop or reset the server currently using the default port, then try again.' : e.message }); } });
app.post('/api/gateway/stop', adminOnly, (req, res) => { db.settings.gatewayEnabled = false; stopGateway(); save(); res.json(gatewayJson()); });
app.post('/api/gateway/reset', adminOnly, async (req, res) => { try { stopGateway(); await new Promise(resolve => setTimeout(resolve, 400)); writeGatewayConfig(); res.json(await startGateway()); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/service/install', adminOnly, (req, res) => { try { if (!fs.existsSync(SERVICE_WRAPPER)) throw new Error('WinSW service wrapper is missing'); execFileSync(SERVICE_WRAPPER, ['install'], { cwd: path.dirname(SERVICE_WRAPPER), windowsHide: true, stdio: 'pipe' }); res.json(windowsServiceJson()); } catch (e) { res.status(500).json({ error: `Service installation requires Administrator privileges. ${String(e.stderr || e.message).trim()}` }); } });
app.post('/api/service/uninstall', adminOnly, (req, res) => { try { const status = windowsServiceJson(); if (status.state === 'running') throw new Error('Stop the BedrockHarbor service before uninstalling it'); execFileSync(SERVICE_WRAPPER, ['uninstall'], { cwd: path.dirname(SERVICE_WRAPPER), windowsHide: true, stdio: 'pipe' }); res.json(windowsServiceJson()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });
app.post('/api/update/install', adminOnly, upload.single('archive'), async (req, res) => {
  let workDir = null;
  try {
    if (!req.file) throw new Error('Choose a complete Bedrock Beacon application ZIP');
    if (processes.size) throw new Error('Stop every Bedrock server before installing an application update');
    const zip = new AdmZip(req.file.path); const entries = zip.getEntries(); let totalSize = 0; let manifestEntry = null; const names = new Set();
    for (const entry of entries) {
      const entryName = entry.entryName.replace(/\\/g, '/').replace(/^\.\//, ''); const parts = entryName.split('/');
      if (!entryName || entryName.startsWith('/') || /^[a-z]:/i.test(entryName) || parts.includes('..')) throw new Error('Update archive contains an unsafe file path');
      const unixType = (entry.attr >>> 16) & 0xF000; if (unixType === 0xA000) throw new Error('Update archive symbolic links are not supported');
      totalSize += Number(entry.header.size || 0); if (totalSize > 5 * 1024 * 1024 * 1024) throw new Error('Update archive expands beyond the 5 GB safety limit');
      names.add(entryName); if (entryName === 'app-manifest.json' || entryName.endsWith('/app-manifest.json')) manifestEntry = entry;
    }
    if (!manifestEntry) throw new Error('The ZIP does not contain a Bedrock Beacon application manifest');
    const manifest = JSON.parse(zip.readAsText(manifestEntry));
    if (manifest.product !== 'bedrock-harbor' || manifest.formatVersion !== 1 || manifest.platform !== 'win-x64') throw new Error('This is not a supported Bedrock Beacon Windows application package');
    const manifestName = manifestEntry.entryName.replace(/\\/g, '/').replace(/^\.\//, ''); const prefix = manifestName.slice(0, -'app-manifest.json'.length);
    for (const required of ['server.js','package.json','public/app.js','runtime/node/node.exe','install-update.ps1']) if (!names.has(`${prefix}${required}`)) throw new Error(`Update package is missing ${required}`);
    workDir = path.join(UPDATES, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`); const staging = path.join(workDir, 'staging'); fs.mkdirSync(staging, { recursive: true });
    await runProcess('tar.exe', ['-xf', req.file.path, '-C', staging]); await fs.promises.rm(req.file.path, { force: true });
    const stagingRoot = path.resolve(staging); const source = path.resolve(stagingRoot, ...prefix.split('/').filter(Boolean));
    if (source !== stagingRoot && !source.startsWith(`${stagingRoot}${path.sep}`)) throw new Error('Invalid application root in update package');
    const updater = path.join(workDir, 'install-update.ps1'); await fs.promises.copyFile(path.join(ROOT, 'install-update.ps1'), updater);
    stopGateway();
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updater, '-Source', source, '-Target', ROOT, '-ParentPid', String(process.pid)], { cwd: workDir, windowsHide: true, detached: true, stdio: 'ignore' }); child.unref();
    res.json({ ok: true, restarting: true, currentVersion: APP_MANIFEST.version, installingVersion: manifest.version });
    setTimeout(() => process.exit(0), 1500).unref();
  } catch (e) { if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {}); if (workDir) await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {}); res.status(400).json({ error: e.message }); }
});
app.get('/api/servers', auth, (req, res) => res.json(db.servers.map(serverJson)));
app.get('/api/property-schema', auth, (req, res) => res.json(PROPERTY_SCHEMA));
app.post('/api/servers', manageServers, async (req, res) => {
  let creationKey = null;
  let ownsCreation = false;
  let createdDir = null;
  try {
    if (!fs.existsSync(path.join(TEMPLATE, 'bedrock_server.exe'))) throw new Error('Install a Bedrock server template in System Admin first');
    const name = String(req.body.name || '').trim(); if (!name) throw new Error('Server name is required');
    const worldName = String(req.body.worldName || name).trim();
    creationKey = `${name}\n${worldName}`.toLowerCase();
    if (creatingServers.has(creationKey)) return res.status(409).json({ error: 'This server is already being created. Please wait.' });
    creatingServers.add(creationKey);
    ownsCreation = true;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'server'}-${crypto.randomBytes(3).toString('hex')}`;
    const dir = instanceDir(id); createdDir = dir; await fs.promises.cp(TEMPLATE, dir, { recursive: true });
    const port = findAvailablePortPair();
    const server = { id, name, worldName, port, maxPlayers: 10, gameMode: 'survival', difficulty: 'easy', levelSeed: '', levelType: 'DEFAULT', allowCheats: false, allowList: false, eulaAccepted: false, eulaAcceptedAt: null, createdAt: new Date().toISOString(), lastError: null };
    writeProperties(path.join(dir, 'server.properties'), propertyValues(server)); db.servers.push(server); save(); writeGatewayConfig(); res.status(201).json(serverJson(server));
  } catch (e) { if (createdDir) await fs.promises.rm(createdDir, { recursive: true, force: true }).catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { if (ownsCreation) creatingServers.delete(creationKey); }
});
app.post('/api/servers/import', manageServers, upload.single('archive'), async (req, res) => {
  let createdDir = null;
  try {
    if (!req.file) throw new Error('Choose a Bedrock Beacon ZIP archive');
    if (!fs.existsSync(path.join(TEMPLATE, 'bedrock_server.exe'))) throw new Error('Install a Bedrock server template in System Admin first');
    const zip = new AdmZip(req.file.path); const entries = zip.getEntries(); let uncompressedSize = 0; let manifestEntry = null;
    for (const entry of entries) {
      const entryName = entry.entryName.replace(/\\/g, '/').replace(/^\.\//, ''); const parts = entryName.split('/');
      if (!entryName || entryName.startsWith('/') || /^[a-z]:/i.test(entryName) || parts.includes('..')) throw new Error('Archive contains an unsafe file path');
      const base = parts.at(-1).toLowerCase(); if (base === 'bedrock_server.exe' || base.endsWith('.dll')) throw new Error('Archive must not contain executable Bedrock runtime files');
      const unixType = (entry.attr >>> 16) & 0xF000; if (unixType === 0xA000) throw new Error('Archive symbolic links are not supported');
      uncompressedSize += Number(entry.header.size || 0); if (uncompressedSize > 20 * 1024 * 1024 * 1024) throw new Error('Archive expands beyond the 20 GB safety limit');
      if (entryName === '.bedrock-beacon.json' || entryName === '.bedrock-harbor.json') manifestEntry = entry;
    }
    if (!manifestEntry) throw new Error('This is not a Bedrock Beacon server export');
    const manifest = JSON.parse(zip.readAsText(manifestEntry));
    if (!['bedrock-beacon-server', 'bedrock-harbor-server'].includes(manifest.format) || manifest.version !== 1 || !manifest.server) throw new Error('Unsupported Beacon archive format');
    const source = manifest.server; const name = String(source.name || 'Imported Server').trim(); const worldName = String(source.worldName || 'Imported World').trim();
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'imported'}-${crypto.randomBytes(3).toString('hex')}`;
    createdDir = instanceDir(id); await fs.promises.cp(TEMPLATE, createdDir, { recursive: true });
    await runProcess('tar.exe', ['-xf', req.file.path, '-C', createdDir]);
    await fs.promises.rm(path.join(createdDir, manifestEntry.entryName), { force: true }); await fs.promises.rm(path.join(createdDir, 'eula.txt'), { force: true });
    const properties = validateProperties(source.properties || {}); properties['enable-lan-visibility'] = false;
    const server = { id, name, worldName, port: findAvailablePortPair(), maxPlayers: Math.min(1000, Math.max(1, Number(source.maxPlayers) || 10)), gameMode: ['survival','creative','adventure'].includes(source.gameMode) ? source.gameMode : 'survival', difficulty: ['peaceful','easy','normal','hard'].includes(source.difficulty) ? source.difficulty : 'easy', levelSeed: String(source.levelSeed || ''), levelType: String(source.levelType || 'DEFAULT').toUpperCase(), allowCheats: source.allowCheats === true, allowList: source.allowList === true, properties, eulaAccepted: false, eulaAcceptedAt: null, createdAt: new Date().toISOString(), importedAt: new Date().toISOString(), lastError: null };
    writeProperties(path.join(createdDir, 'server.properties'), propertyValues(server)); fs.writeFileSync(path.join(createdDir, 'eula.txt'), '# EULA acceptance must be recorded in Bedrock Beacon\r\neula=false\r\n');
    db.servers.push(server); save(); writeGatewayConfig(); res.status(201).json(serverJson(server));
  } catch (e) { if (createdDir) await fs.promises.rm(createdDir, { recursive: true, force: true }).catch(() => {}); res.status(400).json({ error: e.message }); }
  finally { if (req.file) await fs.promises.rm(req.file.path, { force: true }).catch(() => {}); }
});
function propertyValues(s) {
  const advanced = Object.fromEntries(PROPERTY_SCHEMA.map(field => [field.key, field.default]));
  return { ...advanced, ...(s.properties || {}), 'server-name': s.name, 'server-port': s.port, 'server-portv6': Number(s.port) + 1, 'level-name': s.worldName, 'max-players': s.maxPlayers, 'gamemode': s.gameMode, 'difficulty': s.difficulty, 'level-seed': s.levelSeed, 'level-type': s.levelType, 'allow-cheats': s.allowCheats, 'allow-list': s.allowList === true, 'enable-lan-visibility': db.settings.gatewayEnabled ? false : ((s.properties || {})['enable-lan-visibility'] ?? true) };
}
function validateProperties(input = {}) {
  const output = {};
  for (const field of PROPERTY_SCHEMA) {
    let value = input[field.key] ?? field.default;
    if (field.type === 'boolean') value = value === true || value === 'true';
    else if (field.type === 'integer') { value = Number(value); if (!Number.isInteger(value)) throw new Error(`${field.label} must be a whole number`); }
    else if (field.type === 'number') { value = Number(value); if (!Number.isFinite(value)) throw new Error(`${field.label} must be a number`); }
    else value = String(value ?? '');
    if (field.options && !field.options.includes(value)) throw new Error(`${field.label} has an unsupported value`);
    if (field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}`);
    if (field.max !== undefined && value > field.max) throw new Error(`${field.label} must be no more than ${field.max}`);
    output[field.key] = value;
  }
  return output;
}
app.get('/api/servers/:id', auth, (req, res) => { const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' }); res.json({ ...serverJson(s), log: logs.get(s.id) || '' }); });
app.get('/api/servers/:id/export', manageServers, async (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' });
  if (processes.has(s.id)) return res.status(409).json({ error: 'Stop the server before exporting it' });
  const exportDir = path.join(DATA, 'exports'); fs.mkdirSync(exportDir, { recursive: true });
  const archive = path.join(exportDir, `${s.id}-${Date.now()}.zip`); const manifestFile = path.join(instanceDir(s.id), '.bedrock-beacon.json');
  try {
    const snapshot = serverJson(s); const portable = { ...s, properties: snapshot.properties }; for (const key of ['id','port','createdAt','lastError','eulaAccepted','eulaAcceptedAt']) delete portable[key];
    fs.writeFileSync(manifestFile, JSON.stringify({ format: 'bedrock-beacon-server', version: 1, exportedAt: new Date().toISOString(), server: portable }, null, 2));
    await runProcess('tar.exe', ['-a', '-cf', archive, '--exclude=bedrock_server.exe', '--exclude=*.dll', '--exclude=manager.log', '--exclude=eula.txt', '-C', instanceDir(s.id), '.']);
    res.download(archive, `${s.name.replace(/[^a-z0-9_-]+/gi, '-') || 'bedrock-server'}.bedrock-beacon.zip`, async () => { await fs.promises.rm(archive, { force: true }).catch(() => {}); });
  } catch (e) { await fs.promises.rm(archive, { force: true }).catch(() => {}); res.status(500).json({ error: `Could not export server: ${e.message}` }); }
  finally { await fs.promises.rm(manifestFile, { force: true }).catch(() => {}); }
});
app.put('/api/servers/:id', manageServers, (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' }); if (processes.has(s.id)) return res.status(409).json({ error: 'Stop the server before changing configuration' });
  const port = Number(req.body.port); const reserved = configuredPorts(s.id); if (!Number.isInteger(port) || port < 1024 || port > 65534 || reserved.has(port) || reserved.has(port + 1)) return res.status(400).json({ error: 'Choose an unused two-port range from 1024 to 65535' });
  const acceptedBefore = s.eulaAccepted === true; const eulaAccepted = acceptedBefore || req.body.eulaAccepted === true;
  const properties = validateProperties(req.body.properties || {}); properties['enable-lan-visibility'] = db.settings.gatewayEnabled ? false : properties['enable-lan-visibility'];
  Object.assign(s, { name: String(req.body.name || s.name).trim(), worldName: String(req.body.worldName || s.worldName).trim(), port, maxPlayers: Math.min(1000, Math.max(1, Number(req.body.maxPlayers) || 10)), gameMode: ['survival','creative','adventure'].includes(req.body.gameMode) ? req.body.gameMode : 'survival', difficulty: ['peaceful','easy','normal','hard'].includes(req.body.difficulty) ? req.body.difficulty : 'easy', levelSeed: String(req.body.levelSeed || ''), levelType: String(req.body.levelType || 'DEFAULT').toUpperCase(), allowCheats: Boolean(req.body.allowCheats), allowList: Boolean(req.body.allowList), properties, eulaAccepted, eulaAcceptedAt: eulaAccepted ? (acceptedBefore ? s.eulaAcceptedAt : new Date().toISOString()) : null, lastError: null });
  writeProperties(path.join(instanceDir(s.id), 'server.properties'), propertyValues(s)); fs.writeFileSync(path.join(instanceDir(s.id), 'eula.txt'), `# Recorded by Bedrock Beacon at ${s.eulaAcceptedAt || new Date().toISOString()}\r\neula=${s.eulaAccepted}\r\n`); save(); writeGatewayConfig(); res.json(serverJson(s));
});
async function startServer(s) {
  if (s.eulaAccepted !== true) throw new Error('Accept the Minecraft EULA in Server Configuration before starting this world.');
  if (processes.has(s.id)) return serverJson(s);
  await assertPortsAvailable(s);
  s.lastError = null; const dir = instanceDir(s.id); const child = spawn(path.join(dir, 'bedrock_server.exe'), [], { cwd: dir, windowsHide: true }); processes.set(s.id, child); logs.set(s.id, ''); players.set(s.id, new Set());
  child.stdout.on('data', d => appendLog(s.id, d)); child.stderr.on('data', d => appendLog(s.id, d));
  child.on('error', e => { s.lastError = e.message; processes.delete(s.id); save(); });
  child.on('exit', code => { processes.delete(s.id); players.delete(s.id); if (code && code !== 0) s.lastError = `Process exited with code ${code}`; save(); });
  save(); return serverJson(s);
}
function waitForStop(id, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (!processes.has(id)) { clearInterval(timer); resolve(); }
      else if (Date.now() - started >= timeoutMs) { clearInterval(timer); reject(new Error('Server did not stop within 12 seconds')); }
    }, 200);
  });
}
app.post('/api/servers/:id/start', auth, async (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' });
  try { res.json(await startServer(s)); } catch (e) { s.lastError = e.message; save(); res.status(500).json({ error: e.message }); }
});
app.post('/api/servers/:id/stop', auth, (req, res) => { const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' }); stopServer(s.id); res.json({ ok: true }); });
app.post('/api/servers/:id/reset', manageServers, async (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' });
  if (s.eulaAccepted !== true) return res.status(409).json({ error: 'Accept the Minecraft EULA in Server Configuration before resetting this world.' });
  try { if (processes.has(s.id)) { stopServer(s.id); await waitForStop(s.id); } res.json(await startServer(s)); } catch (e) { s.lastError = e.message; save(); res.status(500).json({ error: e.message }); }
});
app.delete('/api/servers/:id', manageServers, async (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' });
  if (processes.has(s.id)) return res.status(409).json({ error: 'Stop the server before deleting it' });
  try { await fs.promises.rm(instanceDir(s.id), { recursive: true, force: true }); db.servers = db.servers.filter(item => item.id !== s.id); logs.delete(s.id); players.delete(s.id); save(); writeGatewayConfig(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: `Could not delete server: ${e.message}` }); }
});
app.delete('/api/servers/:id/world', manageServers, async (req, res) => {
  const s = serverById(req.params.id); if (!s) return res.status(404).json({ error: 'Server not found' });
  if (processes.has(s.id)) return res.status(409).json({ error: 'Stop the server before deleting its world' });
  const worldsRoot = path.resolve(instanceDir(s.id), 'worlds'); const target = path.resolve(worldsRoot, s.worldName);
  if (path.dirname(target) !== worldsRoot) return res.status(400).json({ error: 'Invalid world directory' });
  if (String(req.body.worldName || '') !== s.worldName) return res.status(400).json({ error: 'World name confirmation does not match' });
  try { await fs.promises.rm(target, { recursive: true, force: true }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: `Could not delete world: ${e.message}` }); }
});
app.post('/api/servers/:id/command', manageServers, (req, res) => { const s = serverById(req.params.id); const child = s && processes.get(s.id); if (!child) return res.status(409).json({ error: 'Server is not running' }); child.stdin.write(String(req.body.command || '').replace(/[\r\n]/g, '') + '\n'); res.json({ ok: true }); });
app.use(express.static(path.join(ROOT, 'public')));
app.get('*splat', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
const port = Number(process.env.PORT || db.settings.portalPort || 3210);
migrateGatewayPorts();
app.listen(port, '127.0.0.1', async () => { console.log(`Bedrock Beacon is running at http://localhost:${port}`); if (db.settings.gatewayEnabled) startGateway().catch(error => { gatewayLog += `\n${error.message}`; }); });
process.on('SIGINT', () => { stopGateway(); for (const id of processes.keys()) stopServer(id); setTimeout(() => process.exit(), 500).unref(); });
