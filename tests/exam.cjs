const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1366, height: 768 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = pathToFileURL(path.join(__dirname, "../practice.html")).href;
    const record = () => page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-exam-v1")));
    const history = () => page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-exam-history-v1") || "[]"));
    const mistakeCount = () => page.evaluate(() => String(JSON.parse(localStorage.getItem("radio-a-collections-v1")).mistakes.length));
    const jump = async (index) => {
      await page.locator("#open-question-navigation").click();
      await page.locator("#jump-input").fill(String(index + 1));
      await page.locator("#jump-form button").click();
    };
    await page.clock.install();
    await page.goto(`${url}?exam=1`);
    assert.equal(await page.locator("#question-card").isHidden(), true);
    assert.equal(await page.locator("#exam-timer").innerText(), "40:00");
    assert.equal(await page.locator("#question-nav button:disabled").count(), 40);
    assert.equal(await page.locator("#exam-history-count").innerText(), "0");
    assert.equal(await page.locator("#add-exam-mistakes").isHidden(), true);
    const paper = await record();
    const bank = await page.evaluate(() => window.QUESTION_BANK);
    const questions = paper.questionNumbers.map((number) => bank[number - 1]);
    assert.equal(new Set(paper.questionNumbers).size, 40);
    assert.equal(questions.filter((question) => question.answers.length === 1).length, 32);
    assert.equal(questions.filter((question) => question.answers.length > 1).length, 8);
    assert.ok(questions.some((question) => paper.states[question.id].optionOrder.join("") !== Object.keys(question.options).join("")), "试卷应打乱选项内容");
    await page.locator("#start-exam").click();
    assert.equal(await page.locator("#auto-next").count(), 0);
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
    assert.equal(await page.locator("progress").count(), 0, "考试页不显示首页的进度卡");
    await page.locator("#submit-exam").click();
    assert.match(await page.locator("#exam-result").innerText(), /40 \/ 40 · 合格/);
    assert.equal(await page.locator("#add-exam-mistakes").isHidden(), true, "满分不显示加入错题按钮");
    assert.equal((await history()).length, 1, "交卷后自动保存整份试卷");
    const perfectRecord = (await history())[0];
    assert.deepEqual(perfectRecord.states, (await record()).states);
    assert.equal(await page.locator("#options input:enabled").count(), 0);
    assert.equal(await page.locator("#retry-answer").isHidden(), true);
    const last = questions.at(-1);
    const expectedLetters = paper.states[last.id].optionOrder.flatMap((key, index) => last.answers.includes(key) ? [String.fromCharCode(65 + index)] : []).join("、");
    assert.ok((await page.locator("#feedback").innerText()).includes(`正确答案：${expectedLetters}`));
    await page.reload();
    assert.match(await page.locator("#exam-result").innerText(), /40 \/ 40 · 合格/);
    assert.equal((await history()).length, 1, "刷新不重复添加考试记录");
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
    assert.equal(await page.locator("#page-navigation").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && Math.abs(rect.bottom - innerHeight) <= 1;
    }), true, "考试切题栏固定在屏幕底部");
    assert.equal(await mistakeCount(), "0", "交卷前不收录或泄露错题");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator("#submit-exam").click();
    assert.equal(await page.locator("#exam-result").isHidden(), true, "可取消提前交卷");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#submit-exam").click();
    assert.match(await page.locator("#exam-result").innerText(), /30 \/ 40 · 合格 · 错题 10 题（含未答 8 题）/);
    assert.equal(await mistakeCount(), "0", "交卷只判分，由按钮主动收录考试错题");
    assert.match(await page.locator("#add-exam-mistakes").innerText(), /10 题/);
    await page.locator("#add-exam-mistakes").click();
    assert.equal(await mistakeCount(), "10");
    assert.equal(await page.locator("#add-exam-mistakes").isDisabled(), true);
    assert.equal((await history()).length, 2);
    await jump(0);
    assert.match(await page.locator("#feedback").innerText(), /回答错误/, "多选漏选判错");
    await jump(1);
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".option.is-wrong")).backgroundColor === "rgb(251, 227, 223)");
    assert.equal(await page.locator(".option.is-wrong .option-letter").innerText(), "C", "误选字母使用打乱后的显示位置");
    await page.reload();
    assert.match(await page.locator("#exam-result").innerText(), /30 \/ 40 · 合格/);
    assert.equal(await mistakeCount(), "10");
    assert.equal(await page.locator("#add-exam-mistakes").isDisabled(), true, "刷新后仍显示已加入");
    await page.locator("#remove-mistake").click();
    assert.equal(await mistakeCount(), "9");
    assert.match(await page.locator("#add-exam-mistakes").innerText(), /1 题/);
    await page.locator("#add-exam-mistakes").click();
    assert.equal(await mistakeCount(), "10", "重复加入去重，只补回移出的错题");
    await page.locator("#new-exam").click();
    assert.equal(await page.locator("#start-exam").isVisible(), true);
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    assert.notDeepEqual((await record()).questionNumbers, paper.questionNumbers);
    await page.locator("#start-exam").click();
    const activeRecord = await record();
    const archived = await history();
    assert.equal(archived.length, 2, "重新组卷保留之前的考试");
    assert.deepEqual(archived.find((item) => item.id === perfectRecord.id), perfectRecord, "历史试卷、答案和选项顺序保持不变");
    await page.locator("#exam-history summary").click();
    await page.locator("#exam-history-list a").first().click();
    assert.match(await page.locator("#exam-status").innerText(), /考试记录/);
    assert.match(await page.locator("#exam-result").innerText(), /30 \/ 40/);
    assert.equal(await page.locator("#options input:enabled").count(), 0);
    await page.locator("#next-question").click();
    await page.reload();
    assert.deepEqual(await record(), activeRecord, "回看、切题和刷新历史记录不覆盖正在考试的试卷");
    await page.locator("#exam-history summary").click();
    await page.locator("#exam-history-list a").last().click();
    assert.match(await page.locator("#exam-result").innerText(), /40 \/ 40/);
    await jump(0);
    const first = bank[perfectRecord.questionNumbers[0] - 1];
    assert.deepEqual(await page.locator(".option-text").allTextContents(), perfectRecord.states[first.id].optionOrder.map((key) => first.options[key]));
    await page.locator("#new-exam").click();
    assert.equal(await page.locator("#exam-result").isHidden(), true);
    assert.equal((await record()).exam.deadline, activeRecord.exam.deadline, "回到当前考试沿用原截止时间");
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
    assert.equal((await history()).length, 3, "超时交卷也保留记录");
    assert.equal((await history())[0].exam.timedOut, true);
    assert.equal(await page.locator("#add-exam-mistakes").isEnabled(), true);
    await page.locator("#exam-history summary").click();
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `考试成绩、错题按钮与历史记录适配 ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(__dirname, "../tmp/exam/mobile-history.png") });
    const timedOutRecord = await record();
    const expectedMistakes = await page.evaluate(() => {
      const previous = JSON.parse(localStorage.getItem("radio-a-collections-v1")).mistakes;
      const paper = JSON.parse(localStorage.getItem("radio-a-exam-v1"));
      return [...new Set([...previous, ...Object.keys(paper.states)])].sort();
    });
    await page.locator("#exam-history-list a").first().click();
    await page.locator("#add-exam-mistakes").click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-collections-v1")).mistakes.sort()), expectedMistakes, "回看历史也可一键加入错题，保留已有错题并去重");
    assert.deepEqual(await record(), timedOutRecord, "从历史收录错题不修改当前试卷");
    await page.locator("#new-exam").click();
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
    await blockedPage.locator("#add-exam-mistakes").click();
    assert.equal(await blockedPage.locator("#add-exam-mistakes").isEnabled(), true, "保存失败时可重试加入错题");
    assert.match(await blockedPage.locator("#save-status").innerText(), /无法保存/);
    await blocked.close();
    const legacy = await browser.newPage();
    await legacy.goto(`${url}?exam=1`);
    await legacy.evaluate((value) => {
      localStorage.removeItem("radio-a-exam-history-v1");
      localStorage.setItem("radio-a-exam-v1", JSON.stringify(value));
    }, perfectRecord);
    await legacy.reload();
    assert.equal(await legacy.locator("#exam-history-count").innerText(), "1", "旧版最近一次已交试卷自动迁入历史");
    await legacy.reload();
    assert.equal(await legacy.locator("#exam-history-count").innerText(), "1");
    await legacy.close();
    assert.deepEqual(errors, []);
    console.log("PASS: 32+8 抽题、选项映射与判分、交卷确认、刷新与超时、考试历史持久化与旧记录迁入、历史回看与当前考试隔离、一键收录错题及未答题、去重与失败重试、手机记录布局、普通练习判分。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
