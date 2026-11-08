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
    const open = (query = "") => page.goto(url + query);
    const hint = page.locator("#question-hint");
    const dialog = page.locator("#hint-dialog");
    const close = () => page.locator("#close-hint").click();
    const toggle = page.locator("#toggle-hint");
    await page.clock.install();
    await open("?question=3");
    assert.equal(await hint.isHidden(), true);
    assert.equal(await toggle.getAttribute("aria-haspopup"), "dialog");
    await toggle.focus();
    await page.keyboard.press("Enter");
    assert.equal(await hint.isVisible(), true, "键盘可展开提示，且不会提交答案");
    assert.equal(await dialog.evaluate((node) => node.matches(":modal")), true);
    assert.equal(await page.locator("#answered-count").innerText(), "0");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator("#page-position").innerText(), "3 / 683", "弹窗内方向键不切题");
    await close();
    await page.locator('#options input[value="A"]').check();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    await toggle.click();
    await page.clock.fastForward(1500);
    assert.equal(await page.locator("#page-position").innerText(), "3 / 683", "阅读提示时取消自动下一题");
    await close();
    assert.equal(await hint.isHidden(), true);
    await page.locator("#next-question").click();
    await page.locator('#options input[value="A"]').check();
    await toggle.click();
    await page.clock.fastForward(1500);
    assert.equal(await page.locator("#page-position").innerText(), "4 / 683", "判分后打开提示也应取消待执行的跳转");
    await page.keyboard.press("Escape");
    assert.equal(await dialog.isVisible(), false, "Esc 关闭弹窗");
    assert.equal(await toggle.evaluate((node) => node === document.activeElement), true, "关闭后焦点返回提示按钮");
    await toggle.click();
    await page.mouse.click(2, 2);
    assert.equal(await dialog.isVisible(), false, "点击遮罩关闭弹窗");
    await page.locator("#next-question").click();
    assert.equal(await hint.isHidden(), true, "切题后默认收起");
    await toggle.click();
    await page.reload();
    assert.equal(await hint.isHidden(), true, "刷新后不提前显示提示");

    const guide = await page.evaluate(() => window.STUDY_GUIDE);
    assert.deepEqual(guide.groups.flatMap((group) => group.question_numbers).sort((a, b) => a - b), Array.from({ length: 683 }, (_, index) => index + 1));
    // 每组实际打开一道题，检查跨组切换后展示相应口诀，而非上一题内容。
    for (const group of guide.groups) {
      await page.locator("#open-question-navigation").click();
      await page.locator("#jump-input").fill(String(group.question_numbers[0]));
      await page.locator("#jump-form button").click();
      await toggle.click();
      assert.equal(await page.locator("#hint-title").innerText(), group.title);
      assert.ok((await hint.innerText()).includes(group.mnemonic), `${group.id} 应展示对应口诀`);
      await close();
    }
    await open("?group=g03&question=6");
    await toggle.click();
    assert.match(await hint.innerText(), /业务叫划分，部门叫分配，电台叫指配/);
    await page.locator(".hint-footer a").click();
    assert.equal(await page.locator("#group-g03").isVisible(), true, "能跳转到对应速记分组");
    await open("?topic=callsigns&question=70");
    await toggle.click();
    assert.match(await page.locator("#hint-title").innerText(), /呼号/);
    await open("?day=1");
    await toggle.click();
    assert.equal(await hint.isVisible(), true);
    await close();
    await page.locator("#toggle-favorite").click();
    await open("?collection=favorites");
    await toggle.click();
    assert.equal(await hint.isVisible(), true, "收藏练习也能查看提示");
    await open("?question=647");
    await toggle.click();
    assert.match(await page.locator(".hint-caution").innerText(), /真正有效值为峰值/);
    await open("?question=6");
    await toggle.click();
    assert.equal(await page.locator(".hint-caution").count(), 0, "特别提醒只随对应题目展示");

    fs.mkdirSync(path.join(__dirname, "../tmp/hints"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../tmp/hints/desktop.png") });
    for (const width of [320, 375, 390, 760, 768, 1000, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `展开提示不应横向溢出 ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open("?question=6");
    await toggle.click();
    await page.screenshot({ path: path.join(__dirname, "../tmp/hints/mobile.png"), fullPage: true });

    await open("?exam=1");
    await page.locator("#start-exam").click();
    assert.equal(await toggle.isHidden(), true, "考试中不提供提示");
    assert.equal(await hint.isHidden(), true);
    assert.equal(await hint.innerText(), "", "考试中不残留上一题的提示内容");
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#submit-exam").click();
    assert.equal(await toggle.isVisible(), true, "交卷后可查看提示");
    await toggle.click();
    const examNumber = (await page.evaluate(() => JSON.parse(localStorage.getItem("radio-a-exam-v1")))).questionNumbers[0];
    const examGroup = guide.groups.find((group) => group.question_numbers.includes(examNumber));
    assert.equal(await page.locator("#hint-title").innerText(), examGroup.title, "随机试卷应按原题匹配提示");
    await close();
    await page.locator("#new-exam").click();
    await page.locator("#start-exam").click();
    assert.equal(await hint.isHidden(), true);
    assert.equal(await toggle.isHidden(), true);
    assert.deepEqual(errors, []);
    console.log("PASS: 683 题分组覆盖、70 组提示匹配、键盘展开、判分保留、自动跳转取消、切题重置、专题/每日/收藏练习、速记链接、本题疑点、七种屏宽及考试交卷后提示。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
