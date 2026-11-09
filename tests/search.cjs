const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (file) => pathToFileURL(path.join(__dirname, "..", file)).href;
    const search = (keyword) => page.goto(`${url("practice.html")}?search=${encodeURIComponent(keyword)}`);
    fs.mkdirSync(path.join(__dirname, "../tmp/search"), { recursive: true });

    await page.goto(url("index.html"));
    await page.locator("#search-input").fill("   ");
    await page.locator('#search-form button[type="submit"]').click();
    assert.equal(new URL(page.url()).pathname.endsWith("index.html"), true, "空白关键词留在首页");
    assert.equal(await page.locator("#search-input").evaluate((node) => node.checkValidity()), false);
    await page.reload();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `首页搜索不横向溢出 ${width}`);
      if (width === 390) await page.screenshot({ path: path.join(__dirname, "../tmp/search/home-mobile.png"), fullPage: true });
    }
    await page.screenshot({ path: path.join(__dirname, "../tmp/search/home.png"), fullPage: true });
    await page.locator("#search-input").fill("  天线  ");
    await page.locator("#search-input").press("Enter");
    await page.waitForURL(/practice\.html\?search=/);
    assert.equal(new URL(page.url()).searchParams.get("search"), "天线");
    assert.equal(await page.locator("#practice-mode").innerText(), "搜索练习");
    const bank = await page.evaluate(() => window.QUESTION_BANK);
    const expected = bank.filter((question) => question.question.includes("天线") || Object.values(question.options).some((text) => text.includes("天线")));
    assert.equal(await page.locator("#question-nav button").count(), expected.length, "题干与选项均可命中，每题只收录一次");
    assert.equal(await page.locator("#page-position").innerText(), `1 / ${expected.length}`);
    assert.match(await page.locator("#practice-context").innerText(), /天线.*临时题库/);
    assert.equal(await page.locator("#options input:checked").count(), 0);

    async function checkHighlight(question, keyword) {
      assert.equal(await page.locator("#question-title").textContent(), question.question, "高亮保持原文");
      assert.deepEqual(await page.locator(".option-text").allTextContents(), Object.values(question.options));
      const marks = await page.locator("#question-title mark, .option-text mark").allTextContents();
      const occurrenceCount = [question.question, ...Object.values(question.options)].reduce((sum, text) => sum + text.toLowerCase().split(keyword.toLowerCase()).length - 1, 0);
      assert.equal(marks.length, occurrenceCount, "高亮全部出现位置");
      assert.ok(marks.every((text) => text.toLowerCase() === keyword.toLowerCase()));
      assert.ok(marks.length > 0);
    }
    await checkHighlight(expected[0], "天线");
    await page.locator("#open-question-navigation").click();
    await page.locator("#jump-input").fill("2");
    await page.locator("#jump-form button").click();
    assert.equal(await page.locator("#question-number").innerText(), "第 002 题");
    await checkHighlight(expected[1], "天线");
    await page.reload();
    assert.equal(await page.locator("#page-position").innerText(), `2 / ${expected.length}`, "刷新保留临时题库位置");
    await page.locator("#previous-question").click();
    await checkHighlight(expected[0], "天线");
    const wrongKey = Object.keys(expected[0].options).find((key) => !expected[0].answers.includes(key));
    await page.locator(`#options input[value="${wrongKey}"]`).check();
    if (expected[0].answers.length > 1) await page.locator("#check-answer").click();
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    await checkHighlight(expected[0], "天线");
    await page.locator("#toggle-favorite").click();
    await page.reload();
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    assert.equal(await page.locator("#toggle-favorite").getAttribute("aria-pressed"), "true");
    const saved = await page.evaluate(() => ({ session: JSON.parse(sessionStorage.getItem("radio-a-search-v1")), collections: JSON.parse(localStorage.getItem("radio-a-collections-v1")), permanent: Object.keys(localStorage).filter((key) => key.includes("search")), normal: localStorage.getItem("radio-a-practice-v1-all") }));
    assert.equal(saved.session.searchKeyword, "天线");
    assert.ok(saved.collections.mistakes.includes(expected[0].id));
    assert.ok(saved.collections.favorites.includes(expected[0].id));
    assert.deepEqual(saved.permanent, ["radio-a-search-history-v1"], "仅关键词历史永久保存，搜索作答仍为临时进度");
    assert.equal(saved.normal, null, "搜索不覆盖顺序练习进度");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "高亮后的做题页不横向溢出");
    await page.screenshot({ path: path.join(__dirname, "../tmp/search/practice-mobile.png"), fullPage: true });

    await search("镀银软铜丝编织扁带");
    assert.equal(await page.locator("#question-nav button").count(), 1, "仅选项命中也可做题");
    assert.equal(await page.locator("#question-title mark").count(), 0);
    assert.equal(await page.locator(".option-text mark").innerText(), "镀银软铜丝编织扁带");
    assert.equal(await page.locator("#feedback").isHidden(), true, "更换关键词不沿用之前的作答");
    assert.equal(await page.locator("#previous-question").isDisabled(), true);
    assert.equal(await page.locator("#next-question").isDisabled(), true);
    for (const keyword of ["fm", ".", "+", "(", "[", "?"]) {
      await search(keyword);
      const matches = bank.filter((question) => [question.question, ...Object.values(question.options)].some((text) => text.toLowerCase().includes(keyword)));
      assert.equal(await page.locator("#question-nav button").count(), matches.length, `按字面匹配 ${keyword}`);
      if (matches.length) await checkHighlight(matches[0], keyword);
    }
    for (const keyword of ["找不到的关键词xyz", "   ", "<img src=x onerror=alert(1)>"]) {
      await search(keyword);
      assert.equal(await page.locator("#empty-collection").isVisible(), true);
      assert.equal(await page.locator("#question-card").isHidden(), true);
      assert.equal(await page.locator("#question-nav button").count(), 0);
      assert.equal(await page.locator("#practice-context img").count(), 0, "搜索词按文字显示");
    }
    await page.locator("#empty-collection a").click();
    assert.equal(await page.locator("#search-input").isVisible(), true);

    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`${url("practice.html")}?search=${encodeURIComponent("镀银软铜丝编织扁带")}`);
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存/);
    await blockedPage.locator('#options input[value="A"]').check();
    assert.match(await blockedPage.locator("#feedback").innerText(), /回答正确/);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log("PASS: 首页搜索、题干及选项匹配、连续编号跳转、全部关键词高亮、字面与大小写匹配、临时进度隔离、刷新恢复、错题收藏、空结果、手机布局与存储异常降级。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
