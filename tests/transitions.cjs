const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, isMobile: false, hasTouch: true });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.join(__dirname, "../practice.html")).href;
    const open = (query = "?question=3") => page.goto(url + query);
    const position = () => page.locator("#page-position").innerText();
    const frame = () => page.evaluate(() => {
      const stage = document.getElementById("question-stage");
      const card = document.getElementById("question-card");
      const copy = stage.querySelector(".question-transition-copy");
      const animations = [card, copy].flatMap((node) => node?.getAnimations() || []);
      animations.forEach((animation) => { animation.pause(); animation.currentTime = 100; });
      const x = (node) => new DOMMatrix(getComputedStyle(node).transform).m41;
      return { count: animations.length, incoming: x(card), outgoing: copy ? x(copy) : null,
        previous: copy?.querySelector(".question-number").textContent,
        hidden: copy?.getAttribute("aria-hidden"), inert: copy?.inert,
        copiedIds: copy?.querySelectorAll("[id], [name]").length,
        titleStyleMatches: copy && getComputedStyle(copy.querySelector(".question-title")).fontSize === getComputedStyle(card.querySelector(".question-title")).fontSize,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const finish = () => page.evaluate(async () => {
      const animations = document.getElementById("question-stage").getAnimations({ subtree: true });
      animations.forEach((animation) => animation.finish());
      await Promise.all(animations.map((animation) => animation.finished));
    });
    const checkFrame = async (direction, previous) => {
      const state = await frame();
      assert.equal(state.count, 2, "旧题与新题同时移动");
      assert.ok(state.incoming * direction > 0 && state.outgoing * direction < 0, JSON.stringify(state));
      assert.equal(state.previous, previous);
      assert.equal(state.hidden, "true");
      assert.equal(state.inert, true, "旧题只用于显示，不可操作");
      assert.equal(state.copiedIds, 0, "动画期间不产生重复题目 ID 或答案表单名称");
      assert.equal(state.titleStyleMatches, true);
      assert.equal(state.overflow, false, "移动不产生横向页面滚动");
    };
    fs.mkdirSync(path.join(__dirname, "../tmp/transitions"), { recursive: true });
    await open();
    await page.evaluate(() => { document.getElementById("next-question").click(); });
    assert.equal(await position(), "4 / 683");
    await checkFrame(1, "第 003 题");
    await page.screenshot({ path: path.join(__dirname, "../tmp/transitions/next-desktop.png") });
    await finish();
    assert.equal(await page.locator(".question-transition-copy").count(), 0);
    assert.equal(await page.locator("#question-stage").evaluate((node) => node.style.minHeight), "");
    await page.keyboard.press("ArrowLeft");
    await checkFrame(-1, "第 004 题");
    await finish();
    await page.evaluate(() => {
      for (const id of ["next-question", "next-question", "next-question", "previous-question"]) document.getElementById(id).click();
    });
    assert.equal(await position(), "5 / 683", "连续切题按最后一次操作显示");
    assert.equal(await page.locator(".question-transition-copy").count(), 1, "旧动画及时清理");
    await checkFrame(-1, "第 006 题");
    await finish();
    await page.locator("#next-question").click();
    await page.waitForFunction(() => !document.querySelector(".question-transition-copy"));
    assert.equal(await page.locator("#question-stage").evaluate((node) => node.style.minHeight), "", "自然结束后恢复题卡高度");

    await page.setViewportSize({ width: 390, height: 844 });
    await open();
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (dx) => {
      const box = await page.locator("#question-title").boundingBox();
      const x = dx < 0 ? box.x + box.width - 25 : box.x + 25;
      const y = box.y + 15;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 5; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 5, y }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await swipe(-150);
    await checkFrame(1, "第 003 题");
    await page.screenshot({ path: path.join(__dirname, "../tmp/transitions/next-mobile.png") });
    await finish();
    assert.equal(await page.locator("#options input:checked").count(), 0);
    await swipe(150);
    await checkFrame(-1, "第 004 题");
    await finish();
    await page.locator('#options input[value="A"]').check();
    await page.waitForFunction(() => document.getElementById("page-position").textContent === "4 / 683");
    await checkFrame(1, "第 003 题");
    await finish();
    await open("?question=1");
    await swipe(150);
    assert.equal(await page.locator(".question-transition-copy").count(), 0, "题库边界不产生无效过渡");
    await open("?question=683");
    await swipe(-150);
    assert.equal(await page.locator(".question-transition-copy").count(), 0);
    await open("?exam=1");
    await page.locator("#start-exam").click();
    await page.locator("#options input").first().check();
    await page.locator("#next-question").click();
    await checkFrame(1, "第 001 题");
    await finish();
    await page.locator("#previous-question").click();
    await checkFrame(-1, "第 002 题");
    await finish();
    assert.equal(await page.locator("#options input:checked").count(), 1, "动画副本不影响考试原题的作答");
    await open("?question=683");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#previous-question").click();
    assert.equal(await position(), "682 / 683");
    assert.equal(await page.locator(".question-transition-copy").count(), 0, "尊重系统减少动态效果设置");
    assert.deepEqual(errors, []);
    console.log("PASS: 双题卡同步左右移动、按钮及方向键、真实触屏滑动、自动切题、连续操作、动画清理、题库边界、无重复 ID 与表单串选、无横向溢出、减少动态效果。");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
