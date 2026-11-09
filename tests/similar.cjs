const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.join(__dirname, "../practice.html")).href;
    const open = (query) => page.goto(url + query);
    await open("?question=3");
    const guide = await page.evaluate(() => window.STUDY_GUIDE);
    assert.equal(guide.groups.flatMap((group) => group.question_numbers).length, 683);
    for (const group of guide.groups) {
      await open(`?question=${group.question_numbers[0]}`);
      assert.equal(await page.locator("#similar-practice").isVisible(), true);
      assert.equal(await page.locator("#similar-topic").innerText(), group.title);
      assert.equal(await page.locator("#similar-count").innerText(), `· ${group.question_numbers.length} 题`);
      const link = new URL(await page.locator("#practice-similar").getAttribute("href"), url);
      assert.equal(link.searchParams.get("group"), group.id);
      assert.equal(Number(link.searchParams.get("question")), group.question_numbers[1], "先练另一道同类题");
    }
    await open("?question=3");
    await page.locator("#practice-similar").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/group=g01/);
    assert.equal(await page.locator("#practice-mode").innerText(), "专题练习");
    assert.deepEqual(await page.locator("#question-nav button").allTextContents(), ["1", "2", "3", "4", "5", "21", "22"]);
    assert.equal(await page.locator("#question-number").innerText(), "第 001 题");
    assert.equal(await page.locator("#options input:checked").count(), 0);
    await page.locator('#options input[value="A"]').check();
    await page.locator('#options input[value="C"]').check();
    await page.locator("#check-answer").click();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    const currentUrl = page.url();
    const currentProgress = await page.evaluate(() => localStorage.getItem("radio-a-practice-v1-group-g01"));
    for (const keyboard of [false, true]) {
      let message;
      page.once("dialog", async (dialog) => { message = dialog.message(); await dialog.accept(); });
      if (keyboard) {
        await page.locator("#practice-similar").focus();
        await page.keyboard.press("Enter");
      } else await page.locator("#practice-similar").click();
      assert.equal(message, "已经在同类练习中了。", "同组内再次点击仅显示提示");
      await page.clock.runFor(1000);
      assert.equal(page.url(), currentUrl, "提示后不跳题或重新进入练习");
      assert.equal(await page.evaluate(() => localStorage.getItem("radio-a-practice-v1-group-g01")), currentProgress, "提示不改变作答与进度");
      assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    }
    await page.reload();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/, "沿用现有专题作答进度");
    await page.locator("#toggle-favorite").click();
    for (const query of ["?search=天线", "?collection=favorites", "?group=g03", "?topic=rules", "?day=1"]) {
      await open(query);
      assert.equal(await page.locator("#practice-similar").isVisible(), true, `各种练习提供入口 ${query}`);
    }
    fs.mkdirSync(path.join(__dirname, "../tmp/similar"), { recursive: true });
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      await open("?question=647");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `同类入口不横向溢出 ${width}`);
      if (width === 390) await page.screenshot({ path: path.join(__dirname, "../tmp/similar/mobile.png"), fullPage: true });
    }
    await open("?exam=1");
    assert.equal(await page.locator("#practice-similar").isHidden(), true);
    await page.locator("#start-exam").click();
    assert.equal(await page.locator("#practice-similar").isHidden(), true, "考试中隐藏入口");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#submit-exam").click();
    assert.equal(await page.locator("#practice-similar").isVisible(), true, "交卷后可以练同类");
    await page.locator("#practice-similar").click();
    assert.equal(await page.locator("#practice-mode").innerText(), "专题练习");
    assert.deepEqual(errors, []);
    console.log("PASS: 全部 70 知识点组关联、键盘进入同类练习、同组题目与判分、进度恢复、多模式入口、手机布局、考试交卷前隐藏及交卷后练习。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
