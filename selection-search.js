"use strict";

(() => {
  const button = document.getElementById("selection-search");
  let keyword = "";
  function selectedText() {
    const selection = window.getSelection();
    if (selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const source = node?.closest("#question-title, .option-text");
    if (!source || !source.contains(range.endContainer)) return null;
    const text = selection.toString().trim();
    return text ? { text, range } : null;
  }
  function hide() { button.hidden = true; }
  function update() {
    const selected = selectedText();
    if (!selected || document.body.classList.contains("exam-taking") || document.querySelector("dialog[open]")) { hide(); return; }
    keyword = selected.text;
    const rect = [...selected.range.getClientRects()].filter((item) => item.width && item.height).at(-1);
    if (!rect || rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
    button.style.left = `${Math.max(8, Math.min(innerWidth - 52, rect.right + 6))}px`;
    button.style.top = `${Math.max(8, Math.min(innerHeight - 116, rect.bottom + 6))}px`;
    button.setAttribute("aria-label", `搜索选中文字：${keyword}`);
    button.hidden = false;
  }
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  function searchSelection() {
    hide();
    location.href = `practice.html?search=${encodeURIComponent(keyword)}`;
  }
  button.addEventListener("click", searchSelection);
  button.addEventListener("touchend", (event) => {
    event.preventDefault();
    searchSelection();
  }, { passive: false });
  // 选择选项文字时只选文字，取消标签默认的勾选行为。
  document.getElementById("options").addEventListener("click", (event) => {
    if (!event.target.closest("input") && selectedText()) event.preventDefault();
  }, true);
  document.addEventListener("selectionchange", update);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") hide(); });
})();
