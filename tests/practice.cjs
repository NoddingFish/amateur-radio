const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let page = await context.newPage();
    const errors = [];
    context.on("page", (tab) => tab.on("pageerror", (error) => errors.push(error.message)));
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (query = "") => pathToFileURL(path.join(__dirname, "../index.html")).href + query;
    const open = (query = "") => page.goto(url(query));
    const position = () => page.locator("#page-position").innerText();
    const select = (key) => page.locator(`#options input[value="${key}"]`).check();
    const press = (key) => page.keyboard.press(key);
    const waitForNumber = (number) => page.waitForFunction((value) => document.querySelector("#question-number").textContent === `第 ${String(value).padStart(3, "0")} 题`, number);

    await open();
    assert.equal(await page.locator("#auto-next").isChecked(), true);
    await press("Enter");
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    await press("ArrowLeft");
    assert.equal(await position(), "1 / 683");
    await press("ArrowRight");
    await press("ArrowRight");
    assert.equal(await position(), "3 / 683");
    await select("A");
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    await waitForNumber(4);
    await page.reload();
    assert.equal(await position(), "4 / 683");
    assert.equal(await page.locator("#answered-count").innerText(), "1");
    await press("ArrowLeft");
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    await page.locator("#auto-next").uncheck();
    await page.reload();
    assert.equal(await page.locator("#auto-next").isChecked(), false);

    // 未提交的多选、判分结果和当前位置均应跨刷新、重新打开保留。
    await open("?question=1");
    await select("A");
    await page.reload();
    assert.equal(await page.locator('#options input[value="A"]').isChecked(), true);
    assert.equal(await page.locator("#feedback").isHidden(), true);
    await select("C");
    await press("Enter");
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    assert.equal(await position(), "1 / 683");
    await page.close();
    page = await context.newPage();
    await open();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    assert.equal(await page.locator("#correct-count").innerText(), "2");

    // 题号输入保留原生方向键和回车行为，不触发答题快捷键。
    await page.locator("#jump-input").fill("3");
    await press("ArrowLeft");
    await press("ArrowRight");
    assert.equal(await position(), "1 / 683");
    await press("Enter");
    assert.equal(await position(), "3 / 683");
    await page.locator("#retry-answer").click();
    await select("B");
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    await page.reload();
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    assert.equal(await page.locator("#incorrect-count").innerText(), "1");

    // 手动切题、重做和关闭开关必须取消尚未执行的自动跳题。
    await page.locator("#auto-next").check();
    await page.locator("#retry-answer").click();
    await select("A");
    await press("ArrowLeft");
    await page.waitForTimeout(1100);
    assert.equal(await position(), "2 / 683");
    await open("?question=3");
    await page.locator("#retry-answer").click();
    await select("A");
    await page.locator("#retry-answer").click();
    await page.waitForTimeout(1100);
    assert.equal(await position(), "3 / 683");
    assert.equal(await page.locator("#feedback").isHidden(), true);
    await select("A");
    await page.locator("#auto-next").uncheck();
    await page.waitForTimeout(1100);
    assert.equal(await position(), "3 / 683");

    await open("?question=1");
    await page.locator("#retry-answer").click();
    await page.locator("#auto-next").check();
    await select("A");
    await select("C");
    await press("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await waitForNumber(2);
    assert.equal(await page.locator("#feedback").isHidden(), true);
    await open("?question=683");
    const lastAnswers = await page.evaluate(() => window.QUESTION_BANK.at(-1).answers);
    for (const key of lastAnswers) await select(key);
    if (lastAnswers.length > 1) await press("Enter");
    await page.waitForTimeout(1100);
    assert.equal(await position(), "683 / 683");
    assert.equal(await page.locator("#next-question").isDisabled(), true);
    await press("ArrowRight");
    assert.equal(await position(), "683 / 683");

    await open("?mixed=1");
    const mixedNumbers = await page.locator("#question-nav button").allTextContents();
    await page.locator("#start-exam").click();
    const answers = await page.evaluate(() => window.QUESTION_BANK[Number(document.querySelector("#question-nav button").dataset.questionNumber) - 1].answers);
    for (const key of answers) await select(key);
    await press("ArrowRight");
    await page.reload();
    assert.deepEqual(await page.locator("#question-nav button").allTextContents(), mixedNumbers);
    assert.equal(await position(), "2 / 40");
    assert.equal(await page.locator("#answered-count").innerText(), "1");
    await open("?group=g01");
    const groupCount = await page.locator("#question-nav button").count();
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    await select("A");
    await press("ArrowRight");
    await page.reload();
    assert.equal(await position(), `2 / ${groupCount}`);
    await press("ArrowLeft");
    assert.equal(await page.locator('#options input[value="A"]').isChecked(), true);

    fs.mkdirSync(path.join(__dirname, "../tmp/practice"), { recursive: true });
    await open("?question=3");
    await page.screenshot({ path: path.join(__dirname, "../tmp/practice/desktop.png"), fullPage: true });
    for (const width of [320, 375, 390, 760, 768, 1000, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `practice overflow at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open("?question=647");
    const nav = await page.locator(".page-navigation").boundingBox();
    assert.ok(nav.y >= 0 && nav.y + nav.height <= 844, "手机底部切题栏应保持可见");
    await page.locator('.practice-settings .mobile-practice-link').click();
    await page.locator('#question-nav button').filter({ hasText: /^3$/ }).click();
    assert.equal(await position(), "3 / 683");
    const card = await page.locator("#question-card").boundingBox();
    assert.equal(await page.locator("#practice-navigation").evaluate((dialog) => dialog.open), false);
    assert.ok(card.y >= 0 && card.y < 844, "手机选题后关闭弹窗并显示题目");
    await page.screenshot({ path: path.join(__dirname, "../tmp/practice/mobile.png") });

    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touchPage = await touch.newPage();
    await touchPage.goto(url("?question=3"));
    await touchPage.locator('#options .option').first().tap();
    assert.match(await touchPage.locator("#feedback").innerText(), /回答正确/);
    await touchPage.waitForFunction(() => document.querySelector("#page-position").textContent === "4 / 683");
    await touchPage.locator("#previous-question").tap();
    assert.equal(await touchPage.locator("#page-position").innerText(), "3 / 683");
    await touch.close();

    // 损坏记录和不可用的本地存储不能中断答题。
    await page.evaluate(() => localStorage.setItem("radio-a-practice-v1-all", "{broken"));
    await open();
    assert.equal(await position(), "1 / 683");
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error("storage blocked"); };
      Storage.prototype.setItem = () => { throw new Error("storage blocked"); };
    });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(url("?question=3"));
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存/);
    await blockedPage.locator('#options input[value="A"]').check();
    assert.match(await blockedPage.locator("#feedback").innerText(), /回答正确/);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log("PASS: 左右键、输入框键盘隔离、单选自动提交、多选回车提交、自动下一题开关与取消、首尾边界、作答与位置持久化、模拟考试恢复、练习记录隔离、七种屏宽、手机导航与触屏操作、存储异常降级。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
