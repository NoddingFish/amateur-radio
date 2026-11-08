const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (query = "") => pathToFileURL(path.join(__dirname, "../practice.html")).href + query;
    const open = (query = "") => page.goto(url(query));
    const numbers = () => page.locator("#question-nav button").allTextContents();
    const select = (key) => page.locator(`#options input[value="${key}"]`).check();
    const count = (name) => page.evaluate((key) => String(JSON.parse(localStorage.getItem("radio-a-collections-v1"))[key].length), name);
    await open();
    await page.evaluate(() => {
      localStorage.clear();
      const bank = window.QUESTION_BANK;
      localStorage.setItem("radio-a-practice-v1-all", JSON.stringify({
        currentQuestion: 3,
        states: {
          [bank[0].id]: { selected: ["A"], checked: true },
          [bank[2].id]: { selected: ["B"], checked: true },
          [bank[3].id]: { selected: bank[3].answers, checked: true },
        },
      }));
    });
    await page.reload();
    assert.equal(await count("mistakes"), "2", "首次导入旧错题，不导入答对记录");
    await page.locator("#toggle-favorite").click();
    assert.equal(await count("favorites"), "1");
    await page.reload();
    assert.equal(await page.locator("#toggle-favorite").getAttribute("aria-pressed"), "true");
    await open("?group=g01&question=1");
    await page.locator("#toggle-favorite").click();
    assert.equal(await count("favorites"), "2", "不同练习共用收藏");
    await page.goto(pathToFileURL(path.join(__dirname, "../index.html")).href);
    assert.equal(await page.locator("#mistakes-count").innerText(), "2", "首页显示练习收录的错题数量");
    assert.equal(await page.locator("#favorites-count").innerText(), "2", "首页显示同一份收藏数量");
    await page.locator('.entry-card[href="practice.html?collection=favorites"]').click();
    assert.equal(await page.locator("#question-card").isVisible(), true);
    assert.deepEqual(await numbers(), ["1", "2"]);
    assert.equal(await page.locator("#feedback").isHidden(), true, "收藏练习独立作答，不预先显示答案");
    await select("A");
    await page.reload();
    assert.equal(await page.locator('#options input[value="A"]').isChecked(), true);
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#question-number").innerText(), "第 002 题");
    assert.match(await page.locator("#source-id").innerText(), /题库第 3 题/);
    await page.locator("#open-question-navigation").click();
    await page.locator("#jump-input").fill("1");
    await page.locator("#jump-form button").click();
    assert.equal(await page.locator("#question-number").innerText(), "第 001 题", "收藏按集合内序号跳转");
    await page.locator("#next-question").click();
    await page.reload();
    assert.equal(await page.locator("#question-number").innerText(), "第 002 题", "刷新保留收藏位置");

    await page.locator(".brand").click();
    await page.locator('.entry-card[href="practice.html?collection=mistakes"]').click();
    assert.deepEqual(await numbers(), ["1", "2"]);
    assert.equal(await page.locator("#options input:checked").count(), 0, "错题练习独立于收藏和原练习");
    await select("A");
    await page.keyboard.press("Enter");
    assert.equal(await count("mistakes"), "2", "同一道题答错不重复收录");
    await page.locator("#retry-answer").click();
    await select("A");
    await select("C");
    await page.locator("#check-answer").click();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    assert.equal(await count("mistakes"), "2", "答对后保留错题");
    await page.keyboard.press("ArrowRight");
    await page.locator("#remove-mistake").click();
    assert.deepEqual(await numbers(), ["1"]);
    assert.equal(await page.locator("#page-position").innerText(), "1 / 1");
    assert.equal(await page.locator("#question-nav .answered-correct").count(), 1, "移除后正确保留其余题目的状态");
    await page.locator("#remove-mistake").click();
    assert.equal(await page.locator("#empty-collection").isVisible(), true);
    assert.equal(await page.locator("#question-card").isHidden(), true);
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    assert.equal(await count("favorites"), "2", "移出错题不影响收藏");
    await page.reload();
    assert.equal(await count("mistakes"), "0", "移出的旧错题不会再次导入");
    for (const key of ["ArrowLeft", "ArrowRight", "Enter"]) await page.keyboard.press(key);
    assert.equal(await page.locator("#empty-collection").isVisible(), true);

    await open("?question=3");
    await page.locator("#retry-answer").click();
    await select("B");
    assert.equal(await count("mistakes"), "1", "移出后再次答错会重新收录");
    await open("?group=g01&question=1");
    await select("A");
    await page.locator("#check-answer").click();
    assert.equal(await count("mistakes"), "2", "专题练习的错题也会收录");

    await open("?collection=favorites&question=3");
    await select("A");
    await page.locator("#toggle-favorite").click();
    await page.clock.runFor(1100);
    assert.deepEqual(await numbers(), ["1"]);
    assert.equal(await page.locator("#page-position").innerText(), "1 / 1", "取消收藏会取消待执行的自动切题");
    await page.locator("#toggle-favorite").click();
    assert.equal(await page.locator("#empty-collection").isVisible(), true);
    await page.reload();
    assert.equal(await count("favorites"), "0");

    fs.mkdirSync(path.join(__dirname, "../tmp/collections"), { recursive: true });
    await open("?collection=mistakes");
    await page.screenshot({ path: path.join(__dirname, "../tmp/collections/desktop.png"), fullPage: true });
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [760, 900]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `错题本横向溢出：${width}`);
    }
    await page.setViewportSize({ width: 375, height: 667 });
    await page.reload();
    await page.waitForFunction(() => document.getElementById("question-card").getBoundingClientRect().top < innerHeight);
    await page.locator("#toggle-favorite").click();
    const card = await page.locator("#question-card").boundingBox();
    const navigation = await page.locator("#page-navigation").boundingBox();
    await page.screenshot({ path: path.join(__dirname, "../tmp/collections/mobile.png") });
    assert.ok(card.y >= 0 && card.y + card.height <= navigation.y, `手机常规题目的收藏与移出操作应完整显示：${JSON.stringify({ card, navigation })}`);
    await open("?collection=favorites");
    await page.locator("#toggle-favorite").click();
    assert.equal(await page.locator("#empty-collection").isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => localStorage.setItem("radio-a-collections-v1", JSON.stringify({ favorites: ["invalid"], mistakes: null })));
    await page.reload();
    assert.equal(await count("favorites"), "0");
    assert.deepEqual(errors, []);

    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(url("?question=3"));
    await blockedPage.locator("#toggle-favorite").click();
    assert.equal(await blockedPage.locator("#toggle-favorite").getAttribute("aria-pressed"), "true");
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存/);
    await blocked.close();
    console.log("PASS: 历史错题导入、跨模式收藏、独立练习与刷新恢复、错题去重与再次收录、答对保留、移出错题、取消收藏、移除时取消自动切题、空列表键盘行为、手机布局、异常存储提示。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
