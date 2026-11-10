const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1366, height: 900 } });
    await context.addInitScript(() => {
      window.testClipboard = "";
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text) => { window.testClipboard = text; },
        readText: async () => window.testClipboard,
      } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (file) => pathToFileURL(path.join(__dirname, "..", file)).href;
    const home = () => page.goto(url("index.html"));
    const storage = (tab = page) => tab.evaluate(() => {
      const read = (area) => Object.fromEntries(Object.keys(area).filter((key) => key.startsWith("radio-a-")).map((key) => [key, area.getItem(key)]));
      return { localStorage: read(localStorage), sessionStorage: read(sessionStorage) };
    });
    const open = () => page.locator("#open-backup").click();
    fs.mkdirSync(path.join(__dirname, "../tmp/backup"), { recursive: true });
    await home();
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("unrelated-application", "保留其他应用的数据");
      sessionStorage.setItem("unrelated-session", "保留其他会话数据");
      const bank = window.QUESTION_BANK;
      const number = (question) => bank.indexOf(question) + 1;
      const record = (questions) => ({ questionNumbers: questions.map(number), currentQuestion: number(questions[0]), states: Object.fromEntries(questions.map((question) => [question.id, { selected: question.answers, checked: true }])) });
      const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
      save("radio-a-collections-v1", { mistakes: [bank[0].id], favorites: [bank[2].id] });
      save("radio-a-search-history-v1", ["天线", "FM"]);
      save("radio-a-mastered-groups-v1", ["g01", "g65"]);
      const normal = record(bank);
      normal.states[bank[0].id] = { selected: ["A"], checked: false };
      save("radio-a-practice-v1-all", normal);
      for (const name of ["group-g01", "topic-rules", "day-1", "mistakes", "favorites"]) save(`radio-a-practice-v1-${name}`, record([bank[2]]));
      const examQuestions = [...bank.filter((question) => question.answers.length === 1).slice(0, 32), ...bank.filter((question) => question.answers.length > 1).slice(0, 8)];
      const exam = record(examQuestions);
      Object.entries(exam.states).forEach(([id, state]) => { state.checked = false; state.optionOrder = Object.keys(bank.find((question) => question.id === id).options); });
      exam.exam = { deadline: Date.now() + 2_400_000, submittedAt: null, timedOut: false };
      save("radio-a-exam-v1", exam);
      const archived = structuredClone(exam);
      archived.id = "archived-exam";
      archived.exam = { deadline: Date.now() - 1000, submittedAt: Date.now() - 1000, timedOut: true };
      Object.values(archived.states).forEach((state) => { state.checked = true; });
      save("radio-a-exam-history-v1", [archived]);
      save("radio-a-practice-settings-v1", { autoNext: false });
      localStorage.setItem("radio-a-future-setting", "保留未识别的旧版或未来设置");
      const matches = bank.filter((question) => [question.question, ...Object.values(question.options)].some((text) => text.includes("天线")));
      sessionStorage.setItem("radio-a-search-v1", JSON.stringify({ ...record(matches), searchKeyword: "天线" }));
      sessionStorage.setItem("radio-a-future-session", "临时设置");
    });
    await page.reload();
    const expected = await storage();
    await open();
    assert.equal(await page.locator("#data-dialog").evaluate((node) => node.matches(":modal")), true);
    const text = await page.locator("#export-text").inputValue();
    const data = JSON.parse(text);
    assert.equal(data.format, "radio-a-backup");
    assert.equal(data.version, 1);
    assert.deepEqual(data.localStorage, expected.localStorage);
    assert.deepEqual(data.sessionStorage, expected.sessionStorage);
    assert.match(await page.locator("#export-summary").innerText(), /搜索 2 条.*错题 1 题.*收藏 1 题.*已掌握 2 组.*练习进度 6 份.*考试 1 份.*临时搜索 1 份/);
    assert.match(await page.locator("#export-summary").innerText(), /考试记录 1 次/);
    assert.match(await page.locator("#data-summary").innerText(), /KB/);
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#download-backup").click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^radio-a-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.equal(fs.readFileSync(await download.path(), "utf8"), text);
    await page.locator("#copy-backup").click();
    assert.equal(await page.evaluate(() => window.testClipboard), text);
    assert.match(await page.locator("#backup-status").innerText(), /已复制/);
    assert.equal(await page.locator("#backup-status").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const dialog = document.getElementById("data-dialog").getBoundingClientRect();
      return rect.top >= dialog.top && rect.bottom <= dialog.bottom;
    }), true, "复制结果始终显示在弹窗可见范围");

    // 文件或粘贴内容校验之前、确认之前都不能修改现有数据。
    await page.evaluate(() => {
      for (const area of [localStorage, sessionStorage]) Object.keys(area).filter((key) => key.startsWith("radio-a-")).forEach((key) => area.removeItem(key));
      localStorage.setItem("radio-a-collections-v1", JSON.stringify({ mistakes: [], favorites: [] }));
      localStorage.setItem("radio-a-search-history-v1", JSON.stringify(["导入前"]));
      localStorage.setItem("radio-a-obsolete-setting", "导入时应被完整替换");
    });
    const beforeImport = await storage();
    await page.locator("#paste-backup").click();
    assert.equal(await page.locator("#apply-backup").isEnabled(), true);
    assert.deepEqual(await storage(), beforeImport);
    const invalid = ["{broken", JSON.stringify({ ...data, version: 99 }), JSON.stringify({ ...data, localStorage: { foreign: "value" } }), JSON.stringify({ ...data, localStorage: { "radio-a-collections-v1": JSON.stringify({ mistakes: "bad", favorites: [] }) } })];
    const archived = JSON.parse(data.localStorage["radio-a-exam-history-v1"])[0];
    for (const records of [{}, [null], [{ ...archived, states: {} }], [archived, archived]]) {
      invalid.push(JSON.stringify({ ...data, localStorage: { "radio-a-exam-history-v1": JSON.stringify(records) } }));
    }
    for (const value of invalid) {
      await page.locator("#import-text").fill(value);
      assert.equal(await page.locator("#apply-backup").isDisabled(), true);
      await page.locator("#validate-backup").click();
      assert.equal(await page.locator("#apply-backup").isDisabled(), true);
      assert.deepEqual(await storage(), beforeImport, "无效备份完全不写入");
    }
    await page.locator("#import-file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await page.waitForFunction(() => !document.getElementById("apply-backup").disabled);
    assert.deepEqual(await storage(), beforeImport, "选择文件仅展示摘要，不立即导入");
    await Promise.all([page.waitForEvent("load"), page.locator("#apply-backup").click()]);
    assert.deepEqual(await storage(), expected, "文件导入完整恢复两种存储，清除被替换的旧记录");
    assert.equal(await page.evaluate(() => localStorage.getItem("unrelated-application")), "保留其他应用的数据");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("unrelated-session")), "保留其他会话数据");
    assert.equal(await page.locator("#mistakes-count").innerText(), "1");
    assert.equal(await page.locator("#favorites-count").innerText(), "1");
    assert.equal(await page.locator("#mastered-count").innerText(), "2");
    await page.goto(url("practice.html"));
    assert.equal(await page.locator('#options input[value="A"]').isChecked(), true);
    assert.equal(await page.locator("#feedback").isHidden(), true, "未提交选项也能恢复");
    await page.goto(`${url("practice.html")}?exam=1`);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-exam-v1")).exam.deadline), JSON.parse(expected.localStorage["radio-a-exam-v1"]).exam.deadline, "考试不重置截止时间");

    // 剪贴板内容也可独立完成恢复。
    const pasted = await context.newPage();
    await pasted.goto(url("index.html"));
    await pasted.locator("#open-backup").click();
    await pasted.evaluate((value) => { window.testClipboard = value; }, text);
    await pasted.locator("#paste-backup").click();
    await Promise.all([pasted.waitForEvent("load"), pasted.locator("#apply-backup").click()]);
    assert.deepEqual(await storage(pasted), expected, "粘贴导入也恢复全部永久与临时数据");
    await pasted.close();

    await home();
    await open();
    const beforeFailure = await storage();
    await page.locator("#import-text").fill(text);
    await page.locator("#validate-backup").click();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      let failed = false;
      Storage.prototype.setItem = function (key, value) {
        if (this === sessionStorage && key === "radio-a-search-v1" && !failed) { failed = true; throw new DOMException("quota", "QuotaExceededError"); }
        return original.call(this, key, value);
      };
    });
    await page.locator("#apply-backup").click();
    assert.match(await page.locator("#backup-status").innerText(), /原数据已恢复/);
    assert.deepEqual(await storage(), beforeFailure, "后半段写入失败时回滚本地与临时数据");
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => { throw new Error("denied"); };
      navigator.clipboard.readText = async () => { throw new Error("denied"); };
      document.execCommand = () => false;
    });
    await page.locator("#copy-backup").click();
    assert.match(await page.locator("#backup-status").innerText(), /手动复制/);
    assert.equal(await page.locator("#export-text").evaluate((node) => node.selectionStart === 0 && node.selectionEnd === node.value.length), true);
    await page.locator("#paste-backup").click();
    assert.match(await page.locator("#backup-status").innerText(), /手动粘贴/);
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      const box = await page.locator("#data-dialog").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844, `备份弹窗适配 ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 390) await page.screenshot({ path: path.join(__dirname, "../tmp/backup/mobile.png") });
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#data-dialog").isHidden(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: 全部永久与临时数据备份、实际大小、JSON 文件下载及往返导入、复制粘贴恢复、校验前不写入、无效备份拒绝、旧数据完整替换、其他应用数据保留、练习及考试恢复、写入失败回滚、剪贴板降级和四种屏宽。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
