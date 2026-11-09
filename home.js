"use strict";

const params = new URLSearchParams(location.search);
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
// 保留旧版题目书签；新的列表入口使用 view 参数。
if (["mistakes", "favorites"].includes(params.get("collection")) || params.get("view") === "questions" || ["question", "group", "day", "exam", "mixed"].some((key) => params.has(key)) || (params.has("topic") && params.get("view") !== "groups")) {
  location.replace(`practice.html${location.search}${location.hash}`);
} else {
  const bank = window.QUESTION_BANK;
  const guide = window.STUDY_GUIDE;
  const byId = (id) => document.getElementById(id);
  const searchInput = byId("search-input");
  searchInput.addEventListener("input", () => searchInput.setCustomValidity(""));
  byId("search-form").addEventListener("submit", (event) => {
    searchInput.value = searchInput.value.trim();
    if (!searchInput.value) {
      event.preventDefault();
      searchInput.setCustomValidity("请输入要搜索的关键词。");
      searchInput.reportValidity();
    }
  });
  function readSaved(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch { byId("home-storage-note").textContent = "当前浏览器无法读取保存记录，题库仍可使用。"; return null; }
  }
  const savedCollections = readSaved("radio-a-collections-v1");
  const validIds = new Set(bank.map((question) => question.id));
  const collections = Object.fromEntries(["mistakes", "favorites"].map((name) => [name, new Set(Array.isArray(savedCollections?.[name]) ? savedCollections[name].filter((id) => validIds.has(id)) : [])]));
  if (!savedCollections) {
    try {
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key.startsWith("radio-a-practice-v1-") || key.endsWith("-mistakes") || key.endsWith("-favorites")) continue;
        Object.entries(readSaved(key)?.states || {}).forEach(([id, state]) => {
          const question = bank.find((item) => item.id === id);
          if (question && state?.checked && Array.isArray(state.selected) && state.selected.length && !(state.selected.length === question.answers.length && question.answers.every((answer) => state.selected.includes(answer)))) collections.mistakes.add(id);
        });
      }
      localStorage.setItem("radio-a-collections-v1", JSON.stringify(Object.fromEntries(Object.entries(collections).map(([name, ids]) => [name, [...ids]]))));
    } catch { byId("home-storage-note").textContent = "当前浏览器无法保存记录，本次仍可浏览题库。"; }
  }
  ["mistakes", "favorites"].forEach((name) => {
    byId(`${name}-count`).textContent = collections[name].size;
  });
  const progress = readSaved("radio-a-practice-v1-all");
  let correct = 0;
  let incorrect = 0;
  bank.forEach((question) => {
    const state = progress?.states?.[question.id];
    if (state?.checked !== true || !Array.isArray(state.selected)) return;
    const selected = [...new Set(state.selected.filter((key) => Object.hasOwn(question.options, key)))].slice(0, question.answers.length === 1 ? 1 : undefined);
    if (!selected.length) return;
    if (selected.length === question.answers.length && question.answers.every((answer) => selected.includes(answer))) correct++;
    else incorrect++;
  });
  const checked = correct + incorrect;
  byId("answered-count").textContent = checked;
  byId("correct-count").textContent = correct;
  byId("incorrect-count").textContent = incorrect;
  byId("remaining-count").textContent = bank.length - checked;
  byId("progress").value = checked;
  byId("progress-percent").textContent = `${Math.round(checked / bank.length * 100)}%`;
  const currentNumber = bank.some((question, index) => index + 1 === progress?.currentQuestion) ? progress.currentQuestion : 1;
  byId("home-progress").textContent = `继续第 ${currentNumber} 题`;
  const savedMastered = readSaved("radio-a-mastered-groups-v1");
  const mastered = new Set(Array.isArray(savedMastered) ? savedMastered.filter((id) => guide.groups.some((group) => group.id === id)) : []);
  byId("mastered-count").textContent = mastered.size;
  byId("study-progress").value = mastered.size;
  byId("mastered-percent").textContent = `${Math.round(mastered.size / guide.groups.length * 100)}%`;
  byId("mastery-remaining").textContent = `还剩 ${guide.groups.length - mastered.size} 组`;
  const groupsView = params.get("view") === "groups";
  byId("home-panel").hidden = groupsView;
  byId("library-panel").hidden = !groupsView;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function questionRange(numbers) {
    const ranges = [];
    [...numbers].sort((a, b) => a - b).forEach((number) => {
      const last = ranges[ranges.length - 1];
      if (last && number === last[1] + 1) last[1] = number;
      else ranges.push([number, number]);
    });
    return `第 ${ranges.map(([start, end]) => start === end ? start : `${start}–${end}`).join("、")} 题`;
  }
  if (groupsView) {
    const title = "分类速记";
    document.title = `A 类题库 · ${title}`;
    byId("library-title").textContent = title;
    const list = byId("library-list");
    document.body.classList.add("study-library-page");
    list.classList.add("study-library-list");
    const topic = guide.topics.find((item) => item.id === params.get("topic"));
    const groups = topic ? guide.groups.filter((group) => group.topic_id === topic.id) : null;
    byId("library-description").textContent = topic
      ? `${groups.length} 个记忆组 · ${topic.question_count} 题。选择记忆组，查看口诀、核心规则和同组练习。`
      : `${guide.topics.length} 个主题 · ${guide.groups.length} 个记忆组。先选择主题，再查看下面的记忆组。`;
    if (topic) {
      byId("library-title").textContent = topic.title;
      document.title = `A 类题库 · 分类速记 · ${topic.title}`;
      byId("library-back").href = "index.html?view=groups";
      byId("library-back").replaceChildren(window.radioIcon("back"), document.createTextNode("返回全部主题"));
    }
    (groups || guide.topics).forEach((item, index) => {
      const topicGroups = groups ? null : guide.groups.filter((group) => group.topic_id === item.id);
      const numbers = groups ? item.question_numbers : topicGroups.flatMap((group) => group.question_numbers);
      const link = document.createElement("a");
      link.className = `library-row ${groups ? "group" : "topic"}-list-row`;
      link.href = groups ? `study.html?topic=${topic.id}#group-${item.id}` : `index.html?view=groups&topic=${item.id}`;
      const content = element("span", "list-content", "");
      content.append(element("span", "list-title", item.title), element("span", "list-range", questionRange(numbers)));
      const status = element("span", "list-status", `${groups ? "" : `${topicGroups.length} 组 · `}${numbers.length} 题`);
      status.append(window.radioIcon("next"));
      link.append(element("span", "list-number", groups ? item.id.toUpperCase() : String(index + 1).padStart(2, "0")), content, status);
      list.append(link);
    });
  }
}
