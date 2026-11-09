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
    const url = pathToFileURL(path.join(__dirname, "../practice.html")).href;
    const open = (query) => page.goto(url + query);
    fs.mkdirSync(path.join(__dirname, "../tmp/controls"), { recursive: true });
    for (const [width, height] of [[320, 568], [390, 844], [768, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      for (const number of [3, 647, 1]) {
        await open(`?question=${number}`);
        const nav = await page.locator("#page-navigation").boundingBox();
        assert.ok(Math.abs(nav.y + nav.height - height) <= 1, `切题栏固定在屏幕底部 ${width} / ${number}`);
        await page.locator("#question-title").evaluate((node) => { node.textContent = "长题干用于验证固定切题栏。".repeat(100); });
        await page.locator("#similar-practice").scrollIntoViewIfNeeded();
        const after = await page.locator("#page-navigation").boundingBox();
        assert.equal(after.y, nav.y, "长题与滚动不改变按钮位置");
        const last = await page.locator("#similar-practice").boundingBox();
        assert.ok(last.y + last.height <= after.y + 1, "滚到底部可以看到题卡末尾，不被切题栏遮挡");
      }
      await open("?question=3");
      await page.screenshot({ path: path.join(__dirname, `../tmp/controls/fixed-${width}.png`) });
      await page.locator("#options input[value=\"A\"]").check();
      const submitted = await page.locator("#page-navigation").boundingBox();
      assert.ok(Math.abs(submitted.y + submitted.height - height) <= 1, "判分后切题栏仍固定");
      await page.locator("#open-question-navigation").click();
      assert.equal(await page.locator("#practice-navigation").evaluate((node) => node.matches(":modal")), true);
      await page.keyboard.press("Escape");
    }

    const touch = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await touch.newPage();
    mobile.on("pageerror", (error) => errors.push(error.message));
    const cdp = await touch.newCDPSession(mobile);
    const position = () => mobile.locator("#page-position").innerText();
    const swipe = async (selector, dx, dy = 0) => {
      const box = await mobile.locator(selector).first().boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + Math.min(box.height / 2, 20);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 5; step++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 5, y: y + dy * step / 5 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await mobile.goto(url + "?question=3");
    await swipe("#question-title", -40, 8);
    assert.equal(await position(), "4 / 683", "40 像素的短滑可切下一题");
    await swipe("#question-title", 40, 8);
    assert.equal(await position(), "3 / 683", "短滑可返回上一题");
    await mobile.goto(url + "?question=1");
    await swipe("#options input", -45);
    assert.equal(await position(), "2 / 683", "从选项控件上起滑也能切题");
    assert.equal(await mobile.locator("#options input:checked").count(), 0, "滑动不会误选新题");
    await mobile.locator("#previous-question").click();
    assert.equal(await position(), "1 / 683");
    assert.equal(await mobile.locator("#options input:checked").count(), 0, "滑动不会误选原题");
    await swipe("#options input", -20);
    assert.equal(await mobile.locator("#options input:checked").count(), 0, "不足切题距离的横向拖动也不误选");
    await mobile.locator("#options input").first().tap();
    await mobile.waitForFunction(() => document.querySelectorAll("#options input:checked").length === 1, null, { timeout: 1500 });
    assert.equal(await mobile.locator("#options input:checked").count(), 1, "正常轻触仍可选择选项");
    await swipe("#question-title", -20);
    assert.equal(await position(), "1 / 683", "轻微移动不切题");
    await swipe("#question-title", -12, -90);
    assert.equal(await position(), "1 / 683", "纵向手势不切题");
    await mobile.locator(".option-text").last().evaluate((node) => { node.textContent = "长选项用于检查浏览器纵向滚动。".repeat(80); });
    await swipe("#question-title", -8, -80);
    await mobile.waitForFunction(() => scrollY > 0, null, { timeout: 1500 });
    assert.equal(await position(), "1 / 683", "保留原生纵向滚动");
    await mobile.locator("#toggle-hint").click();
    await swipe("#question-hint", -50);
    assert.equal(await position(), "1 / 683", "提示弹窗中不切题");
    await mobile.locator("#close-hint").click();
    await mobile.goto(url + "?question=683");
    await swipe("#question-title", -45);
    assert.equal(await position(), "683 / 683", "最后一题不越界");
    assert.deepEqual(errors, []);
    console.log("PASS: 四种屏幕底部固定切题栏、长题滚动及判分不移位、内容无遮挡、真实短滑与选项控件起滑、轻触选项、纵向及弹窗手势隔离、首尾边界。");
    await touch.close();
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
