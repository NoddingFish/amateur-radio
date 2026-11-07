"use strict";

const questions = window.QUESTION_BANK;
const states = questions.map(() => ({ selected: [], checked: false }));
let currentIndex = 0;
const $ = (id) => document.getElementById(id);
const navButtons = [];

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
  const answered = correct + incorrect;
  $("answered-count").textContent = answered;
  $("correct-count").textContent = correct;
  $("incorrect-count").textContent = incorrect;
  $("remaining-count").textContent = questions.length - answered;
  $("progress").value = answered;
  $("progress-percent").textContent = `${Math.round(answered / questions.length * 100)}%`;
}

function renderNavigation() {
  navButtons.forEach((button, index) => {
    const state = states[index];
    const status = state.checked ? (isCorrect(questions[index], state.selected) ? "答对" : "答错") : "未检查";
    button.classList.toggle("answered-correct", status === "答对");
    button.classList.toggle("answered-incorrect", status === "答错");
    button.setAttribute("aria-current", String(index === currentIndex));
    button.setAttribute("aria-label", `第 ${index + 1} 题，${status}`);
  });
}

function renderQuestion() {
  const question = questions[currentIndex];
  const state = states[currentIndex];
  const multiple = question.answers.length > 1;
  $("question-number").textContent = `第 ${String(currentIndex + 1).padStart(3, "0")} 题`;
  $("question-type").textContent = multiple ? "多选题" : "单选题";
  $("chapter-label").textContent = `知识点 ${question.chapter}`;
  $("question-title").textContent = question.question;
  $("selection-hint").textContent = multiple ? "请选择所有正确选项，选完后检查答案。" : "请选择一个正确选项，选完后检查答案。";
  $("source-id").textContent = `原题号 ${question.legacy_ids.join(" / ")} · ${question.id}`;
  $("source-pages").textContent = `来源 PDF 第 ${question.source_pages.join("、")} 页`;
  $("image-notice").hidden = !question.image_files.length;
  $("image-notice").textContent = question.image_files.length ? `本题原 PDF 仅列出配图文件名（${question.image_files.join("、")}），未提供实际图片。` : "";

  const options = $("options");
  options.replaceChildren();
  const legend = document.createElement("legend");
  legend.className = "sr-only";
  legend.textContent = multiple ? "选择所有正确答案" : "选择一个正确答案";
  options.append(legend);
  Object.entries(question.options).forEach(([key, text]) => {
    const label = document.createElement("label");
    label.className = "option";
    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.textContent = key;
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
      state.selected = [...options.querySelectorAll("input:checked")].map((item) => item.value);
      $("check-answer").disabled = !state.selected.length;
      $("action-hint").textContent = state.selected.length ? `已选 ${state.selected.join("、")}` : "选择选项后检查答案";
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
    detail.textContent = `你的答案：${state.selected.join("、")}。正确答案：${question.answers.join("、")}。`;
    feedback.append(title, detail);
  }
  $("check-answer").disabled = state.checked || !state.selected.length;
  $("check-answer").firstChild.textContent = state.checked ? "已检查 " : "检查答案 ";
  $("retry-answer").hidden = !state.checked;
  $("action-hint").textContent = state.checked ? "可重新作答，或继续下一题" : state.selected.length ? `已选 ${state.selected.join("、")}` : "选择选项后检查答案";
  $("previous-question").disabled = currentIndex === 0;
  $("next-question").disabled = currentIndex === questions.length - 1;
  $("page-position").textContent = `${currentIndex + 1} / ${questions.length}`;
  renderProgress();
  renderNavigation();
}

function goToQuestion(index) {
  if (index < 0 || index >= questions.length) return;
  currentIndex = index;
  renderQuestion();
  $("question-title").focus({ preventScroll: true });
  navButtons[index].scrollIntoView({ block: "nearest", inline: "nearest" });
  if (window.matchMedia("(max-width: 760px)").matches) $("question-number").scrollIntoView({ block: "start" });
}

questions.forEach((question, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = index + 1;
  button.addEventListener("click", () => goToQuestion(index));
  navButtons.push(button);
  $("question-nav").append(button);
});
document.querySelectorAll("[data-total]").forEach((element) => { element.textContent = questions.length; });
$("progress").max = questions.length;
$("jump-input").max = questions.length;
$("jump-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const number = Number($("jump-input").value);
  if (Number.isInteger(number) && number >= 1 && number <= questions.length) {
    goToQuestion(number - 1);
    $("jump-input").value = "";
  }
});
$("check-answer").addEventListener("click", () => {
  const state = states[currentIndex];
  if (!state.selected.length || state.checked) return;
  state.checked = true;
  renderQuestion();
});
$("retry-answer").addEventListener("click", () => {
  states[currentIndex] = { selected: [], checked: false };
  renderQuestion();
});
$("previous-question").addEventListener("click", () => goToQuestion(currentIndex - 1));
$("next-question").addEventListener("click", () => goToQuestion(currentIndex + 1));
renderQuestion();
