"use strict";

const allQuestions = window.QUESTION_BANK.map((question, index) => ({ ...question, number: index + 1 }));
const studyGuide = window.STUDY_GUIDE;
const params = new URLSearchParams(location.search);
const selectedGroup = studyGuide.groups.find((group) => group.id === params.get("group"));
const selectedTopic = studyGuide.topics.find((topic) => topic.id === params.get("topic"));
const selectedDay = studyGuide.plan.find((day) => day.day === Number(params.get("day")) && day.group_ids.length);
const collectionMode = ["mistakes", "favorites"].includes(params.get("collection")) ? params.get("collection") : null;
const examMode = !collectionMode && !selectedGroup && !selectedTopic && !selectedDay && (params.get("exam") === "1" || params.get("mixed") === "1");
const practiceKey = collectionMode || (selectedGroup ? `group-${selectedGroup.id}` : selectedTopic ? `topic-${selectedTopic.id}` : selectedDay ? `day-${selectedDay.day}` : examMode ? "exam" : "all");
const storageKey = examMode ? "radio-a-exam-v1" : `radio-a-practice-v1-${practiceKey}`;
const settingsKey = "radio-a-practice-settings-v1";
const collectionsKey = "radio-a-collections-v1";
let storageAvailable = true;
function readSaved(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
let saved = readSaved(storageKey);
const savedCollections = readSaved(collectionsKey);
const validIds = new Set(allQuestions.map((question) => question.id));
const collections = Object.fromEntries(["mistakes", "favorites"].map((name) => [name, new Set(Array.isArray(savedCollections?.[name]) ? savedCollections[name].filter((id) => validIds.has(id)) : [])]));
// 首次启用错题本时，将已有练习中保存的错题补入；之后手动移出的题目不再重复导入。
if (!savedCollections) {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key.startsWith("radio-a-practice-v1-") || key.endsWith("-mistakes") || key.endsWith("-favorites")) continue;
      const record = readSaved(key);
      Object.entries(record?.states || {}).forEach(([id, state]) => {
        const question = allQuestions.find((item) => item.id === id);
        if (question && state?.checked && Array.isArray(state.selected) && state.selected.length && !isCorrect(question, state.selected)) collections.mistakes.add(id);
      });
    }
  } catch { storageAvailable = false; }
}
let autoNext = readSaved(settingsKey)?.autoNext !== false;
let autoNextTimer;
let questions = allQuestions;
let practiceTitle = "";
let practiceReturn = "study.html";
if (collectionMode) {
  questions = allQuestions.filter((question) => collections[collectionMode].has(question.id));
  practiceTitle = collectionMode === "mistakes" ? "答错自动收录，答对后仍保留；可手动移出错题本。" : "点击题目右上角的星标，随时收藏或取消收藏。";
  practiceReturn = "index.html";
} else if (selectedGroup) {
  const numbers = new Set(selectedGroup.question_numbers);
  questions = allQuestions.filter((question) => numbers.has(question.number));
  practiceTitle = `${selectedGroup.title} · ${questions.length} 道同组变式`;
  practiceReturn = `study.html?topic=${selectedGroup.topic_id}#group-${selectedGroup.id}`;
} else if (selectedTopic || selectedDay) {
  const groupIds = selectedTopic ? selectedTopic.group_ids : selectedDay.group_ids;
  const numbers = new Set(studyGuide.groups.filter((group) => groupIds.includes(group.id)).flatMap((group) => group.question_numbers));
  questions = allQuestions.filter((question) => numbers.has(question.number));
  practiceTitle = selectedTopic ? `${selectedTopic.title} · ${questions.length} 题` : `第 ${selectedDay.day} 天：${selectedDay.title} · ${questions.length} 题`;
  practiceReturn = selectedTopic ? `study.html?topic=${selectedTopic.id}` : "study.html#review-plan";
} else if (examMode) {
  questions = createExamQuestions();
  const savedQuestions = Array.isArray(saved?.questionNumbers) ? saved.questionNumbers.map((number) => allQuestions.find((question) => question.number === number)) : [];
  if (savedQuestions.length === 40 && savedQuestions.every(Boolean) && new Set(savedQuestions).size === 40 && savedQuestions.filter((question) => question.answers.length === 1).length === 32) {
    questions = savedQuestions;
  } else saved = null;
  practiceTitle = "32 单选＋8 多选 · 40 分钟 · 答对 30 题合格。交卷后统一判分，未答、漏选、多选均不得分。";
}
let exam = examMode && Number.isFinite(saved?.exam?.deadline) ? saved.exam : { deadline: null, submittedAt: null, timedOut: false };
const states = questions.map((question) => {
  const state = saved?.states?.[question.id];
  const selected = Array.isArray(state?.selected) ? [...new Set(state.selected.filter((key) => Object.hasOwn(question.options, key)))].slice(0, question.answers.length === 1 ? 1 : undefined) : [];
  const keys = Object.keys(question.options);
  const order = state?.optionOrder;
  const optionOrder = !examMode ? null : Array.isArray(order) && order.length === keys.length && new Set(order).size === keys.length && order.every((key) => keys.includes(key)) ? order : shuffle(keys);
  return { selected, checked: examMode ? Boolean(exam.submittedAt) : state?.checked === true && selected.length > 0, ...(examMode ? { optionOrder } : {}) };
});
let currentIndex = Math.max(0, questions.findIndex((question) => question.number === Number(params.get("question") || saved?.currentQuestion)));
const $ = (id) => document.getElementById(id);
const navButtons = [];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function createExamQuestions() {
  return shuffle([
    ...shuffle(allQuestions.filter((question) => question.answers.length === 1)).slice(0, 32),
    ...shuffle(allQuestions.filter((question) => question.answers.length > 1)).slice(0, 8),
  ]);
}

function updateExamClock() {
  const remaining = exam.deadline ? Math.max(0, exam.deadline - (exam.submittedAt || Date.now())) : 40 * 60 * 1000;
  const seconds = Math.ceil(remaining / 1000);
  $("exam-timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("exam-timer").classList.toggle("time-warning", seconds <= 300);
  if (exam.deadline && !exam.submittedAt && !remaining) finishExam(true);
}

function renderExam() {
  const submitted = Boolean(exam.submittedAt);
  $("exam-panel").hidden = !examMode;
  if (!examMode) return;
  document.body.classList.add("exam-mode");
  document.body.classList.toggle("exam-taking", !submitted);
  $("practice-context").hidden = Boolean(exam.deadline);
  document.querySelector(".exam-clock > span").textContent = submitted ? "交卷时剩余" : "剩余时间";
  document.querySelector(".keyboard-hint").textContent = submitted ? "← → 切题 · 查看作答结果" : "← → 切题 · 交卷前可修改答案";
  $("start-exam").hidden = Boolean(exam.deadline);
  $("submit-exam").hidden = !exam.deadline || submitted;
  $("new-exam").hidden = !submitted;
  $("exam-status").textContent = submitted ? (exam.timedOut ? "时间到，已自动交卷" : "已交卷 · 可切题查看答案") : exam.deadline ? "考试进行中 · 答案可随时修改" : "准备好后开始，计时期间可切换题目";
  $("exam-result").hidden = !submitted;
  $("jump-input").disabled = !exam.deadline;
  $("jump-form").querySelector("button").disabled = !exam.deadline;
  if (submitted) {
    const correct = questions.filter((question, index) => isCorrect(question, states[index].selected)).length;
    const unanswered = states.filter((state) => !state.selected.length).length;
    $("exam-result").textContent = `成绩：${correct} / 40 · ${correct >= 30 ? "合格" : "未合格"} · 错题 ${40 - correct} 题（含未答 ${unanswered} 题）`;
    $("exam-result").classList.toggle("incorrect", correct < 30);
  }
}

function finishExam(timedOut = false) {
  if (!examMode || !exam.deadline || exam.submittedAt) return;
  exam.timedOut = timedOut || Date.now() >= exam.deadline;
  exam.submittedAt = Math.min(Date.now(), exam.deadline);
  states.forEach((state, index) => {
    state.checked = true;
    if (!isCorrect(questions[index], state.selected)) collections.mistakes.add(questions[index].id);
  });
  if ($("practice-navigation").open) $("practice-navigation").close();
  saveCollections();
  saveProgress();
  renderQuestion();
  updateExamClock();
  $("exam-result").focus();
}

function writeSaved(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  $("save-status").textContent = storageAvailable ? "作答、当前位置、错题与收藏已自动保存在当前浏览器。" : "当前浏览器无法保存记录，刷新后可能丢失本次作答、错题或收藏。";
}

function saveProgress() {
  writeSaved(storageKey, {
    questionNumbers: questions.map((question) => question.number),
    currentQuestion: questions[currentIndex]?.number || null,
    states: Object.fromEntries(questions.map((question, index) => [question.id, states[index]])),
    ...(examMode ? { exam } : {}),
  });
}

function saveCollections() {
  writeSaved(collectionsKey, Object.fromEntries(Object.entries(collections).map(([name, ids]) => [name, [...ids]])));
  renderCollectionControls();
}

function renderCollectionControls() {
  $("mistakes-count").textContent = collections.mistakes.size;
  $("favorites-count").textContent = collections.favorites.size;
  document.querySelectorAll("[data-collection]").forEach((link) => {
    if (link.dataset.collection === (collectionMode || (examMode ? "exam" : "all"))) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  const question = questions[currentIndex];
  const favorite = !!question && collections.favorites.has(question.id);
  $("toggle-favorite").setAttribute("aria-pressed", String(favorite));
  $("toggle-favorite").setAttribute("aria-label", favorite ? "取消收藏本题" : "收藏本题");
  $("favorite-icon").textContent = favorite ? "★" : "☆";
  $("favorite-label").textContent = favorite ? "已收藏" : "收藏";
  $("remove-mistake").hidden = !question || !collections.mistakes.has(question.id) || (examMode && !exam.submittedAt);
}

function removeFromCollection(name) {
  collections[name].delete(questions[currentIndex].id);
  saveCollections();
  if (collectionMode !== name) return;
  clearTimeout(autoNextTimer);
  questions.splice(currentIndex, 1);
  states.splice(currentIndex, 1);
  currentIndex = Math.min(currentIndex, Math.max(0, questions.length - 1));
  buildNavigation();
  if (questions.length) goToQuestion(currentIndex);
  else {
    const url = new URL(location.href);
    url.searchParams.delete("question");
    history.replaceState(null, "", url);
    saveProgress();
    renderQuestion();
    $("empty-collection").focus({ preventScroll: true });
  }
}

function isCorrect(question, selected) {
  return selected.length === question.answers.length && question.answers.every((answer) => selected.includes(answer));
}

function renderProgress() {
  let correct = 0;
  let incorrect = 0;
  states.forEach((state, index) => {
    if (!state.checked) return;
    if (isCorrect(questions[index], state.selected)) correct++;
    else incorrect++;
  });
  const takingExam = examMode && !exam.submittedAt;
  const answered = takingExam ? states.filter((state) => state.selected.length).length : correct + incorrect;
  document.querySelector(".stats").hidden = takingExam;
  document.querySelector(".progress-caption > span").firstChild.textContent = takingExam ? "已作答 " : "已检查 ";
  $("answered-count").textContent = answered;
  $("correct-count").textContent = correct;
  $("incorrect-count").textContent = incorrect;
  $("remaining-count").textContent = questions.length - answered;
  $("progress").value = answered;
  $("progress-percent").textContent = `${questions.length ? Math.round(answered / questions.length * 100) : 0}%`;
}

function renderNavigation() {
  navButtons.forEach((button, index) => {
    const state = states[index];
    const status = state.checked ? (isCorrect(questions[index], state.selected) ? "答对" : "答错") : "未检查";
    button.classList.toggle("answered-correct", status === "答对");
    button.classList.toggle("answered-incorrect", status === "答错");
    const takingExam = examMode && !exam.submittedAt;
    button.classList.toggle("answered-pending", takingExam && state.selected.length > 0);
    button.disabled = examMode && !exam.deadline;
    button.setAttribute("aria-current", String(index === currentIndex));
    button.setAttribute("aria-label", `第 ${examMode ? index + 1 : questions[index].number} 题，${takingExam ? (state.selected.length ? "已作答" : "未作答") : status}`);
  });
}

function renderQuestion() {
  renderExam();
  const empty = !questions.length;
  const ready = !examMode || Boolean(exam.deadline);
  $("question-card").hidden = empty || !ready;
  $("page-navigation").hidden = empty || !ready;
  $("practice-settings").hidden = empty || !ready;
  $("empty-collection").hidden = !empty;
  renderCollectionControls();
  if (empty) {
    $("empty-title").textContent = collectionMode === "mistakes" ? "还没有错题，继续保持！" : "还没有收藏的题目";
    $("empty-description").textContent = collectionMode === "mistakes" ? "答错的题目会自动收录在这里，方便集中复习。" : "做题时点击星标，即可把想复习的题目收藏到这里。";
    renderProgress();
    return;
  }
  if (!ready) {
    renderProgress();
    renderNavigation();
    return;
  }
  const question = questions[currentIndex];
  const state = states[currentIndex];
  const multiple = question.answers.length > 1;
  $("question-number").textContent = `第 ${String(examMode ? currentIndex + 1 : question.number).padStart(3, "0")} 题`;
  $("question-type").textContent = multiple ? "多选题" : "单选题";
  $("chapter-label").textContent = `知识点 ${question.chapter}`;
  $("question-title").textContent = question.question;
  $("selection-hint").textContent = examMode && !exam.submittedAt ? (multiple ? "请选择所有正确选项，可修改答案，交卷后统一判分。" : "请选择一个正确选项，可修改答案，交卷后统一判分。") : multiple ? "请选择所有正确选项，按回车或点击「提交答案」。" : "请选择一个正确选项，点击后自动提交。";
  if (examMode && exam.submittedAt) $("selection-hint").textContent = "试卷已交卷，下面显示你的作答与正确选项。";
  $("source-id").textContent = `${examMode ? `题库第 ${question.number} 题 · ` : ""}原题号 ${question.legacy_ids.join(" / ")} · ${question.id}`;
  $("source-pages").textContent = `来源 PDF 第 ${question.source_pages.join("、")} 页`;
  $("image-notice").hidden = !question.image_files.length;
  $("image-notice").textContent = question.image_files.length ? `本题原 PDF 仅列出配图文件名（${question.image_files.join("、")}），未提供实际图片。` : "";

  const options = $("options");
  options.replaceChildren();
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = multiple ? "选择所有正确答案" : "选择一个正确答案";
  options.append(legend);
  const optionEntries = examMode ? state.optionOrder.map((key) => [key, question.options[key]]) : Object.entries(question.options);
  optionEntries.forEach(([key, text], index) => {
    const label = document.createElement("label");
    label.className = "option";
    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.textContent = examMode ? String.fromCharCode(65 + index) : key;
    const content = document.createElement("span");
    content.className = "option-text";
    content.textContent = text;
    const input = document.createElement("input");
    input.type = multiple ? "checkbox" : "radio";
    input.name = "answer";
    input.value = key;
    input.checked = state.selected.includes(key);
    input.disabled = state.checked;
    input.addEventListener("change", () => {
      if (examMode) {
        if (exam.submittedAt || Date.now() >= exam.deadline) { finishExam(true); return; }
        state.selected = [...options.querySelectorAll("input:checked")].map((item) => item.value);
        saveProgress();
        renderProgress();
        renderNavigation();
        return;
      }
      state.selected = [...options.querySelectorAll("input:checked")].map((item) => item.value);
      $("check-answer").disabled = !state.selected.length;
      $("action-hint").textContent = state.selected.length ? `已选 ${state.selected.join("、")}` : "选择选项后提交答案";
      if (multiple) saveProgress();
      else submitAnswer();
    });
    label.append(letter, content);
    if (state.checked) {
      const correct = question.answers.includes(key);
      const wrong = input.checked && !correct;
      label.classList.toggle("is-correct", correct);
      label.classList.toggle("is-wrong", wrong);
      if (correct || wrong) {
        const mark = document.createElement("span");
        mark.className = "option-mark";
        mark.textContent = correct ? "正确选项" : "误选";
        label.append(mark);
      }
    }
    label.append(input);
    options.append(label);
  });

  const feedback = $("feedback");
  feedback.replaceChildren();
  feedback.hidden = !state.checked;
  if (state.checked) {
    const correct = isCorrect(question, state.selected);
    feedback.classList.toggle("incorrect", !correct);
    const title = document.createElement("strong");
    title.textContent = correct ? "✓ 回答正确" : "✕ 回答错误";
    const detail = document.createElement("span");
    const answerLetters = (keys) => examMode ? state.optionOrder.flatMap((key, index) => keys.includes(key) ? [String.fromCharCode(65 + index)] : []).join("、") : keys.join("、");
    detail.textContent = `你的答案：${answerLetters(state.selected) || "未作答"}。正确答案：${answerLetters(question.answers)}。`;
    feedback.append(title, detail);
  }
  $("check-answer").disabled = state.checked || !state.selected.length;
  $("check-answer").firstChild.textContent = state.checked ? "已提交 " : "提交答案 ";
  $("retry-answer").hidden = examMode || !state.checked;
  document.querySelector(".answer-actions").hidden = examMode;
  document.querySelector(".question-result").hidden = examMode && !exam.submittedAt;
  $("action-hint").textContent = state.checked ? "可重新作答，或继续下一题" : state.selected.length ? `已选 ${state.selected.join("、")}` : "选择选项后提交答案";
  $("previous-question").disabled = currentIndex === 0;
  $("next-question").disabled = currentIndex === questions.length - 1;
  $("page-position").textContent = `${currentIndex + 1} / ${questions.length}`;
  renderProgress();
  renderNavigation();
}

function goToQuestion(index) {
  if (examMode) {
    updateExamClock();
    if (!exam.deadline) return;
  }
  if (index < 0 || index >= questions.length) return;
  clearTimeout(autoNextTimer);
  currentIndex = index;
  const url = new URL(location.href);
  url.searchParams.set("question", questions[index].number);
  history.replaceState(null, "", url);
  saveProgress();
  renderQuestion();
  if ($("practice-navigation").open) $("practice-navigation").close();
  $("question-title").focus({ preventScroll: true });
  const nav = $("question-nav");
  const button = navButtons[index];
  const offset = button.getBoundingClientRect().top - nav.getBoundingClientRect().top;
  if (offset < 0) nav.scrollTop += offset;
  else if (offset + button.offsetHeight > nav.clientHeight) nav.scrollTop += offset + button.offsetHeight - nav.clientHeight;
  if (window.matchMedia("(max-width: 760px)").matches) $("question-card").scrollIntoView({ block: "start" });
}

function submitAnswer() {
  if (examMode) return;
  const state = states[currentIndex];
  if (!state.selected.length || state.checked) return;
  state.checked = true;
  if (!isCorrect(questions[currentIndex], state.selected)) {
    collections.mistakes.add(questions[currentIndex].id);
    saveCollections();
  }
  saveProgress();
  renderQuestion();
  if (autoNext && currentIndex < questions.length - 1) {
    $("action-hint").textContent = "已提交，即将进入下一题";
    autoNextTimer = setTimeout(() => goToQuestion(currentIndex + 1), 900);
  }
}

function buildNavigation() {
  navButtons.length = 0;
  $("question-nav").replaceChildren();
  questions.forEach((question, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = examMode ? index + 1 : question.number;
    button.dataset.questionNumber = question.number;
    button.addEventListener("click", () => goToQuestion(index));
    navButtons.push(button);
    $("question-nav").append(button);
  });
  document.querySelectorAll("[data-total]").forEach((element) => { element.textContent = questions.length; });
  $("progress").max = questions.length || 1;
}
buildNavigation();
$("jump-input").max = examMode ? 40 : allQuestions.length;
$("jump-input").addEventListener("input", () => $("jump-input").setCustomValidity(""));
if (practiceTitle) {
  $("practice-mode").textContent = collectionMode ? (collectionMode === "mistakes" ? "错题本" : "我的收藏") : examMode ? "模拟考试" : "专题练习";
  $("practice-context").hidden = false;
  const back = document.createElement("a");
  back.href = practiceReturn;
  back.textContent = collectionMode ? "← 返回全部题库" : "← 返回分类速记";
  $("practice-context").append(back, document.createTextNode(practiceTitle));
}
$("jump-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const number = Number($("jump-input").value);
  const index = examMode ? number - 1 : questions.findIndex((question) => question.number === number);
  if (index !== -1) {
    goToQuestion(index);
    $("jump-input").value = "";
  } else {
    $("jump-input").setCustomValidity("当前练习不包含该原题号，可按左侧题目导航选择，或返回全部题库。");
    $("jump-input").reportValidity();
  }
});
$("auto-next").checked = autoNext;
$("auto-next").addEventListener("change", () => {
  autoNext = $("auto-next").checked;
  clearTimeout(autoNextTimer);
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ autoNext }));
  } catch {
    $("save-status").textContent = "当前浏览器无法保存设置，刷新后将恢复默认设置。";
  }
  renderQuestion();
});
document.addEventListener("keydown", (event) => {
  if ($("practice-navigation").open) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
  const target = event.target;
  if (target.closest('textarea, select, [contenteditable]:not([contenteditable="false"])') || (target.matches("input") && !target.matches('[name="answer"]'))) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    if (!event.repeat) goToQuestion(currentIndex + (event.key === "ArrowLeft" ? -1 : 1));
  } else if (event.key === "Enter" && questions[currentIndex]?.answers.length > 1 && !target.closest("button, a, summary")) {
    event.preventDefault();
    if (!event.repeat) submitAnswer();
  }
});
$("check-answer").addEventListener("click", submitAnswer);
$("retry-answer").addEventListener("click", () => {
  clearTimeout(autoNextTimer);
  states[currentIndex] = { selected: [], checked: false };
  saveProgress();
  renderQuestion();
});
$("previous-question").addEventListener("click", () => goToQuestion(currentIndex - 1));
$("next-question").addEventListener("click", () => goToQuestion(currentIndex + 1));
$("toggle-favorite").addEventListener("click", () => {
  const id = questions[currentIndex].id;
  if (collections.favorites.has(id)) removeFromCollection("favorites");
  else {
    collections.favorites.add(id);
    saveCollections();
  }
});
$("remove-mistake").addEventListener("click", () => removeFromCollection("mistakes"));
if (examMode) {
  document.title = "A 类题库 · 模拟考试";
  document.querySelector(".total-label").textContent = "40 道题 · 40 分钟";
  document.querySelector('.header-nav [aria-current="page"]').removeAttribute("aria-current");
  $("auto-next").closest("label").hidden = true;
  $("jump-input").placeholder = "输入试卷题号";
  document.querySelector('label[for="jump-input"]').textContent = "跳转到试卷题号";
  $("start-exam").addEventListener("click", () => {
    exam.deadline = Date.now() + 40 * 60 * 1000;
    saveProgress();
    renderQuestion();
    updateExamClock();
  });
  $("submit-exam").addEventListener("click", () => {
    const unanswered = states.filter((state) => !state.selected.length).length;
    if (unanswered && !window.confirm(`还有 ${unanswered} 题未作答，未答题按错题计分。确定交卷？`)) return;
    finishExam();
  });
  $("new-exam").addEventListener("click", () => {
    questions = createExamQuestions();
    states.splice(0, states.length, ...questions.map((question) => ({ selected: [], checked: false, optionOrder: shuffle(Object.keys(question.options)) })));
    exam = { deadline: null, submittedAt: null, timedOut: false };
    currentIndex = 0;
    history.replaceState(null, "", "?exam=1");
    buildNavigation();
    saveProgress();
    renderQuestion();
    updateExamClock();
  });
  setInterval(updateExamClock, 1000);
  document.addEventListener("visibilitychange", updateExamClock);
}
renderQuestion();
saveCollections();
saveProgress();
if (examMode) updateExamClock();
window.addEventListener("pageshow", () => {
  if (examMode) updateExamClock();
  if ((!examMode || exam.deadline) && window.matchMedia("(max-width: 760px)").matches && !location.hash) {
    requestAnimationFrame(() => $(questions.length ? "question-card" : "empty-collection").scrollIntoView({ block: "start" }));
  }
});
