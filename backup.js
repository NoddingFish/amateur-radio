"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const dialog = byId("data-dialog");
  const questions = new Map(window.QUESTION_BANK.map((question) => [question.id, question]));
  const groups = new Set(window.STUDY_GUIDE.groups.map((group) => group.id));
  let exportText = "";
  let pending = null;
  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const validNumber = (number) => Number.isInteger(number) && number >= 1 && number <= questions.size;
  function readStorage(storage) {
    const records = {};
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key.startsWith("radio-a-")) {
        const value = storage.getItem(key);
        if (value !== null) records[key] = value;
      }
    }
    return records;
  }
  function snapshot() {
    return { localStorage: readStorage(localStorage), sessionStorage: readStorage(sessionStorage) };
  }
  function describe(data) {
    const read = (key) => {
      try { return JSON.parse(data.localStorage[key] || "null"); } catch { return null; }
    };
    const count = (value) => Array.isArray(value) ? value.length : 0;
    const collections = read("radio-a-collections-v1");
    const practice = Object.keys(data.localStorage).filter((key) => key.startsWith("radio-a-practice-v1-")).length;
    const exam = Object.hasOwn(data.localStorage, "radio-a-exam-v1") ? 1 : 0;
    const search = Object.hasOwn(data.sessionStorage, "radio-a-search-v1") ? 1 : 0;
    return `搜索 ${count(read("radio-a-search-history-v1"))} 条 · 错题 ${count(collections?.mistakes)} 题 · 收藏 ${count(collections?.favorites)} 题 · 已掌握 ${count(read("radio-a-mastered-groups-v1"))} 组 · 练习进度 ${practice} 份 · 考试 ${exam} 份 · 临时搜索 ${search} 份`;
  }
  function size(text) {
    const bytes = new Blob([text]).size;
    return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  function refreshExport() {
    try {
      const data = snapshot();
      exportText = JSON.stringify({ format: "radio-a-backup", version: 1, exportedAt: new Date().toISOString(), ...data });
      byId("export-text").value = exportText;
      const summary = `${describe(data)}。完整备份 ${size(exportText)}。`;
      byId("data-summary").textContent = summary;
      byId("export-summary").textContent = summary;
    } catch {
      exportText = "";
      byId("export-text").value = "";
      byId("data-summary").textContent = "当前浏览器无法读取本地数据，不能生成完整备份。";
      byId("backup-status").textContent = byId("data-summary").textContent;
    }
    byId("download-backup").disabled = !exportText;
    byId("copy-backup").disabled = !exportText;
  }
  function invalidate() {
    pending = null;
    byId("apply-backup").disabled = true;
    byId("import-preview").hidden = true;
  }
  function validateRecord(key, raw) {
    const arrayKey = ["radio-a-search-history-v1", "radio-a-mastered-groups-v1"].includes(key);
    const practiceKey = key.startsWith("radio-a-practice-v1-") || ["radio-a-exam-v1", "radio-a-search-v1"].includes(key);
    if (!arrayKey && !practiceKey && key !== "radio-a-collections-v1") return;
    const value = JSON.parse(raw);
    let valid = true;
    if (arrayKey) valid = Array.isArray(value) && value.every((item) => typeof item === "string" && (key !== "radio-a-mastered-groups-v1" || groups.has(item)));
    else if (key === "radio-a-collections-v1") valid = isObject(value) && ["mistakes", "favorites"].every((name) => Array.isArray(value[name]) && value[name].every((id) => questions.has(id)));
    else {
      valid = isObject(value) && isObject(value.states)
        && (value.currentQuestion == null || validNumber(value.currentQuestion))
        && (value.questionNumbers === undefined || (Array.isArray(value.questionNumbers) && value.questionNumbers.every(validNumber) && new Set(value.questionNumbers).size === value.questionNumbers.length))
        && Object.entries(value.states).every(([id, state]) => questions.has(id) && isObject(state) && Array.isArray(state.selected) && state.selected.every((answer) => typeof answer === "string" && Object.hasOwn(questions.get(id).options, answer)) && (state.checked === undefined || typeof state.checked === "boolean") && (state.optionOrder == null || (Array.isArray(state.optionOrder) && state.optionOrder.every((answer) => typeof answer === "string" && Object.hasOwn(questions.get(id).options, answer)))));
      if (key === "radio-a-search-v1") valid = valid && typeof value.searchKeyword === "string";
      if (key === "radio-a-exam-v1") valid = valid && isObject(value.exam) && ["deadline", "submittedAt"].every((name) => value.exam[name] == null || Number.isFinite(value.exam[name]));
    }
    if (!valid) throw new Error("备份中的学习记录格式不正确，或包含当前题库不存在的题目。尚未修改本地数据。");
  }
  function validate(text) {
    const data = JSON.parse(text.trim());
    if (!isObject(data) || data.format !== "radio-a-backup" || data.version !== 1) throw new Error("不是受支持的题库备份，请使用本页面导出的完整备份。");
    for (const name of ["localStorage", "sessionStorage"]) {
      if (!isObject(data[name])) throw new Error("备份内容不完整，尚未修改本地数据。");
      for (const [key, value] of Object.entries(data[name])) {
        if (!key.startsWith("radio-a-") || typeof value !== "string") throw new Error("备份包含不支持的数据，尚未修改本地数据。");
        validateRecord(key, value);
      }
    }
    return data;
  }
  function preview() {
    invalidate();
    try {
      pending = validate(byId("import-text").value);
      byId("import-preview").textContent = `校验通过：${describe(pending)}。确认后将完整替换当前学习数据。`;
      byId("import-preview").hidden = false;
      byId("apply-backup").disabled = false;
      byId("backup-status").textContent = "请核对备份内容，再确认导入。";
    } catch (error) {
      byId("backup-status").textContent = error instanceof SyntaxError ? "备份内容不是有效的 JSON，请检查是否复制完整。尚未修改本地数据。" : error.message;
    }
  }
  function replaceStorage(storage, records) {
    Object.keys(readStorage(storage)).forEach((key) => storage.removeItem(key));
    Object.entries(records).forEach(([key, value]) => storage.setItem(key, value));
  }
  byId("open-backup").addEventListener("click", () => {
    invalidate();
    byId("backup-status").textContent = "";
    byId("import-text").value = "";
    byId("import-file").value = "";
    refreshExport();
    dialog.showModal();
  });
  byId("close-backup").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  byId("download-backup").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([exportText], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `radio-a-backup-${new Date().toLocaleDateString("sv-SE")}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  byId("copy-backup").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(exportText); byId("backup-status").textContent = "完整备份已复制，可到另一台设备粘贴导入。"; }
    catch {
      byId("export-text").focus();
      byId("export-text").select();
      byId("backup-status").textContent = document.execCommand("copy") ? "完整备份已复制。" : "自动复制不可用，已选中备份内容，请手动复制。";
    }
  });
  byId("paste-backup").addEventListener("click", async () => {
    invalidate();
    try { byId("import-text").value = await navigator.clipboard.readText(); preview(); }
    catch { byId("import-text").focus(); byId("backup-status").textContent = "无法自动读取剪贴板，请在导入框中手动粘贴，再点击校验备份。"; }
  });
  byId("import-text").addEventListener("input", () => { invalidate(); byId("backup-status").textContent = ""; });
  byId("validate-backup").addEventListener("click", preview);
  byId("import-file").addEventListener("change", async (event) => {
    invalidate();
    const file = event.target.files[0];
    if (!file) return;
    try { byId("import-text").value = await file.text(); preview(); }
    catch { byId("backup-status").textContent = "无法读取备份文件，请重新选择。"; }
  });
  byId("apply-backup").addEventListener("click", () => {
    if (!pending) return;
    let before;
    try { before = snapshot(); }
    catch { byId("backup-status").textContent = "无法读取当前数据，未执行导入。"; return; }
    try {
      replaceStorage(localStorage, pending.localStorage);
      replaceStorage(sessionStorage, pending.sessionStorage);
    } catch {
      try {
        replaceStorage(localStorage, before.localStorage);
        replaceStorage(sessionStorage, before.sessionStorage);
        byId("backup-status").textContent = "导入失败，原数据已恢复。浏览器可能没有足够的存储空间或禁止保存。";
      } catch {
        byId("backup-status").textContent = "导入失败，无法完整恢复原数据。上方导出内容仍是导入前的备份，请下载保存。";
      }
      return;
    }
    location.reload();
  });
  refreshExport();
})();
