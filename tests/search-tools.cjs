const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (file) => pathToFileURL(path.join(__dirname, "..", file)).href;
    const home = () => page.goto(url("index.html"));
    const openSearch = async (tab = page) => {
      if (await tab.locator("#toggle-search").getAttribute("aria-expanded") === "false") await tab.locator("#toggle-search").click();
    };
    const records = () => page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-search-history-v1") || "[]"));
    const historyLinks = () => page.locator("#history-list a").allTextContents();
    fs.mkdirSync(path.join(__dirname, "../tmp/search-tools"), { recursive: true });
    await home();
    await openSearch();
    await page.locator("#search-input").click();
    assert.equal(await page.locator("#history-empty").isVisible(), true);
    for (const keyword of ["天线", "呼号", "功率", "频率", "电阻", "电压", "FM", "fm"]) {
      await page.goto(`${url("practice.html")}?search=${encodeURIComponent(keyword)}`);
    }
    assert.deepEqual(await records(), ["fm", "电压", "电阻", "频率", "功率", "呼号", "天线"], "大小写去重、最近使用置顶、保存全部记录");
    await home();
    assert.equal(await page.locator("#search-history").isHidden(), true);
    const dashboardTop = (await page.locator(".home-dashboard").boundingBox()).y;
    await openSearch();
    await page.locator("#search-input").click();
    assert.equal((await page.locator(".home-dashboard").boundingBox()).y, dashboardTop, "搜索记录以浮层显示，不撑高首页");
    assert.deepEqual(await historyLinks(), ["fm", "电压", "电阻", "频率", "功率"]);
    await page.locator("#history-toggle").click();
    assert.equal(await page.locator("#history-title").innerText(), "全部搜索记录");
    assert.equal((await historyLinks()).length, 7);
    const tags = await page.locator("#history-list li").evaluateAll((nodes) => nodes.map((node) => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
    assert.equal(tags[0].y, tags[1].y, "关键词标签在同一行平铺");
    assert.ok(tags[1].x > tags[0].x);
    await page.screenshot({ path: path.join(__dirname, "../tmp/search-tools/history-desktop.png"), fullPage: true });
    await page.getByRole("button", { name: "删除搜索记录：电压", exact: true }).click();
    assert.equal((await records()).includes("电压"), false);
    await page.reload();
    await openSearch();
    await page.locator("#search-input").click();
    assert.equal((await historyLinks()).includes("电压"), false, "删除跨刷新保留");
    await page.locator("#history-toggle").click();
    await page.locator("#history-list a").filter({ hasText: /^天线$/ }).click();
    await page.waitForURL(/practice\.html\?search=/);
    assert.equal(new URL(page.url()).searchParams.get("search"), "天线");
    assert.equal((await records())[0], "天线", "点击历史记录直接再搜并置顶");
    await home();
    await openSearch();
    await page.locator("#search-input").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#search-history").isHidden(), true);
    await openSearch();
    await page.locator("#search-input").click();
    assert.equal(await page.locator("#search-input").getAttribute("aria-expanded"), "true");
    await page.locator(".home-heading").click();
    assert.equal(await page.locator("#search-history").isHidden(), true);
    await openSearch();
    await page.locator("#search-input").click();
    await page.locator("#history-clear").click();
    assert.deepEqual(await records(), []);
    assert.equal(await page.locator("#history-empty").isVisible(), true);
    await page.reload();
    assert.deepEqual(await records(), [], "清空跨刷新保留");

    async function selectText(tab, selector, keyword) {
      await tab.locator(selector).first().evaluate((node, text) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let item;
        while ((item = walker.nextNode())) {
          const start = item.textContent.indexOf(text);
          if (start < 0) continue;
          const range = document.createRange();
          range.setStart(item, start);
          range.setEnd(item, start + text.length);
          const selection = getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          break;
        }
      }, keyword);
    }
    await page.goto(`${url("practice.html")}?question=3`);
    await selectText(page, "#source-id", "原题号");
    assert.equal(await page.locator("#selection-search").isHidden(), true, "仅题干和选项提供搜索图标");
    await selectText(page, "#question-title", "我国");
    await page.locator("#selection-search").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#selection-search").isHidden(), true);
    const rect = await page.locator(".option-text").first().evaluate((node) => {
      const range = document.createRange();
      const start = node.firstChild.textContent.indexOf("无线电");
      range.setStart(node.firstChild, start);
      range.setEnd(node.firstChild, start + 3);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.locator("#selection-search").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => getSelection().toString()), "无线电");
    assert.equal(await page.locator("#options input:checked").count(), 0, "拖选选项文字不误答题");
    await page.screenshot({ path: path.join(__dirname, "../tmp/search-tools/selection-desktop.png") });
    await page.locator("#selection-search").click();
    await page.waitForURL(/practice\.html\?search=/);
    assert.equal(new URL(page.url()).searchParams.get("search"), "无线电");
    assert.ok(await page.locator(".search-highlight").count());
    assert.equal((await records())[0], "无线电", "选中文字搜索也保存记录");

    const touch = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await touch.newPage();
    mobile.on("pageerror", (error) => errors.push(error.message));
    await mobile.goto(`${url("practice.html")}?question=3`);
    await selectText(mobile, "#question-title", "我国");
    await mobile.locator("#selection-search").waitFor({ state: "visible" });
    const cdp = await touch.newCDPSession(mobile);
    const textBox = await mobile.locator(".option-text").first().boundingBox();
    const start = { x: textBox.x + textBox.width / 2, y: textBox.y + 12 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (let step = 1; step <= 5; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - step * 10, y: start.y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    assert.equal(await mobile.locator("#page-position").innerText(), "3 / 683", "已有文字选区时拖动不切题");
    assert.equal(await mobile.locator("#options input:checked").count(), 0, "选区手势不误选答案");
    await selectText(mobile, "#question-title", "我国");
    await mobile.locator("#selection-search").waitFor({ state: "visible" });
    const icon = await mobile.locator("#selection-search").boundingBox();
    assert.ok(icon.x >= 0 && icon.x + icon.width <= 390 && icon.y >= 0 && icon.y + icon.height < 779, "手机图标在屏幕内且不遮挡固定切题栏");
    await mobile.screenshot({ path: path.join(__dirname, "../tmp/search-tools/selection-mobile.png") });
    await mobile.locator("#selection-search").tap();
    await mobile.waitForURL(/practice\.html\?search=/);
    assert.equal(new URL(mobile.url()).searchParams.get("search"), "我国");
    await mobile.goto(url("index.html"));
    await openSearch(mobile);
    await mobile.locator("#search-input").tap();
    assert.deepEqual(await mobile.locator("#history-list a").allTextContents(), ["我国"]);
    await mobile.evaluate(() => window.radioSearchHistory.save(["我国", "天线", "呼号", "功率", "频率", "电阻", "很长的搜索关键词用来检查标签换行和弹窗边界"]));
    await openSearch(mobile);
    await mobile.locator("#search-input").tap();
    await mobile.locator("#history-toggle").tap();
    for (const width of [320, 390]) {
      await mobile.setViewportSize({ width, height: 568 });
      const panel = await mobile.locator("#search-history").boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width && panel.y >= 0 && panel.y + panel.height <= 568, `手机浮层保持在屏幕内 ${width}`);
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await mobile.screenshot({ path: path.join(__dirname, "../tmp/search-tools/history-mobile.png"), fullPage: true });
    await mobile.locator("#history-close").tap();
    assert.equal(await mobile.locator("#search-history").isHidden(), true);
    await touch.close();
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`${url("practice.html")}?search=FM`);
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存搜索记录/);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log("PASS: 搜索记录持久化与去重、最近及全部记录、单条删除与清空、记录再搜、键盘收起、真实拖选文字与放大镜搜索、选项不误选、手机触摸搜索与布局。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
