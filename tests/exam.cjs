const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.join(__dirname, "../index.html")).href;
    const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-exam-v1")));
    const jump = async (index) => {
      await page.locator("#jump-input").fill(String(index + 1));
      await page.locator("#jump-form button").click();
    };
    await page.clock.install();
    await page.goto(`${url}?exam=1`);
    assert.equal(await page.locator("#question-card").isHidden(), true);
    assert.equal(await page.locator("#exam-timer").innerText(), "40:00");
    assert.equal(await page.locator("#question-nav button:disabled").count(), 40);
    const paper = await record();
    const bank = await page.evaluate(() => window.QUESTION_BANK);
    const questions = paper.questionNumbers.map((number) => bank[number - 1]);
    assert.equal(new Set(paper.questionNumbers).size, 40);
    assert.equal(questions.filter((question) => question.answers.length === 1).length, 32);
    assert.equal(questions.filter((question) => question.answers.length > 1).length, 8);
    assert.ok(questions.some((question) => paper.states[question.id].optionOrder.join("") !== Object.keys(question.options).join("")), "试卷应打乱选项内容");
    await page.locator("#start-exam").click();
    assert.equal(await page.locator("#auto-next").isHidden(), true);
    const deadline = (await record()).exam.deadline;
    for (let index = 0; index < questions.length; index++) {
      await jump(index);
      const question = questions[index];
      const order = paper.states[question.id].optionOrder;
      assert.deepEqual(await page.locator(".option-letter").allTextContents(), Object.keys(question.options));
      assert.deepEqual(await page.locator(".option-text").allTextContents(), order.map((key) => question.options[key]));
      // 按实际显示的选项内容选择，验证打乱后仍能按原题答案正确判分。
      for (const key of question.answers) {
        await page.locator("#options .option").filter({ has: page.getByText(question.options[key], { exact: true }) }).locator("input").check();
      }
      assert.equal(await page.locator("#feedback").isHidden(), true);
      assert.equal(await page.locator(".option-mark").count(), 0);
    }
    await page.clock.fastForward(10_000);
    await page.reload();
    const restored = await record();
    assert.deepEqual(restored.questionNumbers, paper.questionNumbers);
    assert.deepEqual(Object.values(restored.states).map((state) => state.optionOrder), Object.values(paper.states).map((state) => state.optionOrder));
    assert.equal(restored.exam.deadline, deadline, "刷新不得延长考试时间");
    assert.equal(await page.locator("#answered-count").innerText(), "40");
    assert.equal(await page.locator(".stats").isHidden(), true);
    await page.locator("#submit-exam").click();
    assert.match(await page.locator("#exam-result").innerText(), /40 \/ 40 · 合格/);
    assert.equal(await page.locator("#options input:enabled").count(), 0);
    assert.equal(await page.locator("#retry-answer").isHidden(), true);
    const last = questions.at(-1);
    const expectedLetters = paper.states[last.id].optionOrder.flatMap((key, index) => last.answers.includes(key) ? [String.fromCharCode(65 + index)] : []).join("、");
    assert.ok((await page.locator("#feedback").innerText()).includes(`正确答案：${expectedLetters}`));
    await page.reload();
    assert.match(await page.locator("#exam-result").innerText(), /40 \/ 40 · 合格/);
    fs.mkdirSync(path.join(__dirname, "../tmp/exam"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../tmp/exam/desktop-result.png") });

    // 固定试卷包含单选、多选，覆盖漏选、多选、未作答及 30 分合格边界。
    await page.evaluate(() => {
      const bank = window.QUESTION_BANK;
      const questions = [bank[0], bank[2], ...bank.filter((question) => question.answers.length === 1 && question !== bank[2]).slice(0, 31), ...bank.filter((question) => question.answers.length > 1 && question !== bank[0]).slice(0, 7)];
      const states = Object.fromEntries(questions.map((question, index) => [question.id, { selected: index >= 3 && index <= 32 ? question.answers : [], checked: false, optionOrder: Object.keys(question.options).reverse() }]));
      localStorage.setItem("radio-a-exam-v1", JSON.stringify({ questionNumbers: questions.map((question) => bank.indexOf(question) + 1), states, exam: { deadline: Date.now() + 2_400_000, submittedAt: null } }));
    });
    await page.reload();
    await jump(0);
    await page.locator('#options input[value="A"]').check();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#feedback").isHidden(), true, "多选回车也不能提前判分");
    await page.locator('#options input[value="B"]').check();
    await page.locator('#options input[value="C"]').check();
    await page.locator('#options input[value="B"]').uncheck();
    await page.locator('#options input[value="C"]').uncheck();
    await jump(1);
    await page.locator('#options input[value="A"]').check();
    await page.locator('#options input[value="B"]').check();
    assert.equal(await page.locator("#options input:checked").count(), 1, "单选可修改答案");
    assert.equal(await page.locator("#page-navigation").evaluate((node) => node.getBoundingClientRect().bottom <= node.parentElement.getBoundingClientRect().bottom), true, "桌面常规考题的切题按钮应在屏幕内");
    assert.equal(await page.locator("#mistakes-count").innerText(), "0", "交卷前不收录或泄露错题");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#submit-exam").click();
    assert.equal(await page.locator("#exam-result").isHidden(), true, "可取消提前交卷");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#submit-exam").click();
    assert.match(await page.locator("#exam-result").innerText(), /30 \/ 40 · 合格 · 错题 10 题（含未答 8 题）/);
    assert.equal(await page.locator("#mistakes-count").innerText(), "10");
    await jump(0);
    assert.match(await page.locator("#feedback").innerText(), /回答错误/, "多选漏选判错");
    await jump(1);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".option.is-wrong")).backgroundColor === "rgb(251, 227, 223)");
    assert.equal(await page.locator(".option.is-wrong .option-letter").innerText(), "C", "误选字母使用打乱后的显示位置");
    await page.reload();
    assert.match(await page.locator("#exam-result").innerText(), /30 \/ 40 · 合格/);
    assert.equal(await page.locator("#mistakes-count").innerText(), "10");
    await page.locator("#new-exam").click();
    assert.equal(await page.locator("#start-exam").isVisible(), true);
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    assert.notDeepEqual((await record()).questionNumbers, paper.questionNumbers);
    await page.locator("#start-exam").click();
    for (const width of [320, 375, 390, 760, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `考试布局横向溢出 ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-open-dialog="practice-navigation"]').click();
    await page.locator("#question-nav button").nth(5).click();
    assert.equal(await page.locator("#page-position").innerText(), "6 / 40");
    await page.screenshot({ path: path.join(__dirname, "../tmp/exam/mobile-active.png") });
    await page.clock.fastForward(2_400_000);
    assert.match(await page.locator("#exam-status").innerText(), /时间到，已自动交卷/);
    assert.equal(await page.locator("#exam-timer").innerText(), "00:00");
    assert.match(await page.locator("#exam-result").innerText(), /0 \/ 40 · 未合格/);
    await page.reload();
    assert.equal(await page.locator("#submit-exam").isHidden(), true);
    await page.locator("#new-exam").click();
    await page.locator("#start-exam").click();
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("radio-a-exam-v1"));
      saved.exam.deadline = Date.now() - 1000;
      localStorage.setItem("radio-a-exam-v1", JSON.stringify(saved));
    });
    await page.reload();
    assert.match(await page.locator("#exam-status").innerText(), /时间到，已自动交卷/, "重新打开已过截止时间的试卷也应立即交卷");
    assert.equal(await page.locator("#options input:enabled").count(), 0);

    // 普通单选、多选误选均应显示红底，不能被选中、悬停样式覆盖。
    await page.goto(`${url}?question=3`);
    await page.locator("#auto-next").uncheck();
    await page.locator('#options input[value="B"]').check();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".option.is-wrong")).backgroundColor === "rgb(251, 227, 223)");
    await page.goto(`${url}?question=1`);
    await page.locator('#options input[value="A"]').check();
    await page.locator('#options input[value="B"]').check();
    await page.locator("#check-answer").click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".option.is-wrong")).backgroundColor === "rgb(251, 227, 223)");
    assert.equal(await page.locator(".option.is-wrong input").inputValue(), "B");
    await page.screenshot({ path: path.join(__dirname, "../tmp/exam/wrong-options-mobile.png") });
    const blocked = await browser.newContext();
    await blocked.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error("storage blocked"); }; });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto(`${url}?exam=1`);
    await blockedPage.locator("#start-exam").click();
    await blockedPage.locator("#options input").first().check();
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存/);
    blockedPage.once("dialog", (dialog) => dialog.accept());
    await blockedPage.locator("#submit-exam").click();
    assert.equal(await blockedPage.locator("#exam-result").isVisible(), true);
    await blocked.close();
    assert.deepEqual(errors, []);
    console.log("PASS: 32+8 抽题、选项打乱与正确判分、答案字母映射、作答可修改、交卷前隐藏答案、刷新保留截止时间、合格边界、未答与漏选判错、错题收录、交卷确认、重新组卷、到时交卷、手机选题、单选多选红底。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
