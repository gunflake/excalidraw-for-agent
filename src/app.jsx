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

/** 서버에서 파일 목록을 읽는다. 항목은 절대 경로를 id로 쓴다. */
async function fetchRecent() {
  const response = await fetch("/api/recent");
  return (await response.json()).recent;
}

/** 목록에 보일 이름을 바꾸고 바뀐 목록을 돌려받는다. */
async function renameEntry(path, title) {
  const response = await fetch(`/api/recent/rename?path=${encodeURIComponent(path)}&title=${encodeURIComponent(title)}`, { method: "POST" });
  return (await response.json()).recent;
}

/** 목록에서 항목을 빼고 바뀐 목록을 돌려받는다. 파일은 지우지 않는다. */
async function removeEntry(path) {
  const response = await fetch(`/api/recent/remove?path=${encodeURIComponent(path)}`, { method: "POST" });
  return (await response.json()).recent;
}

/** 서버에서 .excalidraw 장면 JSON을 읽는다. 뷰어에서 연 경우에만 최근 목록에 남긴다. */
async function fetchScene(file, recordRecent = false) {
  const response = await fetch(`/api/scene?file=${encodeURIComponent(file)}${recordRecent ? "&recent" : ""}`);
  return response.json();
}

/** 파일 이름이나 절대 경로에서 확장자를 뺀 표시 이름을 만든다. */
function sceneLabel(path) {
  return path.split(/[\\/]/).pop().replace(/\.excalidraw$/, "");
}

/** 목록 항목의 표시 이름. 바꾼 이름이 있으면 그것을 쓴다. */
function entryLabel(entry) {
  return entry.title ?? sceneLabel(entry.path);
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

/** 연필 모양 이름 바꾸기 아이콘. */
function RenameIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" />
    </svg>
  );
}

/** X 모양 목록에서 빼기 아이콘. */
function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function FileItem({ entry, active, onSelect, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);

  const finish = (event) => {
    setEditing(false);
    const title = event.target.value.trim();
    if (title !== entryLabel(entry)) onRename(entry.path, title === sceneLabel(entry.path) ? "" : title);
  };

  if (editing) {
    return (
      <div className="file-item editing">
        <input
          autoFocus
          defaultValue={entryLabel(entry)}
          onFocus={(event) => event.target.select()}
          onBlur={finish}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.target.blur();
            if (event.key === "Escape") setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={active ? "file-item active" : "file-item"}>
      <button className="file-open" title={entry.path} onClick={() => onSelect(entry.path)} onDoubleClick={() => setEditing(true)}>
        {entryLabel(entry)}
        {entry.folder && <span className="folder">{entry.folder}</span>}
      </button>
      <span className="file-actions">
        <button title="이름 바꾸기 (목록에서만)" onClick={() => setEditing(true)}>
          <RenameIcon />
        </button>
        <button title="목록에서 빼기 (파일은 그대로)" onClick={() => onRemove(entry.path)}>
          <RemoveIcon />
        </button>
      </span>
    </div>
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

function FileList({ entries, current, onSelect, onRename, onRemove, collapsed, onToggle }) {
  if (entries.length < 2) return null;
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
        {entries.slice(0, RECENT_SHOWN).map((entry) => (
          <FileItem
            key={entry.path}
            entry={entry}
            active={entry.path === current}
            onSelect={onSelect}
            onRename={onRename}
            onRemove={onRemove}
          />
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
  const [shown, setShown] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState(null);
  const apiRef = useRef(null);
  const loadSeq = useRef(0);
  const shownPath = useRef(null);

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
        if (sceneLabel(opened) !== sceneLabel(file.name)) showNotice(`같은 이름이 있어 ${sceneLabel(opened)}로 저장했습니다.`);
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

  const load = useCallback(async (path, keepView) => {
    const seq = ++loadSeq.current;
    const nextScene = await fetchScene(path, !keepView);
    if (seq !== loadSeq.current) return;
    const elements = applyFont(nextScene.elements);
    if (keepView && apiRef.current && shownPath.current === path) {
      apiRef.current.updateScene({ elements });
      return;
    }
    if (shownPath.current !== path) apiRef.current = null;
    shownPath.current = path;
    setShown({ path, scene: { ...nextScene, elements } });
  }, []);

  const changeFont = useCallback(async (fontId) => {
    await registerSlotFont(fontId);
    saveSetting("font", fontId);
    setFont(fontId);
    await load(current, true);
  }, [current, load]);

  const rename = useCallback(async (path, title) => {
    setRecent(await renameEntry(path, title));
  }, []);

  const remove = useCallback(async (path) => {
    const next = await removeEntry(path);
    setRecent(next);
    if (path === current && next.length > 0) setCurrent(next[0].path);
  }, [current]);

  const toggleList = useCallback(() => {
    saveSetting("sidebar", collapsed ? "open" : "closed");
    setCollapsed(!collapsed);
  }, [collapsed]);

  useEffect(() => {
    load(current, false).then(fetchRecent).then(setRecent);
    const url = new URL(window.location.href);
    url.searchParams.set("file", current);
    window.history.replaceState(null, "", url);
  }, [current, load]);

  useEffect(() => {
    const entry = recent.find(({ path }) => path === current);
    document.title = `${entry ? entryLabel(entry) : sceneLabel(current)} · excali`;
  }, [current, recent]);

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
      <FileList
        entries={recent}
        current={current}
        onSelect={setCurrent}
        onRename={rename}
        onRemove={remove}
        collapsed={collapsed}
        onToggle={toggleList}
      />
      <main>
        <FontPicker value={font} onChange={changeFont} />
        {shown && (
          <Excalidraw
            key={shown.path}
            excalidrawAPI={(api) => {
              apiRef.current = api;
              setTimeout(fitToScreen, 50);
            }}
            initialData={{ elements: shown.scene.elements, appState: { ...shown.scene.appState, viewModeEnabled: true, zenModeEnabled: true }, files: shown.scene.files }}
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
  const openable = [...files, ...recent.map(({ path }) => path)];
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
