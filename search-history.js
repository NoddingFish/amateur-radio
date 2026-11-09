"use strict";

window.radioSearchHistory = (() => {
  const key = "radio-a-search-history-v1";
  function read() {
    try {
      const records = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(records) ? records.filter((text) => typeof text === "string" && text.trim()) : [];
    } catch { return []; }
  }
  function save(records) {
    try { localStorage.setItem(key, JSON.stringify(records)); return true; }
    catch { return false; }
  }
  function add(keyword) {
    const text = keyword.trim();
    return !text || save([text, ...read().filter((item) => item.toLowerCase() !== text.toLowerCase())]);
  }
  return { read, save, add };
})();
