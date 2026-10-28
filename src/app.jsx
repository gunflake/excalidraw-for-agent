import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, FONT_FAMILY, exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

window.EXCALIDRAW_ASSET_PATH = "/";

const HANGUL_RANGE = "U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF";
const HANDWRITTEN_FAMILIES = ["Excalifont", "Virgil"];
const KOREAN_FONT_URL = "/korean/NanumPenScript-Regular.ttf";
const KOREAN_SIZE_ADJUST = "145%";
const DEFAULT_FONT_ID = "gangwon-bold";
const RECENT_SHOWN = 10;
const FONT_SLOT_NAME = "Helvetica";
const FONT_SLOT_FAMILY = FONT_FAMILY.Helvetica;
const FONT_OPTIONS = [
  { id: DEFAULT_FONT_ID, label: "강원교육모두 Bold (기본)", url: "/korean/GangwonEduModu-Bold.otf" },
  { id: "slant-sans", label: "Slant Sans", url: "/korean/SlantSans-Medium.otf", sizeAdjust: "90%" },
  { id: "gowun-dodum", label: "Gowun Dodum", url: "/korean/GowunDodum-Regular.ttf" },
  { id: "nanum-pen", label: "나눔손글씨 펜", url: KOREAN_FONT_URL, sizeAdjust: KOREAN_SIZE_ADJUST },
];

let slotFace = null;

/** 저장된 글꼴 선택을 고른다. 저장된 값이 없거나 목록에 없으면 기본 글꼴로 돌린다. */
function fontChoice(saved) {
  return FONT_OPTIONS.some((option) => option.id === saved) ? saved : DEFAULT_FONT_ID;
}

/** 고른 글꼴을 Helvetica 이름으로 등록해, 그 이름을 쓰는 텍스트가 이 글꼴로 그려지게 한다. */
async function registerSlotFont(fontId) {
  const { url, sizeAdjust } = FONT_OPTIONS.find(({ id }) => id === fontId);
  const face = new FontFace(FONT_SLOT_NAME, `url(${url})`, sizeAdjust ? { sizeAdjust } : {});
  await face.load();
  if (slotFace) document.fonts.delete(slotFace);
  document.fonts.add(face);
  slotFace = face;
}

/** 모든 텍스트를 글꼴 슬롯으로 바꾸고 바뀐 글꼴로 크기를 다시 잰다. */
function applyFont(elements) {
  const switched = elements.map((element) =>
    element.type === "text"
      ? { ...element, fontFamily: FONT_SLOT_FAMILY, version: element.version + 1 }
      : element,
  );
  return restoreElements(switched, null, { refreshDimensions: true });
}

/** 한글 범위에만 나눔손글씨 펜을 Excalidraw 손글씨 폰트 이름으로 등록한다. */
async function registerKoreanFont() {
  const faces = HANDWRITTEN_FAMILIES.map(
    (family) =>
      new FontFace(family, `url(${KOREAN_FONT_URL})`, {
        unicodeRange: HANGUL_RANGE,
        sizeAdjust: KOREAN_SIZE_ADJUST,
      }),
  );
  await Promise.all(faces.map((face) => face.load()));
  faces.forEach((face) => document.fonts.add(face));
}

/** 서버에서 .excalidraw 파일 목록을 읽는다. */
async function fetchFiles() {
  const response = await fetch("/api/files");
  return (await response.json()).files;
}

/** 서버에 저장된 뷰어 설정을 읽는다. */
async function fetchSettings() {
  const response = await fetch("/api/settings");
  return response.json();
}

/** 뷰어 설정 하나를 서버에 저장한다. */
function saveSetting(key, value) {
  return fetch(`/api/settings?${key}=${encodeURIComponent(value)}`, { method: "POST" });
}

/** 서버에서 뷰어로 연 장면 목록을 읽는다. */
async function fetchRecent() {
  const response = await fetch("/api/recent");
  return (await response.json()).recent;
}

/** 서버에서 .excalidraw 장면 JSON을 읽는다. 뷰어에서 연 경우에만 최근 목록에 남긴다. */
async function fetchScene(file, recordRecent = false) {
  const response = await fetch(`/api/scene?file=${encodeURIComponent(file)}${recordRecent ? "&recent" : ""}`);
  return response.json();
}

/** 파일 이름이나 절대 경로에서 확장자를 뺀 표시 이름을 만든다. */
function sceneLabel(key) {
  return key.split(/[\\/]/).pop().replace(/\.excalidraw$/, "");
}

/** 드롭한 파일을 서버 폴더에 저장하고 저장된 파일 이름을 돌려준다. */
async function uploadScene(file) {
  const response = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: await file.text(),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload.file;
}

/** 장면을 PNG Blob으로 내보낸다. 헤드리스 렌더링에서 호출한다. */
async function exportScene(scene) {
  return exportToBlob({
    elements: scene.elements,
    appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false },
    files: scene.files ?? {},
    exportPadding: 30,
    getDimensions: (width, height) => ({ width: width * 2, height: height * 2, scale: 2 }),
  });
}

function FileButton({ fileKey, folder, current, onSelect }) {
  return (
    <button
      className={fileKey === current ? "active" : ""}
      title={folder ? fileKey : undefined}
      onClick={() => onSelect(fileKey)}
    >
      {sceneLabel(fileKey)}
      {folder && <span className="folder">{folder}</span>}
    </button>
  );
}

/** 크롬 사이드바처럼 선 세 개와 화살표로 펼치기·접기를 그린다. */
function SidebarIcon({ expand }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h8M11 10h6M9 15h8" />
      <path d={expand ? "M3 7l3 3-3 3" : "M6 7l-3 3 3 3"} />
    </svg>
  );
}

function FileList({ files, current, onSelect, collapsed, onToggle }) {
  if (files.length < 2) return null;
  const toggleLabel = collapsed ? "목록 펼치기" : "목록 접기";
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      {collapsed && (
        <div className="sidebar-rail">
          <button className="sidebar-toggle" title={toggleLabel} onClick={onToggle}>
            <SidebarIcon expand />
          </button>
        </div>
      )}
      <nav className="file-list">
        <header>
          <button className="sidebar-toggle" title={toggleLabel} onClick={onToggle}>
            <SidebarIcon expand={collapsed} />
          </button>
          <h2>파일 목록</h2>
        </header>
        {files.slice(0, RECENT_SHOWN).map(({ key, folder }) => (
          <FileButton key={key} fileKey={key} folder={folder} current={current} onSelect={onSelect} />
        ))}
      </nav>
    </aside>
  );
}

function FontPicker({ value, onChange }) {
  return (
    <select className="font-picker" value={value} onChange={(event) => onChange(event.target.value)}>
      {FONT_OPTIONS.map(({ id, label }) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}

function Viewer({ initialRecent, initialFile, initialFont, initialCollapsed }) {
  const [current, setCurrent] = useState(initialFile);
  const [font, setFont] = useState(initialFont);
  const [recent, setRecent] = useState(initialRecent);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [scene, setScene] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const apiRef = useRef(null);

  const showNotice = useCallback((text) => {
    setNotice(text);
    setTimeout(() => setNotice((shown) => (shown === text ? null : shown)), 4000);
  }, []);

  const onDragEnter = useCallback((event) => {
    if (event.dataTransfer?.types?.includes("Files")) setDragging(true);
  }, []);

  const onDrop = useCallback(async (event) => {
    event.preventDefault();
    setDragging(false);
    const dropped = [...event.dataTransfer.files];
    const scenes = dropped.filter((file) => file.name.endsWith(".excalidraw"));
    if (scenes.length === 0) {
      showNotice(".excalidraw 파일만 열 수 있습니다.");
      return;
    }
    let opened = null;
    for (const file of scenes) {
      try {
        opened = await uploadScene(file);
        if (opened !== file.name) showNotice(`같은 이름이 있어 ${opened}로 저장했습니다.`);
      } catch (error) {
        showNotice(`${file.name}: ${error.message}`);
      }
    }
    if (opened) setCurrent(opened);
  }, [showNotice]);

  const fitToScreen = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9 });
  }, []);

  const load = useCallback(async (file, keepView) => {
    const nextScene = await fetchScene(file, !keepView);
    const elements = applyFont(nextScene.elements);
    if (keepView && apiRef.current) {
      apiRef.current.updateScene({ elements });
      return;
    }
    setScene({ ...nextScene, elements });
  }, []);

  const changeFont = useCallback(async (fontId) => {
    await registerSlotFont(fontId);
    saveSetting("font", fontId);
    setFont(fontId);
    await load(current, true);
  }, [current, load]);

  const toggleList = useCallback(() => {
    saveSetting("sidebar", collapsed ? "open" : "closed");
    setCollapsed(!collapsed);
  }, [collapsed]);

  useEffect(() => {
    load(current, false).then(fetchRecent).then(setRecent);
    const url = new URL(window.location.href);
    url.searchParams.set("file", current);
    window.history.replaceState(null, "", url);
    document.title = `${sceneLabel(current)} · excali`;
  }, [current, load]);

  useEffect(() => {
    const events = new EventSource("/events");
    events.onmessage = async (event) => {
      const changed = event.data;
      if (changed === current) return load(current, true);
      if ((await fetchFiles()).includes(changed)) setCurrent(changed);
    };
    return () => events.close();
  }, [current, load]);

  return (
    <div className="layout" onDragEnterCapture={onDragEnter}>
      {dragging && (
        <div
          className="drop-overlay"
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          놓으면 이 폴더에 저장하고 엽니다
        </div>
      )}
      {notice && <div className="notice">{notice}</div>}
      <FileList files={recent} current={current} onSelect={setCurrent} collapsed={collapsed} onToggle={toggleList} />
      <main>
        <FontPicker value={font} onChange={changeFont} />
        {scene && (
          <Excalidraw
            key={current}
            excalidrawAPI={(api) => {
              apiRef.current = api;
              setTimeout(fitToScreen, 50);
            }}
            initialData={{ elements: scene.elements, appState: { ...scene.appState, viewModeEnabled: true, zenModeEnabled: true }, files: scene.files }}
            viewModeEnabled
            zenModeEnabled
            UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false, saveAsImage: false } }}
          />
        )}
      </main>
    </div>
  );
}

async function main() {
  await registerKoreanFont();
  window.__excali = { fetchScene, exportScene };
  window.__fontsReady = true;
  if (new URLSearchParams(window.location.search).has("headless")) return;

  const [files, recent, settings] = await Promise.all([fetchFiles(), fetchRecent(), fetchSettings()]);
  const requested = new URLSearchParams(window.location.search).get("file");
  const openable = [...files, ...recent.map(({ key }) => key)];
  const initialFile = openable.includes(requested) ? requested : files[0];
  const initialFont = fontChoice(settings.font);
  await registerSlotFont(initialFont);
  createRoot(document.getElementById("root")).render(
    <Viewer
      initialRecent={recent}
      initialFile={initialFile}
      initialFont={initialFont}
      initialCollapsed={settings.sidebar === "closed"}
    />,
  );
}

main();
