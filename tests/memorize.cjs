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
    const toggle = page.locator("#toggle-memorize");
    const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-practice-v1-all")));
    const checkAnswers = async (number) => {
      const answers = await page.evaluate((index) => window.QUESTION_BANK[index - 1].answers, number);
      assert.equal(await page.locator("#feedback").innerText(), `正确答案：${answers.join("、")}。`);
      assert.deepEqual(await page.locator(".option.is-correct input").evaluateAll((inputs) => inputs.map((input) => input.value)), answers);
      assert.equal(await page.locator(".option.is-wrong").count(), 0);
      assert.equal(await page.locator("#options input:enabled").count(), 0);
      assert.equal(await page.locator(".answer-actions").isHidden(), true);
    };

    await page.goto(`${url}?question=1`);
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "默认关闭");
    assert.equal(await page.locator("#feedback").isHidden(), true);
    await page.locator('#options input[value="B"]').check();
    const before = await record();
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await checkAnswers(1);
    await page.locator("#question-title").focus();
    await page.keyboard.press("Enter");
    await page.clock.runFor(1500);
    assert.deepEqual(await record(), before, "背题及回车不改写作答进度");
    await toggle.click();
    assert.equal(await page.locator('#options input[value="B"]').isChecked(), true, "关闭后保留未提交选择");
    assert.equal(await page.locator("#feedback").isHidden(), true);
    await toggle.click();
    await page.locator("#next-question").click();
    await checkAnswers(2);
    await page.keyboard.press("ArrowRight");
    await checkAnswers(3);
    assert.equal(await page.locator("#answered-count").innerText(), "0", "背题不计为已作答");
    await toggle.click();
    await page.locator('#options input[value="B"]').check();
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    const checked = await record();
    await toggle.click();
    await checkAnswers(3);
    await page.clock.runFor(1500);
    assert.equal(await page.locator("#page-position").innerText(), "3 / 683", "开启背题取消待执行的自动跳转");
    assert.deepEqual(await record(), checked, "原判分及错题记录不因背题改变");
    await page.locator("#toggle-hint").click();
    assert.equal(await page.locator("#hint-dialog").isVisible(), true);
    await page.locator("#close-hint").click();
    await toggle.click();
    assert.match(await page.locator("#feedback").innerText(), /回答错误/);
    assert.equal(await page.locator(".option.is-wrong").count(), 1, "关闭后恢复原判分");
    await toggle.click();
    await page.reload();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "刷新后默认关闭");
    await page.locator("#toggle-favorite").click();

    fs.mkdirSync(path.join(__dirname, "../tmp/memorize"), { recursive: true });
    for (const query of ["?group=g03&question=6", "?topic=callsigns", "?day=1", "?search=天线", "?collection=mistakes", "?collection=favorites"]) {
      await page.goto(url + query);
      assert.equal(await toggle.isVisible(), true, `${query} 显示背题图标`);
      assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${query} 默认关闭`);
      await toggle.click();
      await checkAnswers(await page.evaluate(() => questions[currentIndex].number));
    }
    // 从用户实际使用的入口进入，确保路由跳转后也能开启背题。
    const homeUrl = pathToFileURL(path.join(__dirname, "../index.html")).href;
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      for (const entry of ["mistakes", "favorites", "groups", "search"]) {
        await page.goto(homeUrl);
        if (entry === "search") {
          await page.locator("#toggle-search").click();
          await page.locator("#search-input").fill("天线");
          await page.locator("#search-input").press("Enter");
        } else if (entry === "groups") {
          await page.locator('.entry-card[href="index.html?view=groups"]').click();
          await page.locator(".topic-list-row").first().click();
          await page.locator(".group-list-row").first().click();
          await page.locator(".knowledge-card:visible .group-practice").click();
        } else {
          await page.locator(`.entry-card[href="practice.html?collection=${entry}"]`).click();
        }
        await toggle.waitFor({ state: "visible" });
        assert.equal(await toggle.getAttribute("aria-pressed"), "false", `${entry} ${width} 默认关闭`);
        await toggle.click();
        await checkAnswers(await page.evaluate(() => questions[currentIndex].number));
        await page.screenshot({ path: path.join(__dirname, `../tmp/memorize/${entry}-${width}.png`) });
        await toggle.click();
        assert.ok(await page.locator("#options input:enabled").count() || await page.locator("#retry-answer").isVisible(), `${entry} 关闭后恢复做题`);
      }
    }
    for (const width of [320, 375, 390, 760, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${url}?question=1`);
      await toggle.click();
      await checkAnswers(1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `无横向溢出 ${width}`);
      const label = await page.locator(".question-label").boundingBox();
      const tools = await page.locator(".question-tools").boundingBox();
      const card = await page.locator("#question-card").boundingBox();
      assert.ok(label.x + label.width <= tools.x && tools.x + tools.width <= card.x + card.width, `图标与题号不重叠且位于卡片内 ${width}`);
      if ([320, 1366].includes(width)) await page.screenshot({ path: path.join(__dirname, `../tmp/memorize/${width}.png`) });
    }
    await page.goto(`${url}?exam=1`);
    await page.locator("#start-exam").click();
    assert.equal(await toggle.isHidden(), true, "考试不开放背题");
    assert.equal(await page.locator("#feedback").isHidden(), true);
    assert.equal(await page.locator(".option.is-correct").count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: 默认关闭、单选多选直接显示答案、切题保持、进度不变、回车保护、恢复作答、取消自动跳转、提示共存、练习入口、六种屏宽和考试隔离。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
