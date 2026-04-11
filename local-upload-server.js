const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config();

const app = express();
const port = Number(process.env.LOCAL_UPLOAD_PORT || 18787);
const rootUploadDir = path.join(__dirname, "local-uploads");
const syncStatePath = path.join(rootUploadDir, ".sync-state.json");
const commentsStatePath = path.join(rootUploadDir, ".comments-state.json");
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseBucket = process.env.SUPABASE_BUCKET || "ra-audios";
const syncEnabled = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = syncEnabled ? createClient(supabaseUrl, supabaseServiceKey) : null;
let bucketReady = false;

if (!fs.existsSync(rootUploadDir)) {
  fs.mkdirSync(rootUploadDir, { recursive: true });
}

app.use(cors());
app.use("/files", express.static(rootUploadDir));
app.use(express.json());

function sanitize(input) {
  return String(input || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function readSyncState() {
  if (!fs.existsSync(syncStatePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(syncStatePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function writeSyncState(state) {
  fs.writeFileSync(syncStatePath, JSON.stringify(state, null, 2), "utf8");
}

function readCommentsState() {
  if (!fs.existsSync(commentsStatePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(commentsStatePath, "utf8"));
  } catch (_error) {
    return {};
  }
}

function writeCommentsState(state) {
  fs.writeFileSync(commentsStatePath, JSON.stringify(state, null, 2), "utf8");
}

function relativePathFromAbsolute(filePath) {
  return path.relative(rootUploadDir, filePath).replaceAll("\\", "/");
}

function parseFileContext(filePath) {
  const relative = relativePathFromAbsolute(filePath);
  const parts = relative.split("/");
  if (parts.length < 3) return null;
  return {
    type: sanitize(parts[0]),
    questionId: sanitize(parts[1]),
    filename: parts.slice(2).join("/")
  };
}

async function syncFileToSupabase(filePath) {
  if (!syncEnabled || !supabase) return { skipped: true, reason: "sync_not_configured" };

  const context = parseFileContext(filePath);
  if (!context) return { skipped: true, reason: "invalid_path" };
  const { type, questionId } = context;
  const questionKey = `${type}:${questionId}`;
  const relativePath = relativePathFromAbsolute(filePath);
  const cloudPath = relativePath;
  const state = readSyncState();
  if (state[relativePath]?.synced) return { skipped: true, reason: "already_synced" };

  const fileBuffer = fs.readFileSync(filePath);
  const { error: uploadError } = await supabase.storage
    .from(supabaseBucket)
    .upload(cloudPath, fileBuffer, { upsert: true });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl }
  } = supabase.storage.from(supabaseBucket).getPublicUrl(cloudPath);

  const { data: existingRecord, error: existingError } = await supabase
    .from("ra_recordings")
    .select("id")
    .eq("file_path", cloudPath)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existingRecord?.id) {
    const { error: updateError } = await supabase
      .from("ra_recordings")
      .update({
        question_id: questionKey,
        file_name: path.basename(filePath),
        public_url: publicUrl
      })
      .eq("id", existingRecord.id);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase.from("ra_recordings").insert({
      question_id: questionKey,
      file_name: path.basename(filePath),
      file_path: cloudPath,
      public_url: publicUrl
    });
    if (insertError) throw insertError;
  }

  state[relativePath] = {
    synced: true,
    syncedAt: new Date().toISOString(),
    questionKey
  };
  writeSyncState(state);
  return { synced: true, relativePath };
}

async function ensureBucketExists() {
  if (!syncEnabled || !supabase) return;
  if (bucketReady) return;
  const { data: bucket, error: getError } = await supabase.storage.getBucket(supabaseBucket);
  if (!getError && bucket) {
    bucketReady = true;
    return;
  }
  const { error: createError } = await supabase.storage.createBucket(supabaseBucket, {
    public: true
  });
  if (createError && !String(createError.message || "").toLowerCase().includes("already exists")) {
    throw createError;
  }
  bucketReady = true;
}

async function scanAndSyncAll() {
  if (!syncEnabled) return;
  await ensureBucketExists();
  const candidates = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      if (entry.isFile() && !entry.name.startsWith(".")) candidates.push(full);
    }
  }
  walk(rootUploadDir);
  for (const filePath of candidates) {
    try {
      await syncFileToSupabase(filePath);
    } catch (error) {
      console.warn(`Sync failed for ${filePath}: ${error.message}`);
    }
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = sanitize(req.body.type);
    const questionId = sanitize(req.body.questionId);
    const targetDir = path.join(rootUploadDir, type, questionId);
    fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const type = sanitize(req.body.type);
    const questionId = sanitize(req.body.questionId);
    const targetDir = path.join(rootUploadDir, type, questionId);
    const originalName = path.basename(file.originalname || "upload.bin");
    const parsed = path.parse(originalName);

    let finalName = originalName;
    let index = 1;
    while (fs.existsSync(path.join(targetDir, finalName))) {
      finalName = `${parsed.name} (${index})${parsed.ext}`;
      index += 1;
    }
    cb(null, finalName);
  }
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded." });
  }
  const relativePath = relativePathFromAbsolute(req.file.path);
  let syncResult = { skipped: true, reason: "sync_not_configured" };
  try {
    syncResult = await syncFileToSupabase(req.file.path);
  } catch (error) {
    syncResult = { synced: false, error: error.message || "sync_failed" };
  }
  return res.json({
    ok: true,
    localPath: req.file.path,
    relativePath,
    fileUrl: `/files/${relativePath}`,
    syncResult
  });
});

app.get("/api/list", (req, res) => {
  const type = sanitize(req.query.type);
  const questionId = sanitize(req.query.questionId);
  const targetDir = path.join(rootUploadDir, type, questionId);
  if (!fs.existsSync(targetDir)) {
    return res.json({ ok: true, files: [] });
  }
  const files = fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absPath = path.join(targetDir, entry.name);
      const relativePath = relativePathFromAbsolute(absPath);
      const stats = fs.statSync(absPath);
      return {
        file_name: entry.name,
        local_only: true,
        public_url: `http://localhost:${port}/files/${relativePath}`,
        created_at: stats.mtime.toISOString(),
        file_path: relativePath,
        id: `local:${relativePath}`,
        comments: []
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return res.json({ ok: true, files });
});

app.delete("/api/file", async (req, res) => {
  const rawRelative = String(req.query.relativePath || "").replaceAll("\\", "/");
  if (!rawRelative) return res.status(400).json({ ok: false, error: "relativePath is required" });
  const absolutePath = path.resolve(rootUploadDir, rawRelative);
  const rootResolved = path.resolve(rootUploadDir);
  if (!absolutePath.startsWith(rootResolved)) {
    return res.status(400).json({ ok: false, error: "invalid path" });
  }
  if (!fs.existsSync(absolutePath)) return res.json({ ok: true, deleted: false, cloudDeleted: false });
  fs.unlinkSync(absolutePath);

  // Try removing empty parent folders up to rootUploadDir.
  let current = path.dirname(absolutePath);
  while (current.startsWith(rootResolved) && current !== rootResolved) {
    const entries = fs.readdirSync(current);
    if (entries.length > 0) break;
    fs.rmdirSync(current);
    current = path.dirname(current);
  }
  let cloudDeleted = false;
  const normalizedRelative = rawRelative.replaceAll("\\", "/");
  if (syncEnabled && supabase) {
    try {
      await ensureBucketExists();
      const { error: storageError } = await supabase.storage.from(supabaseBucket).remove([normalizedRelative]);
      if (storageError) {
        console.warn(`Cloud storage delete warning: ${storageError.message}`);
      }
      const { error: dbError } = await supabase.from("ra_recordings").delete().eq("file_path", normalizedRelative);
      if (dbError) {
        console.warn(`Cloud DB delete warning: ${dbError.message}`);
      } else {
        cloudDeleted = true;
      }
      const state = readSyncState();
      if (state[normalizedRelative]) {
        delete state[normalizedRelative];
        writeSyncState(state);
      }
    } catch (error) {
      console.warn(`Cloud delete failed for ${normalizedRelative}: ${error.message}`);
    }
  }
  const commentsState = readCommentsState();
  if (commentsState[normalizedRelative]) {
    delete commentsState[normalizedRelative];
    writeCommentsState(commentsState);
  }
  return res.json({ ok: true, deleted: true, cloudDeleted });
});

app.get("/api/comments", (req, res) => {
  const type = sanitize(req.query.type);
  const questionId = sanitize(req.query.questionId);
  if (!type || !questionId) {
    return res.status(400).json({ ok: false, error: "type and questionId are required" });
  }
  const prefix = `${type}/${questionId}/`;
  const state = readCommentsState();
  const scoped = {};
  for (const [filePath, comments] of Object.entries(state)) {
    if (!filePath.startsWith(prefix)) continue;
    scoped[filePath] = Array.isArray(comments) ? comments : [];
  }
  return res.json({ ok: true, comments: scoped });
});

app.post("/api/comments", (req, res) => {
  const relativePath = String(req.body?.relativePath || "").replaceAll("\\", "/");
  const author = String(req.body?.author || "").trim();
  const content = String(req.body?.content || "").trim();
  const ownerToken = String(req.body?.ownerToken || "").trim();
  if (!relativePath || !author || !content) {
    return res.status(400).json({ ok: false, error: "relativePath, author and content are required" });
  }
  const absolutePath = path.resolve(rootUploadDir, relativePath);
  const rootResolved = path.resolve(rootUploadDir);
  if (!absolutePath.startsWith(rootResolved)) {
    return res.status(400).json({ ok: false, error: "invalid path" });
  }
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ ok: false, error: "file not found" });
  }
  const state = readCommentsState();
  const list = Array.isArray(state[relativePath]) ? state[relativePath] : [];
  const comment = {
    id: Date.now(),
    author,
    content,
    created_at: new Date().toISOString(),
    owner_token: ownerToken || null
  };
  list.push(comment);
  state[relativePath] = list;
  writeCommentsState(state);
  return res.json({ ok: true, comment });
});

app.delete("/api/comments", (req, res) => {
  const relativePath = String(req.query.relativePath || "").replaceAll("\\", "/");
  const commentId = Number(req.query.commentId);
  const ownerToken = String(req.query.ownerToken || "").trim();
  if (!relativePath || Number.isNaN(commentId)) {
    return res.status(400).json({ ok: false, error: "relativePath and numeric commentId are required" });
  }
  const state = readCommentsState();
  const list = Array.isArray(state[relativePath]) ? state[relativePath] : [];
  const target = list.find((c) => Number(c.id) === commentId);
  if (!target) return res.json({ ok: true, deleted: false });
  if (target.owner_token && target.owner_token !== ownerToken) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  state[relativePath] = list.filter((c) => Number(c.id) !== commentId);
  writeCommentsState(state);
  return res.json({ ok: true, deleted: true });
});

app.delete("/api/cloud-file", async (req, res) => {
  if (!syncEnabled || !supabase) {
    return res.status(400).json({ ok: false, error: "cloud sync not configured" });
  }
  const rawRelative = String(req.query.relativePath || "").replaceAll("\\", "/");
  if (!rawRelative) return res.status(400).json({ ok: false, error: "relativePath is required" });

  try {
    await ensureBucketExists();
    const { error: storageError } = await supabase.storage.from(supabaseBucket).remove([rawRelative]);
    if (storageError) {
      console.warn(`Cloud storage delete warning: ${storageError.message}`);
    }

    const { error: dbError } = await supabase.from("ra_recordings").delete().eq("file_path", rawRelative);
    if (dbError) throw dbError;

    return res.json({ ok: true, deleted: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message || "cloud_delete_failed" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Local upload server running at http://localhost:${port}`);
  console.log(`Files are saved under: ${rootUploadDir}`);
  if (!syncEnabled) {
    console.log("Cloud sync disabled. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  } else {
    console.log(`Cloud sync enabled. Bucket: ${supabaseBucket}`);
    scanAndSyncAll().catch((error) => {
      console.warn(`Initial scan failed: ${error.message}`);
    });
    setInterval(() => {
      scanAndSyncAll().catch((error) => {
        console.warn(`Periodic scan failed: ${error.message}`);
      });
    }, 30000);
  }
});
