const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = 8080;
let Database = null;
let dbInstances = {};

try {
  Database = require("better-sqlite3");
  console.log("SQLite support enabled via better-sqlite3");
} catch(e) {
  console.log("better-sqlite3 not found. Install with: cd web_app && npm install better-sqlite3");
}

const DB_PATH = path.join(__dirname, "..", "extracted_assets");

function getDb(dbFile) {
  if (!Database) return null;
  if (!dbInstances[dbFile]) {
    const fullPath = path.join(DB_PATH, dbFile);
    if (!fs.existsSync(fullPath)) { console.error("DB not found:", fullPath); return null; }
    try { dbInstances[dbFile] = new Database(fullPath, { readonly: true }); }
    catch(e) { console.error("DB open error:", e.message); return null; }
  }
  return dbInstances[dbFile];
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".db": "application/octet-stream"
};

http.createServer((req, res) => {
  const p = url.parse(req.url).pathname;

  if (p === "/api/query") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { dbFile, sql, args = [] } = JSON.parse(body);
        const db = getDb(dbFile);
        if (!db) { res.writeHead(200); res.end(JSON.stringify([])); return; }
        const stmt = db.prepare(sql);
        const rows = sql.trim().toUpperCase().startsWith("SELECT") ? stmt.all(...args) : [stmt.run(...args)];
        res.writeHead(200);
        res.end(JSON.stringify(rows));
      } catch(e) {
        console.error("Query error:", e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  let fp = "." + decodeURIComponent(p).split("?")[0];
  if (fp === "./") fp = "./index.html";
  const ct = MIME[path.extname(fp).toLowerCase()] || "application/octet-stream";
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(err.code === "ENOENT" ? 404 : 500); res.end("Error"); }
    else { res.writeHead(200, { "Content-Type": ct, "Access-Control-Allow-Origin": "*" }); res.end(data); }
  });
}).listen(PORT, () => {
  console.log("Server: http://localhost:" + PORT + "/");
  console.log("DB API: http://localhost:" + PORT + "/api/query");
  console.log("WBW:    http://localhost:" + PORT + "/index.html#word-by-word");
});
