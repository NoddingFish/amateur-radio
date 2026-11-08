const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const open = (file) => page.goto(pathToFileURL(path.join(__dirname, "..", file.split("?")[0])).href + (file.includes("?") ? `?${file.split("?")[1]}` : ""));
    const fits = async (selector) => page.locator(selector).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    });
    fs.mkdirSync(path.join(__dirname, "../tmp/layout"), { recursive: true });
    for (const [width, height] of [[1366, 768], [1440, 900], [1920, 1080], [1000, 768], [768, 900]]) {
      await page.setViewportSize({ width, height });
      await open("practice.html?question=3");
      assert.equal(await fits("#page-navigation"), true, `桌面切题操作应在屏幕内 ${width}`);
      assert.equal(await page.locator("#practice-sidebar").isHidden(), true, `桌面默认只展示题目 ${width}`);
      await page.locator("#open-question-navigation").click();
      assert.equal(await fits("#practice-navigation"), true, `导航弹窗应在屏幕内 ${width}`);
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false, `桌面不应整页纵向溢出 ${width}`);
      await page.locator('#options input[value="A"]').check();
      assert.equal(await fits("#page-navigation"), true, `提交后仍可直接切题 ${width}`);
      if (width >= 1000) assert.equal(await page.locator(".workspace > main").evaluate((node) => node.scrollHeight > node.clientHeight), false, `常规题提交后无需滚动 ${width}`);
      if (width === 1366) await page.screenshot({ path: path.join(__dirname, "../tmp/layout/practice-desktop.png") });
      await open("study.html");
      assert.equal(await page.locator("#topic-section").isHidden(), true);
      assert.equal(await page.locator("#study-overview").isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
      await page.locator("#topic-rules").click();
      assert.equal(await page.locator("#study-overview").isHidden(), true);
      assert.equal(await page.locator(".knowledge-card:visible").count(), 1);
      await page.locator('#group-nav button').nth(1).click();
      assert.equal(await page.locator(".knowledge-card:visible").getAttribute("id"), "group-g02");
      if (width === 1366) await page.screenshot({ path: path.join(__dirname, "../tmp/layout/study-desktop.png") });
      await page.locator("#topic-overview").click();
      assert.equal(await page.locator("#study-overview").isVisible(), true);
    }
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [760, 900]]) {
      await page.setViewportSize({ width, height });
      await open("practice.html?question=3");
      assert.equal(await page.locator("#practice-sidebar").isHidden(), true);
      await page.locator('[data-open-dialog="practice-navigation"]').click();
      assert.equal(await page.locator("#practice-navigation").evaluate((node) => node.matches(":modal")), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#practice-sidebar").isHidden(), true);
      await page.locator('[data-open-dialog="practice-navigation"]').click();
      await page.locator("#jump-input").fill("22");
      await page.locator("#jump-form button").click();
      assert.equal(await page.locator("#question-number").innerText(), "第 022 题");
      assert.equal(await page.locator("#practice-sidebar").isHidden(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await open("study.html");
      assert.equal(await fits('[data-open-dialog="topic-menu"]'), true, "手机分类选择入口应在首屏");
      await page.locator('[data-open-dialog="topic-menu"]').click();
      await page.locator("#topic-electricity").click();
      assert.equal(await page.locator("#topic-menu").evaluate((node) => node.open), false);
      assert.equal(await page.locator(".knowledge-card:visible").count(), 0);
      await page.locator('[data-open-dialog="group-menu"]').click();
      await page.locator('[data-group="g65"]').click();
      assert.equal(await page.locator("#group-menu").evaluate((node) => node.open), false);
      assert.equal(await page.locator(".knowledge-card:visible").getAttribute("id"), "group-g65");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width === 390) {
        await page.screenshot({ path: path.join(__dirname, "../tmp/layout/study-mobile.png") });
        await page.locator('[data-open-dialog="group-menu"]').click();
        await page.screenshot({ path: path.join(__dirname, "../tmp/layout/group-dialog-mobile.png") });
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForFunction(() => !document.querySelector("#group-menu").open);
        assert.equal(await page.locator("#group-menu").evaluate((node) => node.open), false);
      }
    }
    assert.deepEqual(errors, []);
    console.log("PASS: 五种桌面尺寸、四种手机尺寸、一屏操作、概览与分类分离、单组切换、弹窗选题与跳转、Esc 关闭、响应式切换、无横向溢出。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
