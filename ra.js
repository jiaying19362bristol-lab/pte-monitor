const QUESTIONS = {
  "ra-001": {
    id: "ra-001",
    title: "Global Warming",
    text: `Global warming is defined as an increase in the average temperature of the earth's atmosphere. This trend began in the middle of the 20th century and is one of the major environmental concerns of scientists and governmental officials worldwide. The changes in temperature result mostly from the effect of increased concentrations of greenhouse gasses in the atmosphere.`
  }
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

function getQuestionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || "ra-001";
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN");
}

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#bf1b1b" : "#54627a";
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeSafePathName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function addRecording(questionId, file) {
  const filePath = `${questionId}/${Date.now()}-${makeSafePathName(file.name)}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, {
      upsert: false
    });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl }
  } = supabase.storage.from(bucket).getPublicUrl(filePath);

  const { error: insertError } = await supabase.from("ra_recordings").insert({
    question_id: questionId,
    file_name: file.name,
    file_path: filePath,
    public_url: publicUrl
  });

  if (insertError) throw insertError;
}

async function getRecordings(questionId) {
  const { data: recordings, error: recordingError } = await supabase
    .from("ra_recordings")
    .select("id, file_name, public_url, created_at")
    .eq("question_id", questionId)
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

  const commentsByRecordingId = {};
  for (const comment of comments || []) {
    const key = comment.recording_id;
    if (!commentsByRecordingId[key]) commentsByRecordingId[key] = [];
    commentsByRecordingId[key].push(comment);
  }

  return recordings.map((record) => ({
    ...record,
    comments: commentsByRecordingId[record.id] || []
  }));
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

function renderQuestion(question) {
  document.getElementById("question-title").textContent = question.title;
  document.getElementById("question-text").textContent = question.text;
}

function renderRecordings(records, questionId) {
  const container = document.getElementById("recording-list");
  if (!records.length) {
    container.innerHTML = `<p class="empty-tip">还没有上传音频，先上传第一条吧。</p>`;
    return;
  }

  container.innerHTML = records
    .map((record) => {
      const commentsHtml = (record.comments || [])
        .map(
          (c) =>
            `<li>
              <div class="comment-row">
                <span><strong>${escapeHtml(c.author)}</strong>：${escapeHtml(c.content)}</span>
                <button
                  type="button"
                  class="btn secondary comment-delete-btn"
                  data-comment-id="${c.id}"
                >
                  删除
                </button>
              </div>
              <span class="comment-time">${formatTime(c.created_at)}</span>
            </li>`
        )
        .join("");

      return `
        <article class="record-card">
          <div class="record-head">
            <h3>${escapeHtml(record.file_name)}</h3>
            <span>${formatTime(record.created_at)}</span>
          </div>
          <audio controls src="${record.public_url}"></audio>
          <div class="comment-box">
            <h4>评论区</h4>
            <ul>${commentsHtml || "<li>暂无评论</li>"}</ul>
            <form class="comment-form" data-id="${record.id}">
              <input name="author" placeholder="评论人（如：老师）" required />
              <input name="text" placeholder="输入评论内容" required />
              <button class="btn" type="submit">发布评论</button>
            </form>
          </div>
        </article>
      `;
    })
    .join("");

  container.querySelectorAll(".comment-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const id = Number(form.dataset.id);
      const author = String(formData.get("author") || "").trim();
      const text = String(formData.get("text") || "").trim();
      if (!author || !text) return;
      await addComment(id, author, text);
      form.reset();
      await loadAndRender(questionId);
    });
  });

  container.querySelectorAll(".comment-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const commentId = Number(button.dataset.commentId);
      if (Number.isNaN(commentId)) return;
      await deleteComment(commentId);
      await loadAndRender(questionId);
    });
  });
}

async function loadAndRender(questionId) {
  try {
    const records = await getRecordings(questionId);
    renderRecordings(records, questionId);
  } catch (error) {
    setStatus("读取云端数据失败，请检查 Supabase 配置。", true);
    throw error;
  }
}

async function initPage() {
  const questionId = getQuestionId();
  const question = QUESTIONS[questionId];
  if (!question) {
    document.querySelector(".card").innerHTML =
      '<p>题目不存在，请返回 <a href="ra.html">RA 列表</a>。</p>';
    return;
  }

  if (!supabaseReady) {
    setStatus("请先在 supabase-config.js 填写 Supabase URL 和 anon key。", true);
    return;
  }

  setStatus("云端同步已启用：你和老师可看到同样的音频与评论。");
  renderQuestion(question);
  await loadAndRender(questionId);

  const uploadForm = document.getElementById("upload-form");
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fileInput = document.getElementById("audio-file");
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    try {
      setStatus("音频上传中，请稍候...");
      await addRecording(questionId, file);
      fileInput.value = "";
      setStatus("上传成功，已同步到云端。");
      await loadAndRender(questionId);
    } catch (error) {
      setStatus(`上传失败：${error.message || "未知错误"}`, true);
    }
  });
}

initPage();
