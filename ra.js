const QUESTIONS = {
  "ra-001": {
    id: "ra-001",
    title: "Global Warming",
    text: `Global warming is defined as an increase in the average temperature of the earth's atmosphere. This trend began in the middle of the 20th century and is one of the major environmental concerns of scientists and governmental officials worldwide. The changes in temperature result mostly from the effect of increased concentrations of greenhouse gasses in the atmosphere.`
  }
};

const DB_NAME = "pte_ra_db";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

function getQuestionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || "ra-001";
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN");
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("questionId", "questionId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addRecording(questionId, file) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.add({
      questionId,
      fileName: file.name,
      blob: file,
      createdAt: Date.now(),
      comments: []
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRecordings(questionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("questionId");
    const request = index.getAll(questionId);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function updateRecording(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
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

  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt);
  container.innerHTML = sorted
    .map((record) => {
      const audioUrl = URL.createObjectURL(record.blob);
      const commentsHtml = (record.comments || [])
        .map(
          (c, index) =>
            `<li>
              <div class="comment-row">
                <span><strong>${c.author}</strong>：${c.text}</span>
                <button
                  type="button"
                  class="btn secondary comment-delete-btn"
                  data-record-id="${record.id}"
                  data-comment-index="${index}"
                >
                  删除
                </button>
              </div>
              <span class="comment-time">${formatTime(c.createdAt)}</span>
            </li>`
        )
        .join("");

      return `
        <article class="record-card">
          <div class="record-head">
            <h3>${record.fileName}</h3>
            <span>${formatTime(record.createdAt)}</span>
          </div>
          <audio controls src="${audioUrl}"></audio>
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

      const currentRecords = await getRecordings(questionId);
      const target = currentRecords.find((item) => item.id === id);
      if (!target) return;

      target.comments = target.comments || [];
      target.comments.push({ author, text, createdAt: Date.now() });
      await updateRecording(target);
      await loadAndRender(questionId);
    });
  });

  container.querySelectorAll(".comment-delete-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const recordId = Number(button.dataset.recordId);
      const commentIndex = Number(button.dataset.commentIndex);
      if (Number.isNaN(recordId) || Number.isNaN(commentIndex)) return;

      const currentRecords = await getRecordings(questionId);
      const target = currentRecords.find((item) => item.id === recordId);
      if (!target || !Array.isArray(target.comments)) return;
      if (commentIndex < 0 || commentIndex >= target.comments.length) return;

      target.comments.splice(commentIndex, 1);
      await updateRecording(target);
      await loadAndRender(questionId);
    });
  });
}

async function loadAndRender(questionId) {
  const records = await getRecordings(questionId);
  renderRecordings(records, questionId);
}

async function initPage() {
  const questionId = getQuestionId();
  const question = QUESTIONS[questionId];
  if (!question) {
    document.querySelector(".card").innerHTML =
      '<p>题目不存在，请返回 <a href="ra.html">RA 列表</a>。</p>';
    return;
  }

  renderQuestion(question);
  await loadAndRender(questionId);

  const uploadForm = document.getElementById("upload-form");
  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fileInput = document.getElementById("audio-file");
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    await addRecording(questionId, file);
    fileInput.value = "";
    await loadAndRender(questionId);
  });
}

initPage();
