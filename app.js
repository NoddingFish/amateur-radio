"use strict";

const allQuestions = window.QUESTION_BANK.map((question, index) => ({ ...question, number: index + 1 }));
const studyGuide = window.STUDY_GUIDE;
const hintGroups = new Map(studyGuide.groups.flatMap((group) => group.question_numbers.map((number) => [number, group])));
const params = new URLSearchParams(location.search);
const searchMode = params.has("search");
const searchKeyword = (params.get("search") || "").trim();
const normalizedKeyword = searchKeyword.toLowerCase();
const selectedGroup = studyGuide.groups.find((group) => group.id === params.get("group"));
const selectedTopic = studyGuide.topics.find((topic) => topic.id === params.get("topic"));
const selectedDay = studyGuide.plan.find((day) => day.day === Number(params.get("day")) && day.group_ids.length);
const collectionMode = !searchMode && ["mistakes", "favorites"].includes(params.get("collection")) ? params.get("collection") : null;
const examMode = !searchMode && !collectionMode && !selectedGroup && !selectedTopic && !selectedDay && (params.get("exam") === "1" || params.get("mixed") === "1");
const practiceKey = collectionMode || (selectedGroup ? `group-${selectedGroup.id}` : selectedTopic ? `topic-${selectedTopic.id}` : selectedDay ? `day-${selectedDay.day}` : examMode ? "exam" : "all");
const storageKey = searchMode ? "radio-a-search-v1" : examMode ? "radio-a-exam-v1" : `radio-a-practice-v1-${practiceKey}`;
const sequentialNumbers = searchMode || examMode || collectionMode;
const collectionsKey = "radio-a-collections-v1";
let storageAvailable = true;
function readSaved(key) {
  try {
    return JSON.parse((searchMode && key === storageKey ? sessionStorage : localStorage).getItem(key) || "null");
  } catch {
    return null;
  }
}
let saved = readSaved(storageKey);
if (searchMode && saved?.searchKeyword !== searchKeyword) saved = null;
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
let autoNextTimer;
let hintQuestionId = null;
let questions = allQuestions;
let practiceTitle = "";
let practiceReturn = "study.html";
if (searchMode) {
  questions = normalizedKeyword ? allQuestions.filter((question) => [question.question, ...Object.values(question.options)].some((text) => text.toLowerCase().includes(normalizedKeyword))) : [];
  practiceTitle = `“${searchKeyword}” · ${questions.length} 题 · 临时题库`;
  practiceReturn = "index.html#search-form";
} else if (collectionMode) {
  questions = allQuestions.filter((question) => collections[collectionMode].has(question.id));
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
let questionTransition = null;

function clearQuestionTransition() {
  if (!questionTransition) return;
  questionTransition.animations.forEach((animation) => animation.cancel());
  questionTransition.copy.remove();
  $("question-stage").style.minHeight = "";
  questionTransition = null;
}

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
  document.querySelector(".exam-clock > span").textContent = submitted ? "交卷时剩余" : "剩余时间";
  document.querySelector(".keyboard-hint").textContent = submitted ? "方向键切题 · 查看作答结果" : "方向键切题 · 交卷前可修改答案";
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
    (searchMode && key === storageKey ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  $("save-status").textContent = storageAvailable ? (searchMode ? "作答与位置仅在当前标签页临时保存，刷新可继续；错题与收藏保存在当前浏览器。" : "作答、当前位置、错题与收藏已自动保存在当前浏览器。") : "当前浏览器无法保存记录，刷新后可能丢失本次作答、错题或收藏。";
}

function saveProgress() {
  writeSaved(storageKey, {
    questionNumbers: questions.map((question) => question.number),
    currentQuestion: questions[currentIndex]?.number || null,
    states: Object.fromEntries(questions.map((question, index) => [question.id, states[index]])),
    ...(examMode ? { exam } : {}),
    ...(searchMode ? { searchKeyword } : {}),
  });
}

function saveCollections() {
  writeSaved(collectionsKey, Object.fromEntries(Object.entries(collections).map(([name, ids]) => [name, [...ids]])));
  renderCollectionControls();
}

function renderCollectionControls() {
  const question = questions[currentIndex];
  const favorite = !!question && collections.favorites.has(question.id);
  $("toggle-favorite").setAttribute("aria-pressed", String(favorite));
  $("toggle-favorite").setAttribute("aria-label", favorite ? "取消收藏本题" : "收藏本题");
  $("toggle-favorite").title = favorite ? "取消收藏本题" : "收藏本题";
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
  const takingExam = examMode && !exam.submittedAt;
  const answered = states.filter((state) => takingExam ? state.selected.length : state.checked).length;
  $("navigation-status-label").textContent = takingExam ? "已作答" : "已检查";
  $("answered-count").textContent = answered;
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
    button.setAttribute("aria-label", `第 ${sequentialNumbers ? index + 1 : questions[index].number} 题，${takingExam ? (state.selected.length ? "已作答" : "未作答") : status}`);
  });
}

function renderHint() {
  const question = questions[currentIndex];
  const group = hintGroups.get(question?.number);
  const available = group && (!examMode || exam.submittedAt);
  if (!available) hintQuestionId = null;
  const open = available && hintQuestionId === question.id;
  $("toggle-hint").hidden = !available;
  const dialog = $("hint-dialog");
  const panel = $("question-hint");
  panel.replaceChildren();
  if (!open) {
    if (dialog.open) dialog.close();
    return;
  }

  const title = document.createElement("h3");
  title.id = "hint-title";
  title.textContent = group.title;
  const mnemonic = document.createElement("p");
  mnemonic.className = "hint-mnemonic";
  mnemonic.textContent = `速记口诀｜${group.mnemonic}`;
  const heading = document.createElement("h4");
  heading.textContent = "解题线索";
  const rules = document.createElement("ul");
  group.rules.forEach((rule) => {
    const item = document.createElement("li");
    item.textContent = rule;
    rules.append(item);
  });
  const pitfall = document.createElement("p");
  pitfall.className = "hint-pitfall";
  pitfall.textContent = `避坑提醒｜${group.pitfall}`;
  panel.append(title, mnemonic, heading, rules, pitfall);
  studyGuide.source_cautions.filter((issue) => issue.question_numbers.includes(question.number)).forEach((issue) => {
    const caution = document.createElement("p");
    caution.className = "hint-caution";
    caution.textContent = `本题特别提醒｜${issue.detail}`;
    panel.append(caution);
  });
  const footer = document.createElement("div");
  footer.className = "hint-footer";
  const link = document.createElement("a");
  link.href = `study.html?topic=${group.topic_id}#group-${group.id}`;
  link.append("查看同组速记", window.radioIcon("next"));
  footer.append(link);
  if (!examMode) {
    const note = document.createElement("span");
    note.textContent = "已暂停本题自动跳转，请手动切题。";
    footer.append(note);
  }
  panel.append(footer);
  if (!dialog.open) dialog.showModal();
}

function renderSearchText(node, text) {
  node.replaceChildren();
  let offset = 0;
  if (searchMode && normalizedKeyword) {
    // 转义正则特殊字符，按字面匹配；使用原文索引，保留大小写与文字内容。
    const pattern = new RegExp(searchKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of text.matchAll(pattern)) {
      node.append(document.createTextNode(text.slice(offset, match.index)));
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = match[0];
      node.append(mark);
      offset = match.index + match[0].length;
    }
  }
  node.append(document.createTextNode(text.slice(offset)));
}

function renderQuestion() {
  clearQuestionTransition();
  renderExam();
  const empty = !questions.length;
  const ready = !examMode || Boolean(exam.deadline);
  $("question-card").hidden = empty || !ready;
  $("page-navigation").hidden = empty || !ready;
  $("empty-collection").hidden = !empty;
  renderCollectionControls();
  renderHint();
  if (empty) {
    $("empty-title").textContent = searchMode ? "没有找到匹配的题目" : collectionMode === "mistakes" ? "还没有错题，继续保持！" : "还没有收藏的题目";
    $("empty-description").textContent = searchMode ? "试试更短的关键词，题干和所有选项都会参与搜索。" : collectionMode === "mistakes" ? "答错的题目会自动收录在这里，方便集中复习。" : "做题时点击星标，即可把想复习的题目收藏到这里。";
    if (searchMode) {
      const link = $("empty-collection").querySelector("a");
      link.href = practiceReturn;
      link.replaceChildren(document.createTextNode("返回首页重新搜索"), window.radioIcon("back"));
    }
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
  $("question-number").textContent = `第 ${String(sequentialNumbers ? currentIndex + 1 : question.number).padStart(3, "0")} 题`;
  $("question-type").textContent = multiple ? "多选题" : "单选题";
  renderSearchText($("question-title"), question.question);
  $("selection-hint").textContent = examMode && !exam.submittedAt ? (multiple ? "请选择所有正确选项，可修改答案，交卷后统一判分。" : "请选择一个正确选项，可修改答案，交卷后统一判分。") : multiple ? "请选择所有正确选项，按回车或点击「提交答案」。" : "请选择一个正确选项，点击后自动提交。";
  if (examMode && exam.submittedAt) $("selection-hint").textContent = "试卷已交卷，下面显示你的作答与正确选项。";
  $("source-id").textContent = `${sequentialNumbers ? `题库第 ${question.number} 题 · ` : ""}原题号 ${question.legacy_ids.join(" / ")} · ${question.id}`;
  $("source-pages").textContent = `来源 PDF 第 ${question.source_pages.join("、")} 页`;
  const images = $("question-images");
  images.hidden = !question.image_files.length;
  images.replaceChildren();
  question.image_files.forEach((file) => {
    const image = document.createElement("img");
    image.className = "question-image";
    image.alt = `第 ${question.number} 题配图`;
    image.addEventListener("error", () => {
      const notice = document.createElement("p");
      notice.className = "image-notice";
      notice.textContent = `本题配图（${file}）加载失败，请刷新重试。`;
      image.replaceWith(notice);
    });
    image.src = `images/${file}`;
    images.append(image);
  });

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
    renderSearchText(content, text);
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
    title.append(window.radioIcon(correct ? "check" : "close"), document.createTextNode(correct ? "回答正确" : "回答错误"));
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
  clearQuestionTransition();
  const card = $("question-card");
  const direction = Math.sign(index - currentIndex);
  const copy = direction && !card.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? card.cloneNode(true) : null;
  const previousHeight = card.offsetHeight;
  clearTimeout(autoNextTimer);
  hintQuestionId = null;
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
  if (window.matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0 });
  if (copy) {
    copy.removeAttribute("id");
    copy.removeAttribute("aria-labelledby");
    copy.setAttribute("aria-hidden", "true");
    copy.inert = true;
    copy.classList.add("question-transition-copy");
    copy.querySelectorAll("[id], [name]").forEach((node) => {
      node.removeAttribute("id");
      node.removeAttribute("name");
    });
    const stage = $("question-stage");
    stage.style.minHeight = `${Math.max(previousHeight, card.offsetHeight)}px`;
    stage.append(copy);
    const timing = { duration: 260, easing: "cubic-bezier(.22,.61,.36,1)" };
    const animations = [
      copy.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-direction * 100}%)` }], timing),
      card.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: "translateX(0)" }], timing),
    ];
    questionTransition = { copy, animations };
    Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (questionTransition?.copy === copy) clearQuestionTransition();
    }, () => {});
  }
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
  if (!$("hint-dialog").open && currentIndex < questions.length - 1) {
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
    button.textContent = sequentialNumbers ? index + 1 : question.number;
    button.dataset.questionNumber = question.number;
    button.addEventListener("click", () => goToQuestion(index));
    navButtons.push(button);
    $("question-nav").append(button);
  });
  document.querySelectorAll("[data-total]").forEach((element) => { element.textContent = questions.length; });
  $("jump-input").max = sequentialNumbers ? Math.max(1, questions.length) : allQuestions.length;
}
buildNavigation();
$("jump-input").addEventListener("input", () => $("jump-input").setCustomValidity(""));
$("practice-mode").textContent = searchMode ? "搜索练习" : collectionMode ? (collectionMode === "mistakes" ? "错题本" : "我的收藏") : examMode ? "模拟考试" : selectedGroup || selectedTopic || selectedDay ? "专题练习" : "顺序练习";
document.title = `A 类题库 · ${$("practice-mode").textContent}`;
document.querySelector("#practice-sidebar .section-heading h2").textContent = collectionMode ? $("practice-mode").textContent : "题目导航";
$("practice-navigation-title").textContent = collectionMode ? `${$("practice-mode").textContent} · 题目导航` : "题目导航";
if (practiceTitle && !examMode) {
  $("practice-context").hidden = false;
  $("practice-context").textContent = practiceTitle;
}
if (searchMode || collectionMode) {
  $("jump-input").placeholder = searchMode ? "输入搜索结果序号" : collectionMode === "mistakes" ? "输入错题序号" : "输入收藏序号";
  document.querySelector('label[for="jump-input"]').textContent = `跳转到${$("practice-mode").textContent}序号`;
  $("question-nav").setAttribute("aria-label", `按${$("practice-mode").textContent}序号选择题目`);
}
$("jump-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const number = Number($("jump-input").value);
  const index = sequentialNumbers ? number - 1 : questions.findIndex((question) => question.number === number);
  if (index >= 0 && index < questions.length) {
    goToQuestion(index);
    $("jump-input").value = "";
  } else {
    $("jump-input").setCustomValidity("当前练习不包含该原题号，可按左侧题目导航选择，或返回全部题库。");
    $("jump-input").reportValidity();
  }
});
document.addEventListener("keydown", (event) => {
  if (document.querySelector("dialog[open]")) return;
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
$("open-question-navigation").addEventListener("click", () => clearTimeout(autoNextTimer));
$("toggle-hint").addEventListener("click", () => {
  if (examMode && !exam.submittedAt) return;
  hintQuestionId = questions[currentIndex].id;
  clearTimeout(autoNextTimer);
  if (states[currentIndex].checked) $("action-hint").textContent = "可重新作答，或继续下一题";
  renderHint();
});
$("hint-dialog").addEventListener("close", () => { if (!$("hint-dialog").open) hintQuestionId = null; });
$("back-to-list").href = searchMode || selectedGroup || selectedTopic || selectedDay ? practiceReturn : "index.html";
$("back-to-list").setAttribute("aria-label", searchMode ? "返回首页搜索" : selectedGroup || selectedTopic || selectedDay ? "返回分类速记" : "返回首页");
$("back-to-list").title = $("back-to-list").getAttribute("aria-label");

let swipeStart = null;
let swiped = false;
const questionCard = $("question-card");
questionCard.addEventListener("pointerdown", (event) => {
  swipeStart = null;
  swiped = false;
  if (event.pointerType !== "touch" || !event.isPrimary || !window.matchMedia("(max-width: 760px)").matches || document.querySelector("dialog[open]") || event.target.closest("button, a, input")) return;
  swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});
questionCard.addEventListener("pointerup", (event) => {
  if (!swipeStart || event.pointerId !== swipeStart.id) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || document.querySelector("dialog[open]")) return;
  swiped = true;
  event.preventDefault();
  goToQuestion(currentIndex + (dx < 0 ? 1 : -1));
});
questionCard.addEventListener("pointercancel", () => { swipeStart = null; });
questionCard.addEventListener("click", (event) => {
  if (!swiped) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  swiped = false;
}, true);
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
window.addEventListener("pageshow", () => { if (examMode) updateExamClock(); });
