const TYPE_CONFIG = {
  RA: { section: "speaking", backHref: "speaking.html" },
  RS: { section: "speaking", backHref: "speaking.html" },
  DI: { section: "speaking", backHref: "speaking.html" },
  RL: { section: "speaking", backHref: "speaking.html" },
  SGD: { section: "speaking", backHref: "speaking.html" },
  RTS: { section: "speaking", backHref: "speaking.html" },
  SWT: { section: "writing", backHref: "writing.html" },
  WE: { section: "writing", backHref: "writing.html" },
  FIB_RW: { section: "reading", backHref: "reading.html" },
  FIB_R: { section: "reading", backHref: "reading.html" },
  SST: { section: "listening", backHref: "listening.html" },
  FIB_L: { section: "listening", backHref: "listening.html" },
  HIW: { section: "listening", backHref: "listening.html" },
  WFD: { section: "listening", backHref: "listening.html" }
};
window.__task_app_loaded = true;

const QUESTION_BANK = {
  RA: [
    {
      id: "ra-001",
      title: "Global Warming",
      text: "Global warming is defined as an increase in the average temperature of the earth's atmosphere. This trend began in the middle of the 20th century and is one of the major environmental concerns of scientists and governmental officials worldwide. The changes in temperature result mostly from the effect of increased concentrations of greenhouse gasses in the atmosphere."
    }
  ]
};

const statusEl = document.getElementById("sync-status");
const config = window.SUPABASE_CONFIG || {};
const supabaseReady =
  typeof window.supabase !== "undefined" &&
  typeof config.url === "string" &&
  config.url &&
  typeof config.anonKey === "string" &&
  config.anonKey;
const supabase = supabaseReady
  ? window.supabase.createClient(config.url, config.anonKey)
  : null;
const bucket = config.bucket || "ra-audios";
const ARCHIVE_KEY = "pte_task_local_archive_v1";
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const LOCAL_UPLOAD_ENDPOINT = "http://localhost:18787/api/upload";
const LOCAL_DELETE_ENDPOINT = "http://localhost:18787/api/file";
let isUploading = false;
let lastUploadSignature = "";
let lastUploadAt = 0;

function getParams() {
  const params = new URLSearchParams(window.location.search);
  const rawType = (params.get("type") || "").toUpperCase();
  const rawId = params.get("id") || "";
  const viewer = params.get("viewer") === "1" || params.get("role") === "viewer";
  return {
    type: rawType || "RA",
    id: rawId || "ra-001",
    viewer
  };
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN");
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#bf1b1b" : "#54627a";
}

function getQuestionsByType(type) {
  return QUESTION_BANK[type] || [
    {
      id: `${type.toLowerCase()}-001`,
      title: `${type} Sample Question`,
      text: `This is a sample ${type} question. You can replace it with your own question content later.`
    }
  ];
}

function renderListPage(type) {
  const typeConfig = TYPE_CONFIG[type];
  if (!typeConfig) return renderNotFound();
  const titleEl = document.getElementById("type-title");
  const backLinkEl = document.getElementById("back-link");
  const listEl = document.getElementById("question-list");
  if (!titleEl || !backLinkEl || !listEl) return;

  titleEl.textContent = `${type} 题目列表`;
  backLinkEl.href = typeConfig.backHref;

  listEl.innerHTML = getQuestionsByType(type)
    .map(
      (q) => `
      <a class="question-item" href="task-question.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(q.id)}">
        <h3>${escapeHtml(q.title)}</h3>
        <span>进入题目</span>
      </a>
    `
    )
    .join("");
}

function renderNotFound() {
  const card = document.querySelector(".card");
  if (!card) return;
  card.innerHTML = '<p>题型或题目不存在，请返回 <a href="index.html">首页</a>。</p>';
}

function readLocalArchive() {
  try {
    const text = localStorage.getItem(ARCHIVE_KEY);
    return text ? JSON.parse(text) : [];
  } catch (_error) {
    return [];
  }
}

function writeLocalArchive(items) {
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items));
}

function archiveRecordsLocally(records) {
  const existing = readLocalArchive();
  const existingIds = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  for (const record of records) {
    if (!existingIds.has(record.id)) {
      merged.push({ ...record, archived_at: new Date().toISOString() });
    }
  }
  writeLocalArchive(merged);
}

async function deleteRecordingFromCloud(record) {
  const { error: storageError } = await supabase.storage.from(bucket).remove([record.file_path]);
  if (storageError) console.warn("Storage remove warning:", storageError.message);
  const { error: dbError } = await supabase.from("ra_recordings").delete().eq("id", record.id);
  if (dbError) throw dbError;
}

async function addRecording(type, questionId, file) {
  const signature = `${type}|${questionId}|${file.name}|${file.size}|${file.lastModified}`;
  const now = Date.now();
  if (signature === lastUploadSignature && now - lastUploadAt < 4000) {
    throw new Error("检测到重复点击，已忽略重复上传。");
  }
  lastUploadSignature = signature;
  lastUploadAt = now;

  const uploadDirectToCloud = async () => {
    const baseName = String(file.name || "upload.bin").replaceAll("/", "_").replaceAll("\\", "_");
    const filePath = `${type}/${questionId}/${baseName}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, { upsert: true });
    if (uploadError) throw uploadError;
    const {
      data: { publicUrl }
    } = supabase.storage.from(bucket).getPublicUrl(filePath);
    const { data: existingRecord, error: existingError } = await supabase
      .from("ra_recordings")
      .select("id")
      .eq("file_path", filePath)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingRecord?.id) {
      const { error: updateError } = await supabase
        .from("ra_recordings")
        .update({
          question_id: `${type}:${questionId}`,
          file_name: baseName,
          public_url: publicUrl
        })
        .eq("id", existingRecord.id);
      if (updateError) throw updateError;
      return;
    }
    const { error: insertError } = await supabase.from("ra_recordings").insert({
      question_id: `${type}:${questionId}`,
      file_name: baseName,
      file_path: filePath,
      public_url: publicUrl
    });
    if (insertError) throw insertError;
  };

  // Prefer local-first; if local endpoint is unavailable in current environment, fall back to direct cloud upload.
  try {
    const localForm = new FormData();
    localForm.append("type", type);
    localForm.append("questionId", questionId);
    localForm.append("file", file);

    const response = await fetch(LOCAL_UPLOAD_ENDPOINT, { method: "POST", body: localForm });
    if (!response.ok) throw new Error("local_endpoint_error");
    const localResult = await response.json();
    if (!localResult?.ok) throw new Error("local_endpoint_error");
    if (localResult?.syncResult?.synced === false) throw new Error(localResult.syncResult.error || "cloud_sync_failed");
    return;
  } catch (_error) {
    await uploadDirectToCloud();
  }
}

async function deleteRecording(type, questionId, record) {
  if (record.local_only) {
    const response = await fetch(
      `${LOCAL_DELETE_ENDPOINT}?relativePath=${encodeURIComponent(record.file_path)}`,
      { method: "DELETE" }
    );
    if (!response.ok) throw new Error("本地删除失败");
    return;
  }

  await deleteRecordingFromCloud(record);

  // Best-effort local cleanup if mirrored file exists.
  try {
    await fetch(`${LOCAL_DELETE_ENDPOINT}?relativePath=${encodeURIComponent(record.file_path)}`, {
      method: "DELETE"
    });
  } catch (_error) {
    // ignore local cleanup failure
  }
}

async function getRecordings(type, questionId) {
  const key = `${type}:${questionId}`;
  const { data: recordings, error: recordingError } = await supabase
    .from("ra_recordings")
    .select("id, file_name, file_path, public_url, created_at")
    .eq("question_id", key)
    .order("created_at", { ascending: false });
  if (recordingError) throw recordingError;
  if (!recordings || !recordings.length) return [];
  const recordIds = recordings.map((record) => record.id);
  const { data: comments, error: commentError } = await supabase
    .from("ra_comments")
    .select("id, recording_id, author, content, created_at")
    .in("recording_id", recordIds)
    .order("created_at", { ascending: true });
  if (commentError) throw commentError;
  const grouped = {};
  for (const c of comments || []) {
    if (!grouped[c.recording_id]) grouped[c.recording_id] = [];
    grouped[c.recording_id].push(c);
  }
  return recordings.map((r) => ({ ...r, comments: grouped[r.id] || [] }));
}

async function getLocalRecordings(type, questionId) {
  try {
    const response = await fetch(
      `http://localhost:18787/api/list?type=${encodeURIComponent(type)}&questionId=${encodeURIComponent(questionId)}`
    );
    if (!response.ok) return [];
    const payload = await response.json();
    if (!payload?.ok || !Array.isArray(payload.files)) return [];
    return payload.files;
  } catch (_error) {
    return [];
  }
}

async function migrateLegacyQuestionIdIfNeeded(type, questionId) {
  // Legacy RA records were saved as "ra-001" before the unified key format "RA:ra-001".
  if (type !== "RA") return 0;
  const newKey = `${type}:${questionId}`;
  const legacyKey = questionId;
  if (legacyKey === newKey) return 0;

  const { data: legacyRows, error: legacyReadError } = await supabase
    .from("ra_recordings")
    .select("id")
    .eq("question_id", legacyKey);
  if (legacyReadError) throw legacyReadError;
  if (!legacyRows || !legacyRows.length) return 0;

  const { error: updateError } = await supabase
    .from("ra_recordings")
    .update({ question_id: newKey })
    .eq("question_id", legacyKey);
  if (updateError) throw updateError;

  return legacyRows.length;
}

async function addComment(recordingId, author, text) {
  const { error } = await supabase.from("ra_comments").insert({
    recording_id: recordingId,
    author,
    content: text
  });
  if (error) throw error;
}

async function deleteComment(commentId) {
  const { error } = await supabase.from("ra_comments").delete().eq("id", commentId);
  if (error) throw error;
}

async function runAutoArchive(type, questionId) {
  const records = await getRecordings(type, questionId);
  const now = Date.now();
  const toArchive = records.filter((record) => now - new Date(record.created_at).getTime() >= RETENTION_MS);
  if (!toArchive.length) return null;
  archiveRecordsLocally(toArchive);
  for (const record of toArchive) {
    await deleteRecordingFromCloud(record);
  }
  return { archivedCount: toArchive.length, totalArchived: readLocalArchive().length };
}

function renderRecordings(records, type, questionId, isViewer) {
  const container = document.getElementById("recording-list");
  if (!container) return;
  if (!records.length) {
    container.innerHTML = '<p class="empty-tip">还没有上传音频，先上传第一条吧。</p>';
    return;
  }
  container.innerHTML = records
    .map(
      (record) => `
      <article class="record-card">
        <div class="record-head">
          <h3>${escapeHtml(record.file_name)}</h3>
          <div class="record-actions">
            <span>${formatTime(record.created_at)}</span>
            ${
              !isViewer
                ? `<button
              type="button"
              class="btn secondary record-delete-btn"
              data-file-path="${escapeHtml(record.file_path)}"
            >
              删除音频
            </button>`
                : ""
            }
          </div>
        </div>
        <audio controls src="${record.public_url}"></audio>
        <div class="comment-box">
          <h4>评论区</h4>
          ${record.local_only ? "<p class='empty-tip'>本地文件（待云同步）暂不支持评论。</p>" : ""}
          <ul>
            ${
              record.comments.length
                ? record.comments
                    .map(
                      (c) => `
                <li>
                  <div class="comment-row">
                    <span><strong>${escapeHtml(c.author)}</strong>：${escapeHtml(c.content)}</span>
                    ${
                      isViewer
                        ? ""
                        : `<button type="button" class="btn secondary comment-delete-btn" data-comment-id="${c.id}">
                      删除
                    </button>`
                    }
                  </div>
                  <span class="comment-time">${formatTime(c.created_at)}</span>
                </li>
              `
                    )
                    .join("")
                : "<li>暂无评论</li>"
            }
          </ul>
          ${
            record.local_only
              ? ""
              : `<form class="comment-form" data-id="${record.id}">
            <input name="author" placeholder="评论人（如：老师）" required />
            <input name="text" placeholder="输入评论内容" required />
            <button class="btn" type="submit">发布评论</button>
          </form>`
          }
        </div>
      </article>
    `
    )
    .join("");

  container.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const id = form.dataset.id;
      const author = String(formData.get("author") || "").trim();
      const text = String(formData.get("text") || "").trim();
      if (!author || !text || !id) return;
      await addComment(id, author, text);
      form.reset();
      await loadAndRenderQuestion(type, questionId, isViewer);
    });
  });

  if (!isViewer) {
    container.querySelectorAll(".comment-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const commentId = Number(button.dataset.commentId);
        if (Number.isNaN(commentId)) return;
        await deleteComment(commentId);
        await loadAndRenderQuestion(type, questionId, isViewer);
      });
    });
  }

  if (!isViewer) {
    container.querySelectorAll(".record-delete-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        const filePath = button.dataset.filePath;
        const record = records.find((item) => item.file_path === filePath);
        if (!record) return;
        await deleteRecording(type, questionId, record);
        await loadAndRenderQuestion(type, questionId, isViewer);
      });
    });
  }
}

async function loadAndRenderQuestion(type, questionId, isViewer) {
  const [cloudRecords, localRecords] = await Promise.all([
    getRecordings(type, questionId).catch(() => []),
    isViewer ? Promise.resolve([]) : getLocalRecordings(type, questionId)
  ]);

  const byPath = new Map();
  for (const record of cloudRecords) {
    byPath.set(record.file_path, record);
  }
  for (const localItem of localRecords) {
    if (!byPath.has(localItem.file_path)) byPath.set(localItem.file_path, localItem);
  }
  const merged = Array.from(byPath.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  renderRecordings(merged, type, questionId, isViewer);
}

async function renderQuestionPage(type, questionId, isViewer) {
  const typeConfig = TYPE_CONFIG[type];
  if (!typeConfig) return renderNotFound();
  const question = getQuestionsByType(type).find((q) => q.id === questionId);
  if (!question) return renderNotFound();
  const titleEl = document.getElementById("question-title");
  const textEl = document.getElementById("question-text");
  const backLinkEl = document.getElementById("back-list-link");
  const shareLinkEl = document.getElementById("viewer-share-link");
  if (!titleEl || !textEl || !backLinkEl) return;
  titleEl.textContent = `${type} | ${question.title}`;
  textEl.textContent = question.text;
  backLinkEl.href = `task-list.html?type=${encodeURIComponent(type)}`;
  if (shareLinkEl) {
    const shareUrl = `${window.location.origin}${window.location.pathname}?type=${encodeURIComponent(type)}&id=${encodeURIComponent(
      questionId
    )}&viewer=1`;
    shareLinkEl.href = shareUrl;
    shareLinkEl.textContent = shareUrl;
  }

  if (isViewer) {
    const uploadForm = document.getElementById("upload-form");
    if (uploadForm) uploadForm.style.display = "none";
    setStatus("访客模式：仅查看音频并评论。");
  }

  if (!supabaseReady) {
    setStatus("请先在 supabase-config.js 填写 Supabase URL 和 anon key。", true);
    return;
  }

  setStatus("云端同步已启用（保留3天，超时自动归档到本地并清理云端）。");
  try {
    const movedCount = await migrateLegacyQuestionIdIfNeeded(type, questionId);
    if (movedCount > 0) {
      setStatus(`已迁移旧数据 ${movedCount} 条到新题型结构。`);
    }
  } catch (error) {
    setStatus(`旧数据迁移失败：${error.message || "未知错误"}`, true);
  }

  const archiveResult = await runAutoArchive(type, questionId);
  if (archiveResult && archiveResult.archivedCount > 0) {
    setStatus(`已自动归档 ${archiveResult.archivedCount} 条到本地，本地共 ${archiveResult.totalArchived} 条。`);
  }
  await loadAndRenderQuestion(type, questionId, isViewer);

  const uploadForm = document.getElementById("upload-form");
  if (isViewer || !uploadForm) return;
  const uploadBtn = uploadForm.querySelector('button[type="submit"]');
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isUploading) return;
    const fileInput = document.getElementById("audio-file");
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      isUploading = true;
      if (uploadBtn) uploadBtn.disabled = true;
      setStatus("音频上传中，请稍候...");
      await addRecording(type, questionId, file);
      fileInput.value = "";
      setStatus("上传成功，已同步到云端。");
      await loadAndRenderQuestion(type, questionId, isViewer);
    } catch (error) {
      setStatus(`上传失败：${error.message || "未知错误"}`, true);
    } finally {
      isUploading = false;
      if (uploadBtn) uploadBtn.disabled = false;
    }
  });
}

function init() {
  const path = window.location.pathname;
  const { type, id, viewer } = getParams();
  if (path.endsWith("task-list.html")) {
    renderListPage(type);
    return;
  }
  if (path.endsWith("task-question.html")) {
    renderQuestionPage(type, id, viewer);
  }
}

init();
