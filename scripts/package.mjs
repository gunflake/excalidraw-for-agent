#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(REPO_DIR, "release");
const CACHE_DIR = join(OUT_DIR, ".cache");
const NODE_VERSION = "v24.22.1";
const NODE_DIST = `https://nodejs.org/dist/${NODE_VERSION}`;
const TARGETS = {
  "darwin-arm64": { node: `node-${NODE_VERSION}-darwin-arm64.tar.gz`, windows: false },
  "darwin-x64": { node: `node-${NODE_VERSION}-darwin-x64.tar.gz`, windows: false },
  "linux-x64": { node: `node-${NODE_VERSION}-linux-x64.tar.gz`, windows: false },
  "linux-arm64": { node: `node-${NODE_VERSION}-linux-arm64.tar.gz`, windows: false },
  "win-x64": { node: `node-${NODE_VERSION}-win-x64.zip`, windows: true },
  "win-arm64": { node: `node-${NODE_VERSION}-win-arm64.zip`, windows: true },
};
const APP_FILES = ["bin/excali.mjs", "lib", "dist", "static", "fonts", "skill", "package.json", "LICENSE", "node_modules/playwright-core"];
const EXCALIDRAW_FONTS = "node_modules/@excalidraw/excalidraw/dist/prod/fonts";

/** 공식 Node 배포본을 내려받아 SHASUMS256으로 검증하고 캐시 경로를 돌려준다. */
async function fetchNode(fileName) {
  const target = join(CACHE_DIR, fileName);
  if (existsSync(target)) return target;
  mkdirSync(CACHE_DIR, { recursive: true });
  const sums = await (await fetch(`${NODE_DIST}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((line) => line.endsWith(`  ${fileName}`))?.split(" ")[0];
  if (!expected) throw new Error(`SHASUMS256.txt에 ${fileName}가 없습니다.`);
  const response = await fetch(`${NODE_DIST}/${fileName}`);
  if (!response.ok) throw new Error(`${fileName} 내려받기 실패: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`${fileName} 체크섬이 다릅니다.`);
  writeFileSync(target, bytes);
  return target;
}

/** Node 배포본에서 실행 파일과 라이선스만 runtime 폴더로 꺼낸다. */
function extractNode(archive, fileName, windows, runtimeDir) {
  const base = fileName.replace(/\.(tar\.gz|zip)$/, "");
  mkdirSync(runtimeDir, { recursive: true });
  if (windows) {
    execFileSync("unzip", ["-q", "-j", "-o", archive, `${base}/node.exe`, `${base}/LICENSE`, "-d", runtimeDir]);
    return;
  }
  execFileSync("tar", ["-xzf", archive, "-C", runtimeDir, "--strip-components=2", `${base}/bin/node`]);
  execFileSync("tar", ["-xzf", archive, "-C", runtimeDir, "--strip-components=1", `${base}/LICENSE`]);
  chmodSync(join(runtimeDir, "node"), 0o755);
}

/** 대상 플랫폼용 excali 폴더를 만들고 압축 파일로 묶는다. */
async function packageTarget(name) {
  const { node, windows } = TARGETS[name];
  const stageRoot = join(OUT_DIR, name);
  const appDir = join(stageRoot, "excali");
  rmSync(stageRoot, { recursive: true, force: true });
  for (const path of [...APP_FILES, EXCALIDRAW_FONTS]) {
    cpSync(join(REPO_DIR, path), join(appDir, path), { recursive: true });
  }
  writeFileSync(join(appDir, "VERSION"), `${JSON.parse(readFileSync(join(REPO_DIR, "package.json"), "utf8")).version}\n`);
  extractNode(await fetchNode(node), node, windows, join(appDir, "runtime"));

  const archive = join(OUT_DIR, windows ? `excali-${name}.zip` : `excali-${name}.tar.gz`);
  rmSync(archive, { force: true });
  if (windows) execFileSync("zip", ["-q", "-r", "-X", archive, "excali"], { cwd: stageRoot });
  else execFileSync("tar", ["-czf", archive, "excali"], { cwd: stageRoot, env: { ...process.env, COPYFILE_DISABLE: "1" } });
  rmSync(stageRoot, { recursive: true, force: true });
  console.log(archive);
}

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : Object.keys(TARGETS);
const unknown = names.filter((name) => !TARGETS[name]);
if (unknown.length > 0) {
  console.error(`모르는 대상: ${unknown.join(", ")}\n가능한 대상: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}
if (!existsSync(join(REPO_DIR, "dist/app.js"))) {
  console.error("dist/app.js가 없습니다. 먼저 npm run build를 실행하세요.");
  process.exit(1);
}
for (const name of names) await packageTarget(name);
