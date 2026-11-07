"use strict";

const guide = window.STUDY_GUIDE;
const bank = window.QUESTION_BANK;
const byId = (id) => document.getElementById(id);
const storedKey = "radio-a-mastered-groups-v1";
const validGroups = new Set(guide.groups.map((group) => group.id));
let mastered = new Set();
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(storedKey) || "[]");
  if (Array.isArray(saved)) mastered = new Set(saved.filter((id) => validGroups.has(id)));
} catch { storageAvailable = false; }
const initialTopic = new URLSearchParams(location.search).get("topic");
const linkedGroup = guide.groups.find((group) => `#group-${group.id}` === location.hash);
let currentTopic = guide.topics.find((topic) => topic.id === initialTopic) || guide.topics.find((topic) => topic.id === linkedGroup?.topic_id) || null;
let currentGroup = linkedGroup?.id || null;
const compactMenu = window.matchMedia("(max-width: 760px)");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function questionRange(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = start;
  sorted.forEach((number, index) => {
    if (index === 0) return;
    if (number === end + 1) end = number;
    else {
      ranges.push(start === end ? `${start}` : `${start}–${end}`);
      start = end = number;
    }
  });
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return `第 ${ranges.join("、")} 题`;
}

function topicQuestionRange(topic) {
  return questionRange(guide.groups.filter((group) => group.topic_id === topic.id).flatMap((group) => group.question_numbers));
}

function updateCollectionCounts() {
  let collections;
  try { collections = JSON.parse(localStorage.getItem("radio-a-collections-v1") || "null"); }
  catch { collections = null; }
  const validIds = new Set(bank.map((question) => question.id));
  ["mistakes", "favorites"].forEach((name) => {
    const ids = Array.isArray(collections?.[name]) ? collections[name] : [];
    byId(`${name}-count`).textContent = new Set(ids.filter((id) => validIds.has(id))).size;
  });
}

function updateProgress() {
  byId("mastered-count").textContent = mastered.size;
  byId("study-progress").value = mastered.size;
  if (!storageAvailable) byId("storage-note").textContent = "当前浏览器暂不能保存标记；本次页面内仍可使用。";
  guide.topics.forEach((topic) => {
    const button = byId(`topic-${topic.id}`);
    button.setAttribute("aria-current", String(topic.id === currentTopic?.id));
    button.querySelector(".question-range").textContent = topicQuestionRange(topic);
    button.querySelector("small").textContent = `${topic.question_count} 题 · ${topic.group_ids.filter((id) => mastered.has(id)).length}/${topic.group_ids.length} 组掌握`;
  });
  byId("topic-overview").setAttribute("aria-current", String(!currentTopic));
  byId("current-topic-label").textContent = currentTopic?.title || "学习概览";
}

function selectGroup(id) {
  currentGroup = id;
  document.querySelectorAll(".knowledge-card").forEach((card) => { card.hidden = card.id !== `group-${id}`; });
  document.querySelectorAll("#group-nav button").forEach((button) => button.setAttribute("aria-current", String(button.dataset.group === id)));
  const group = guide.groups.find((item) => item.id === id);
  byId("current-group-label").textContent = group ? `${group.id.toUpperCase()} · ${group.title}` : "点击选择";
  if (byId("group-menu").open) byId("group-menu").close();
}

function renderGroup(group) {
  const card = element("article", "knowledge-card");
  card.id = `group-${group.id}`;
  card.classList.toggle("is-mastered", mastered.has(group.id));
  const topic = guide.topics.find((item) => item.id === group.topic_id);
  card.append(element("p", "group-kicker", `${group.id.toUpperCase()} · ${topic.title} · ${group.question_numbers.length} 道变式 · ${questionRange(group.question_numbers)}`));
  card.append(element("h3", "", group.title));
  card.append(element("p", "recall-prompt", `先不看答案：${group.recall_question}`));
  const details = element("details", "knowledge-details");
  details.append(element("summary", "", "展开核对与核心规则 ↓"));
  details.append(element("p", "recall-answer", `核对：${group.recall_answer}`));
  details.append(element("p", "mnemonic", `记忆线索｜${group.mnemonic}`));
  const rules = element("ul", "rule-list");
  group.rules.forEach((rule) => rules.append(element("li", "", rule)));
  details.append(rules, element("p", "pitfall", `易错点：${group.pitfall}`));
  const sources = element("details", "source-questions");
  sources.append(element("summary", "", `查看 ${group.question_numbers.length} 道对应原题与标准选项（留意否定问法）`));
  group.question_numbers.forEach((number) => {
    const question = bank[number - 1];
    const item = element("div", "source-question");
    const link = element("a", "", `第 ${number} 题 · ${question.id} ↗`);
    link.href = `index.html?group=${group.id}&question=${number}`;
    const answers = element("ol", "");
    question.answers.forEach((key) => answers.append(element("li", "", question.options[key])));
    item.append(link, element("p", "", question.question), element("strong", "", "题库标准选项内容："), answers);
    sources.append(item);
  });
  details.append(sources);
  const actions = element("div", "group-actions");
  const practice = element("a", "group-practice", `练本组 ${group.question_numbers.length} 题 ↗`);
  practice.href = `index.html?group=${group.id}`;
  const mark = element("button", "master-button");
  mark.type = "button";
  function setMark() {
    mark.textContent = mastered.has(group.id) ? "✓ 已标记掌握" : "标记已掌握";
    mark.setAttribute("aria-pressed", String(mastered.has(group.id)));
    card.classList.toggle("is-mastered", mastered.has(group.id));
  }
  setMark();
  mark.addEventListener("click", () => {
    if (mastered.has(group.id)) mastered.delete(group.id);
    else mastered.add(group.id);
    try { localStorage.setItem(storedKey, JSON.stringify([...mastered])); }
    catch { storageAvailable = false; }
    setMark();
    updateProgress();
    if (byId("only-unmastered").checked) renderGroups();
  });
  actions.append(practice, mark);
  card.append(details, actions);
  return card;
}

function renderGroups() {
  byId("study-overview").hidden = Boolean(currentTopic);
  byId("topic-section").hidden = !currentTopic;
  if (!currentTopic) return;
  const search = byId("study-search").value.trim().toLowerCase();
  const pendingOnly = byId("only-unmastered").checked;
  const groups = guide.groups.filter((group) => {
    const matches = search ? [group.title, group.mnemonic, ...group.rules, group.pitfall, group.recall_question].join(" ").toLowerCase().includes(search) : group.topic_id === currentTopic.id;
    return matches && (!pendingOnly || !mastered.has(group.id));
  });
  byId("topic-index").textContent = search ? "SEARCH ALL TOPICS" : `TOPIC ${String(guide.topics.indexOf(currentTopic) + 1).padStart(2, "0")} / 13 · ${topicQuestionRange(currentTopic)}`;
  byId("topic-title").textContent = search ? `搜索：${byId("study-search").value.trim()}` : currentTopic.title;
  byId("topic-summary").textContent = search ? "在全部 70 个记忆组中查找，结果保留所属主题。" : currentTopic.summary;
  byId("practice-topic").hidden = Boolean(search);
  byId("practice-topic").href = `index.html?topic=${currentTopic.id}`;
  byId("group-result-count").textContent = `${groups.length} 个记忆组 · ${groups.reduce((total, group) => total + group.question_numbers.length, 0)} 道题${pendingOnly ? " · 仅显示未掌握" : ""}`;
  const container = byId("knowledge-groups");
  container.replaceChildren();
  byId("group-nav").replaceChildren();
  groups.forEach((group) => {
    container.append(renderGroup(group));
    const button = element("button", "group-tab", `${group.id.toUpperCase()} · ${group.title}`);
    button.append(element("small", "question-range", questionRange(group.question_numbers)));
    button.type = "button";
    button.dataset.group = group.id;
    button.addEventListener("click", () => selectGroup(group.id));
    byId("group-nav").append(button);
  });
  selectGroup(groups.some((group) => group.id === currentGroup) ? currentGroup : compactMenu.matches ? null : groups[0]?.id);
  if (!groups.length) container.append(element("p", "empty-groups", search ? "没有找到匹配的知识点，请换个词试试。" : "当前条件下没有待显示的记忆组。取消“只看未掌握”可再次自测。"));
}

guide.topics.forEach((topic, index) => {
  const button = element("button", "topic-button");
  button.id = `topic-${topic.id}`;
  button.type = "button";
  const label = element("span", "");
  label.append(element("b", "", topic.title), element("small", ""), element("span", "question-range"));
  button.append(element("span", "topic-ordinal", String(index + 1).padStart(2, "0")), label);
  button.addEventListener("click", () => {
    currentTopic = topic;
    currentGroup = null;
    byId("study-search").value = "";
    history.replaceState(null, "", `?topic=${topic.id}`);
    renderGroups();
    updateProgress();
    if (byId("topic-menu").open) byId("topic-menu").close();
    byId("topic-title").focus({ preventScroll: true });
  });
  byId("topic-nav").append(button);
});

byId("topic-overview").addEventListener("click", () => {
  currentTopic = null;
  currentGroup = null;
  history.replaceState(null, "", location.pathname);
  renderGroups();
  updateProgress();
  if (byId("topic-menu").open) byId("topic-menu").close();
});

guide.plan.forEach((day) => {
  const row = element("div", "plan-day");
  const content = element("div", "");
  content.append(element("h3", "", day.title), element("p", "", day.task));
  const link = element("a", "", day.question_count ? `练 ${day.question_count} 题 ↗` : "模拟考试 40 题 ↗");
  link.href = day.group_ids.length ? `index.html?day=${day.day}` : "index.html?exam=1";
  row.append(element("b", "", `DAY ${String(day.day).padStart(2, "0")}`), content, link);
  byId("plan-days").append(row);
});

guide.quick_tables.forEach((reference) => {
  const details = element("details", "reference-table");
  details.append(element("summary", "", reference.title));
  const scroll = element("div", "table-scroll");
  const table = element("table", "");
  const head = element("thead", "");
  const header = element("tr", "");
  reference.headers.forEach((text) => {
    const cell = element("th", "", text);
    cell.scope = "col";
    header.append(cell);
  });
  head.append(header);
  const body = element("tbody", "");
  reference.rows.forEach((row) => {
    const tr = element("tr", "");
    row.forEach((text) => tr.append(element("td", "", text)));
    body.append(tr);
  });
  table.append(head, body);
  scroll.append(table);
  details.append(scroll, element("p", "", reference.note));
  byId("quick-tables").append(details);
});

guide.source_cautions.forEach((issue) => {
  const item = element("li", "");
  const link = element("a", "", `第 ${issue.question_numbers.join("、")} 题`);
  link.href = `index.html?group=${issue.group_id}&question=${issue.question_numbers[0]}`;
  item.append(link, document.createTextNode(`：${issue.detail}`));
  byId("source-cautions").append(item);
});
byId("study-search").addEventListener("input", renderGroups);
byId("only-unmastered").addEventListener("change", renderGroups);
renderGroups();
updateProgress();
updateCollectionCounts();
window.addEventListener("pageshow", updateCollectionCounts);
if (location.hash === "#review-plan") byId("review-plan").open = true;
if (location.hash.startsWith("#group-")) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
