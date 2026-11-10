const { chromium } = require(process.env.RADIO_PLAYWRIGHT_PATH || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const root = path.resolve(__dirname, "..");
  const documents = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    try {
      const body = await fs.readFile(file);
      if (["home.js", "study.js", "app.js"].includes(path.basename(file))) await new Promise((resolve) => setTimeout(resolve, 180));
      if (file.endsWith(".html")) documents.push(request.url);
      const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
      response.writeHead(200, { "Content-Type": `${types[path.extname(file)] || "application/octet-stream"}; charset=utf-8` }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.RADIO_BROWSER_PATH || undefined, ignoreDefaultArgs: ["--disable-back-forward-cache"] });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.paintedStates = [];
      const frame = () => {
        if (performance.getEntriesByName("first-contentful-paint").length) {
          const visible = (id) => { const node = document.getElementById(id); return Boolean(node && node.getBoundingClientRect().height && getComputedStyle(node).visibility !== "hidden"); };
          window.paintedStates.push({ home: visible("home-panel"), overview: visible("study-overview"),
            card: visible("question-card"), title: document.getElementById("question-title")?.textContent,
            list: document.querySelectorAll("#library-list a").length });
        }
        if (window.paintedStates.length < 15) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const assertPaints = async (file) => {
      await page.waitForFunction(() => window.paintedStates.length > 0);
      const states = await page.evaluate(() => window.paintedStates);
      if (file.includes("view=groups")) assert.ok(states.every((state) => !state.home && state.list > 0), `${file} 不得先绘制首页或空列表：${JSON.stringify(states)}`);
      if (file.startsWith("study.html?topic=")) assert.ok(states.every((state) => !state.overview), "分组详情不得先绘制学习概览");
      assert.ok(states.every((state) => !state.card || state.title), "做题页不得先绘制空题卡");
    };
    const routes = ["index.html", "index.html?view=groups", "index.html?view=groups&topic=rules", "study.html?topic=rules#group-g03", "practice.html?question=3", "practice.html?group=g03", "practice.html?topic=rules", "practice.html?day=1", "practice.html?search=天线", "practice.html?collection=mistakes", "practice.html?collection=favorites", "practice.html?exam=1"];
    await page.goto(base + "index.html");
    await page.evaluate(() => {
      const id = window.QUESTION_BANK[2].id;
      localStorage.setItem("radio-a-collections-v1", JSON.stringify({ mistakes: [id], favorites: [id] }));
    });
    for (const [width, height] of [[320, 568], [390, 844], [768, 900], [1366, 768]]) {
      await page.setViewportSize({ width, height });
      let geometry;
      for (const [index, file] of routes.entries()) {
        await page.goto(base + file);
        await assertPaints(file);
        const current = await page.locator(".site-header").evaluate((node) => {
          const header = node.getBoundingClientRect();
          const icon = node.querySelector(".brand-icon").getBoundingClientRect();
          const text = node.querySelector(".brand-text > span").getBoundingClientRect();
          return [header.x, header.y + scrollY, header.width, header.height, icon.x, icon.y + scrollY, text.x, text.y + scrollY];
        });
        geometry ||= current;
        assert.deepEqual(current, geometry, `${file} ${width} 标题栏应与首页精确对齐，保留锚点及回退的滚动位置`);
        if (index) {
          await page.goBack({ waitUntil: "commit" });
          await assertPaints(routes[index - 1]);
          await page.goForward({ waitUntil: "commit" });
          await assertPaints(file);
        }
      }
    }
    await page.goto(base + "index.html");
    await page.locator('.entry-card[href="index.html?view=groups"]').click();
    await page.locator(".topic-list-row").first().click();
    await assertPaints("index.html?view=groups&topic=rules");
    await page.locator(".group-list-row").nth(2).click();
    await assertPaints("study.html?topic=rules#group-g03");
    await page.goBack({ waitUntil: "commit" });
    await page.locator(".group-list-row").first().waitFor();
    assert.equal(await page.locator(".group-list-row").count(), 8);
    await page.goForward({ waitUntil: "commit" });
    assert.equal(await page.locator("#group-g03").isVisible(), true);
    await page.locator("#study-back").click();
    await page.locator("#library-back").click();
    await page.goBack({ waitUntil: "commit" });
    await page.locator(".group-list-row").first().waitFor();
    assert.equal(await page.locator(".group-list-row").count(), 8);

    await page.goto(base + "index.html");
    const beforeRestore = documents.length;
    await page.evaluate(() => {
      const question = window.QUESTION_BANK[2];
      localStorage.setItem("radio-a-practice-v1-all", JSON.stringify({ currentQuestion: 3, states: { [question.id]: { selected: question.answers, checked: true } } }));
      localStorage.setItem("radio-a-collections-v1", JSON.stringify({ mistakes: [question.id], favorites: [question.id] }));
      localStorage.setItem("radio-a-mastered-groups-v1", JSON.stringify(["g01"]));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await page.waitForFunction(() => document.getElementById("answered-count").textContent === "1");
    assert.equal(await page.locator("#mistakes-count").innerText(), "1");
    assert.equal(await page.locator("#favorites-count").innerText(), "1");
    assert.equal(await page.locator("#mastered-count").innerText(), "1");
    assert.match(await page.locator("#data-summary").innerText(), /错题 1 题 · 收藏 1 题 · 已掌握 1 组/);
    assert.equal(documents.length, beforeRestore, "缓存恢复应原地更新进度，不得再次请求首页");

    // 直接打开本地文件时，也不能先出现其他页面的默认内容。
    await page.route(/\/(home|study|app)\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 180));
      await route.continue();
    });
    for (const file of routes) {
      const [name, query] = file.split("?");
      await page.goto(pathToFileURL(path.join(root, name)).href + (query ? `?${query}` : ""));
      await assertPaints(file);
    }
    assert.deepEqual(errors, []);
    console.log("PASS: 延迟脚本下 HTTP/本地首帧正确、全部练习入口、手机与桌面标题栏精确对齐、分类逐级跳转、前进后退、缓存恢复原地更新学习进度。");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
