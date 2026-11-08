const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const root = path.join(__dirname, "..");
  const bank = JSON.parse(fs.readFileSync(path.join(root, "A类题库.json"), "utf8")).questions;
  const references = bank.flatMap((question, index) => question.image_files.map((file) => ({ number: index + 1, id: question.id, file })));
  assert.deepEqual(references, [{ number: 462, id: "MC1-0665", file: "LK0944.jpg" }]);
  references.forEach(({ file }) => assert.ok(fs.existsSync(path.join(root, "images", file)), `${file} 应有实际图片文件`));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce", viewport: { width: 1366, height: 900 } });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const url = (file) => pathToFileURL(path.join(root, file.split("?")[0])).href + (file.includes("?") ? `?${file.split("?")[1]}` : "");
    const open = (file) => page.goto(url(file));
    const loaded = async (selector = "#question-images img") => {
      await page.waitForFunction((value) => {
        const image = document.querySelector(value);
        return image?.complete && image.naturalWidth > 0;
      }, selector);
      assert.equal(await page.locator(selector).getAttribute("alt"), "第 462 题配图");
    };
    await open("practice.html?question=462");
    await loaded();
    assert.equal(await page.locator("#question-images .image-notice").count(), 0);
    await page.locator('#options input[value="A"]').check();
    assert.match(await page.locator("#feedback").innerText(), /回答正确/);
    await loaded();
    await page.locator("#next-question").click();
    assert.equal(await page.locator("#question-images").isHidden(), true, "切题时不残留上一题图片");
    await page.locator("#previous-question").click();
    await loaded();
    const guide = await page.evaluate(() => window.STUDY_GUIDE);
    const group = guide.groups.find((item) => item.question_numbers.includes(462));
    const day = guide.plan.find((item) => item.group_ids.includes(group.id));
    for (const query of [`group=${group.id}`, `topic=${group.topic_id}`, `day=${day.day}`]) {
      await open(`practice.html?${query}&question=462`);
      await loaded();
    }
    await page.evaluate(() => localStorage.setItem("radio-a-collections-v1", JSON.stringify({ mistakes: ["MC1-0665"], favorites: ["MC1-0665"] })));
    for (const collection of ["mistakes", "favorites"]) {
      await open(`practice.html?collection=${collection}`);
      await loaded();
    }
    for (const width of [320, 390, 768, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await loaded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `配图在 ${width} 不应横向溢出`);
      assert.equal(await page.locator("#question-images img").evaluate((image) => image.getBoundingClientRect().width <= image.parentElement.clientWidth), true);
    }
    fs.mkdirSync(path.join(root, "tmp/images"), { recursive: true });
    await page.locator("#question-images").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(root, "tmp/images/desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await open("practice.html?question=462");
    await loaded();
    await page.screenshot({ path: path.join(root, "tmp/images/mobile.png"), fullPage: true });
    await page.locator("#toggle-hint").click();
    assert.match(await page.locator("#question-hint").innerText(), /配图已补齐/);

    await open(`study.html?topic=${group.topic_id}#group-${group.id}`);
    await page.locator(`#group-${group.id} .knowledge-details > summary`).click();
    await page.locator(`#group-${group.id} .source-questions > summary`).click();
    await loaded(`#group-${group.id} .source-question img`);

    await page.evaluate(() => {
      const bank = window.QUESTION_BANK;
      const numbers = [462, ...bank.flatMap((question, index) => question.answers.length === 1 && index !== 461 ? [index + 1] : []).slice(0, 31), ...bank.flatMap((question, index) => question.answers.length > 1 ? [index + 1] : []).slice(0, 8)];
      localStorage.setItem("radio-a-exam-v1", JSON.stringify({ questionNumbers: numbers, currentQuestion: 462, states: {}, exam: { deadline: Date.now() + 2_400_000, submittedAt: null } }));
    });
    await open("practice.html?exam=1");
    await loaded();
    assert.equal(await page.locator("#toggle-hint").isHidden(), true, "考试显示原题配图，仍不提供解题提示");
    await open("practice.html?question=462");
    await loaded();
    await page.locator("#question-images img").evaluate((image) => { image.src = "images/missing-test.jpg"; });
    await page.waitForSelector("#question-images .image-notice");
    assert.match(await page.locator("#question-images").innerText(), /加载失败/);
    assert.deepEqual(errors, []);
    console.log("PASS: 全库图片引用与文件审计、图片实际解码、顺序/分组/主题/每日/错题/收藏/考试/速记页显示、切题清理、四种屏宽及加载失败提示。");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
