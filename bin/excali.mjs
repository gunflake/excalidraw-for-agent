#!/usr/bin/env node
import { createServer } from "node:http";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC_ROUTES = {
  "/": join(APP_DIR, "static/index.html"),
  "/app.js": join(APP_DIR, "dist/app.js"),
  "/app.css": join(APP_DIR, "dist/app.css"),
};
const ASSET_DIRS = {
  "/fonts/": join(APP_DIR, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"),
  "/korean/": join(APP_DIR, "fonts"),
};
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};
const DIAGRAMS_DIR = process.env.EXCALI_HOME ?? join(homedir(), "diagrams");
const SCENE_LIB = join(APP_DIR, "lib/scene.mjs");
const DEFAULT_PORT = 5177;
const PORT_SCAN = 10;
const CHANGE_DEBOUNCE_MS = 150;
const UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const USAGE = `사용법:
  excali [-d] [파일.excalidraw | 폴더]     뷰어로 보기 (기본: 현재 폴더, -d는 백그라운드 실행)
  excali png <파일.excalidraw> [출력.png]  뷰어와 같은 폰트로 PNG 만들기
  excali new <이름>                       ~/diagrams/src/<이름>.mjs 그림 스크립트 틀 만들기
  excali build <이름>                     스크립트 실행 → 점검 → ~/diagrams/<이름>.excalidraw, .png 생성
  excali stop                             백그라운드 뷰어 모두 끄기

같은 폴더를 보는 뷰어가 이미 떠 있으면 새로 띄우지 않고, 열린 화면이 그 파일로 넘어갑니다.
그림 폴더는 EXCALI_HOME 환경 변수로 바꿀 수 있습니다 (기본: ~/diagrams).`;

/** 폴더 안의 .excalidraw 파일 이름을 정렬해 돌려준다. */
function listScenes(root) {
  return readdirSync(root).filter((name) => name.endsWith(".excalidraw")).sort();
}

/** 파일 또는 폴더 인자를 (폴더, 처음 열 파일) 쌍으로 바꾼다. */
function resolveTarget(target) {
  const absolute = resolve(target);
  if (!existsSync(absolute)) {
    console.error(`경로가 없습니다: ${absolute}\n\n${USAGE}`);
    process.exit(1);
  }
  if (statSync(absolute).isDirectory()) return { root: absolute, initial: listScenes(absolute)[0] };
  return { root: dirname(absolute), initial: basename(absolute) };
}

/** 같은 이름이 있으면 `이름-2.excalidraw`처럼 번호를 붙여 덮어쓰지 않을 이름을 고른다. */
function uniqueSceneName(root, requested) {
  const stem = basename(requested).replace(/\.excalidraw$/, "") || "dropped";
  let name = `${stem}.excalidraw`;
  for (let index = 2; existsSync(join(root, name)); index += 1) name = `${stem}-${index}.excalidraw`;
  return name;
}

/** 요청 본문을 문자열로 읽는다. 한도를 넘으면 실패한다. */
function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > UPLOAD_LIMIT_BYTES) {
        reject(new Error("파일이 너무 큽니다."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** 드롭한 장면을 검사해 폴더에 저장하고 저장한 파일 이름을 돌려준다. */
async function saveUploadedScene(root, request, requested) {
  const body = await readBody(request);
  let scene;
  try {
    scene = JSON.parse(body);
  } catch {
    throw new Error("JSON 형식이 아닙니다.");
  }
  if (scene?.type !== "excalidraw" || !Array.isArray(scene.elements)) {
    throw new Error("Excalidraw 장면 파일이 아닙니다.");
  }
  const name = uniqueSceneName(root, requested ?? "");
  writeFileSync(join(root, name), body);
  return name;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": MIME[".json"] });
  response.end(JSON.stringify(payload));
}

function sendFile(response, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
  response.end(readFileSync(path));
}

/** 정적 파일, 장면 API, 변경 알림(SSE)을 제공하는 서버를 만든다. */
function createViewerServer(root) {
  const listeners = new Set();
  const pending = new Map();
  const broadcast = (name) => listeners.forEach((response) => response.write(`data: ${name}\n\n`));
  const watcher = watch(root, (_, name) => {
    if (!name?.endsWith(".excalidraw")) return;
    clearTimeout(pending.get(name));
    pending.set(name, setTimeout(() => broadcast(name), CHANGE_DEBOUNCE_MS));
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (STATIC_ROUTES[url.pathname]) return sendFile(response, STATIC_ROUTES[url.pathname]);

    const assetPrefix = Object.keys(ASSET_DIRS).find((prefix) => url.pathname.startsWith(prefix));
    if (assetPrefix) {
      const relative = decodeURIComponent(url.pathname.slice(assetPrefix.length));
      if (relative.includes("..")) return response.writeHead(400).end();
      return sendFile(response, join(ASSET_DIRS[assetPrefix], relative));
    }

    if (url.pathname === "/api/info") {
      response.writeHead(200, { "Content-Type": MIME[".json"] });
      return response.end(JSON.stringify({ app: "excali", root, viewers: listeners.size }));
    }

    if (url.pathname === "/api/stop" && request.method === "POST") {
      response.writeHead(204).end();
      setTimeout(() => process.exit(0), 50);
      return;
    }

    if (url.pathname === "/api/show" && request.method === "POST") {
      broadcast(url.searchParams.get("file"));
      return response.writeHead(204).end();
    }

    if (url.pathname === "/api/files") {
      response.writeHead(200, { "Content-Type": MIME[".json"] });
      return response.end(JSON.stringify({ files: listScenes(root) }));
    }

    if (url.pathname === "/api/scene") {
      const file = url.searchParams.get("file");
      if (!listScenes(root).includes(file)) return response.writeHead(404).end();
      return sendFile(response, join(root, file));
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      saveUploadedScene(root, request, url.searchParams.get("name")).then(
        (file) => sendJson(response, 201, { file }),
        (error) => sendJson(response, 400, { error: error.message }),
      );
      return;
    }

    if (url.pathname === "/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      listeners.add(response);
      request.on("close", () => listeners.delete(response));
      return;
    }

    response.writeHead(404).end();
  });
  server.on("close", () => watcher.close());
  return server;
}

/** 비어 있는 포트를 찾아 127.0.0.1에서 서버를 연다. */
function listen(server, port) {
  return new Promise((resolvePort, reject) => {
    server.once("error", (error) => {
      if (error.code !== "EADDRINUSE") return reject(error);
      listen(server, port + 1).then(resolvePort, reject);
    });
    server.listen(port, "127.0.0.1", () => resolvePort(port));
  });
}

/** 설치된 Chromium 계열 브라우저 실행 파일을 찾는다. */
function findChromium() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const shells = existsSync(cache)
    ? readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse()
    : [];
  for (const shell of shells) {
    for (const platform of readdirSync(join(cache, shell))) {
      const executable = join(cache, shell, platform, "chrome-headless-shell");
      if (existsSync(executable)) return executable;
    }
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (existsSync(chrome)) return chrome;
  throw new Error("Chromium을 찾지 못했습니다. Google Chrome을 설치하거나 `npx playwright install chromium`을 실행하세요.");
}

/** 뷰어와 같은 폰트 설정으로 장면을 PNG 파일로 렌더링한다. */
async function renderPng(input, output) {
  const { chromium } = await import("playwright-core");
  const { root, initial } = resolveTarget(input);
  const server = createViewerServer(root);
  const port = await listen(server, DEFAULT_PORT + 100);
  const browser = await chromium.launch({ executablePath: findChromium() });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/?headless`);
    await page.waitForFunction(() => window.__fontsReady, null, { timeout: 30000 });
    const base64 = await page.evaluate(async (file) => {
      const scene = await window.__excali.fetchScene(file);
      const blob = await window.__excali.exportScene(scene);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
      return btoa(binary);
    }, initial);
    writeFileSync(output, Buffer.from(base64, "base64"));
    console.log(`PNG 저장: ${output}`);
  } finally {
    await browser.close();
    server.close();
  }
}

/** 같은 폴더를 보고 있는 excali 서버의 포트와 열린 화면 수를 찾는다. */
async function findRunningViewer(root) {
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_SCAN; port += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(300) });
      const info = await response.json();
      if (info.app === "excali" && info.root === root) return { port, viewers: info.viewers };
    } catch {
      continue;
    }
  }
  return null;
}

function openBrowser(url) {
  if (!process.env.EXCALI_NO_OPEN) execFile("open", [url]);
}

/** 뷰어를 분리된 백그라운드 프로세스로 띄우고 준비될 때까지 기다린다. */
async function openViewerInBackground(target) {
  const { root } = resolveTarget(target);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), target], { detached: true, stdio: "ignore" });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((done) => setTimeout(done, 100));
    const running = await findRunningViewer(root);
    if (running) {
      console.log(`excali: 백그라운드 실행 http://127.0.0.1:${running.port}/  (종료: excali stop)`);
      return;
    }
  }
  console.error("excali: 백그라운드 뷰어를 띄우지 못했습니다.");
  process.exit(1);
}

/** 실행 중인 모든 excali 뷰어를 끈다. */
async function stopViewers() {
  let stopped = 0;
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + PORT_SCAN; port += 1) {
    try {
      const info = await (await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(300) })).json();
      if (info.app !== "excali") continue;
      await fetch(`http://127.0.0.1:${port}/api/stop`, { method: "POST" });
      stopped += 1;
    } catch {
      continue;
    }
  }
  console.log(`excali: 뷰어 ${stopped}개를 껐습니다.`);
}

/** 새 그림 스크립트 틀을 ~/diagrams/src에 만든다. */
function createScript(name) {
  const script = join(DIAGRAMS_DIR, "src", `${name}.mjs`);
  if (existsSync(script)) {
    console.error(`이미 있습니다: ${script}`);
    process.exit(1);
  }
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, `import { Scene } from ${JSON.stringify(SCENE_LIB)};

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "제목", size: 30 });

const first = scene.box({ cx: 200, cy: 200, label: "첫 단계", color: "blue" });
const second = scene.box({ cx: 560, cy: 200, label: "다음 단계", color: "green" });
scene.arrow(first, second, { label: "요청" });

scene.save(new URL("../${name}.excalidraw", import.meta.url).pathname);
`);
  console.log(script);
}

/** 그림 스크립트를 실행하고 PNG까지 만든다. 점검 경고는 그대로 보여 준다. */
async function buildScript(name) {
  const script = join(DIAGRAMS_DIR, "src", `${name}.mjs`);
  const scene = join(DIAGRAMS_DIR, `${name}.excalidraw`);
  if (!existsSync(script)) {
    console.error(`스크립트가 없습니다: ${script}\n먼저 excali new ${name} 을 실행하세요.`);
    process.exit(1);
  }
  execFileSync(process.execPath, [script], { stdio: "inherit" });
  await renderPng(scene, scene.replace(/\.excalidraw$/, ".png"));
  console.log(`장면 저장: ${scene}`);
}

/** 뷰어 서버를 띄우고 브라우저로 연다. 이미 떠 있으면 그 화면을 해당 파일로 넘긴다. */
async function openViewer(target) {
  const { root, initial } = resolveTarget(target);
  if (!initial) {
    console.error(`${root}에 .excalidraw 파일이 없습니다.`);
    process.exit(1);
  }

  const running = await findRunningViewer(root);
  if (running) {
    const url = `http://127.0.0.1:${running.port}/?file=${encodeURIComponent(initial)}`;
    await fetch(`http://127.0.0.1:${running.port}/api/show?file=${encodeURIComponent(initial)}`, { method: "POST" });
    if (running.viewers === 0) openBrowser(url);
    console.log(`excali: 이미 실행 중 ${url}`);
    return;
  }

  const port = await listen(createViewerServer(root), DEFAULT_PORT);
  const url = `http://127.0.0.1:${port}/?file=${encodeURIComponent(initial)}`;
  console.log(`excali: ${url}  (종료: Ctrl+C)`);
  openBrowser(url);
}

const args = process.argv.slice(2);
const background = args.includes("-d");
const [command, ...rest] = args.filter((arg) => arg !== "-d");

if (command === "-h" || command === "--help") {
  console.log(USAGE);
} else if (command === "png") {
  if (!rest[0]) {
    console.error(USAGE);
    process.exit(1);
  }
  await renderPng(rest[0], rest[1] ?? rest[0].replace(/\.excalidraw$/, ".png"));
} else if (command === "new" || command === "build") {
  if (!rest[0]) {
    console.error(USAGE);
    process.exit(1);
  }
  await (command === "new" ? createScript(rest[0]) : buildScript(rest[0]));
} else if (command === "stop") {
  await stopViewers();
} else if (background) {
  await openViewerInBackground(command ?? ".");
} else {
  await openViewer(command ?? ".");
}
