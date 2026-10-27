import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToBlob } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

window.EXCALIDRAW_ASSET_PATH = "/";

const HANGUL_RANGE = "U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF";
const HANDWRITTEN_FAMILIES = ["Excalifont", "Virgil"];
const KOREAN_FONT_URL = "/korean/NanumPenScript-Regular.ttf";
const KOREAN_SIZE_ADJUST = "145%";

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

/** 서버에서 .excalidraw 장면 JSON을 읽는다. */
async function fetchScene(file) {
  const response = await fetch(`/api/scene?file=${encodeURIComponent(file)}`);
  return response.json();
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

function FileList({ files, current, onSelect }) {
  if (files.length < 2) return null;
  return (
    <nav className="file-list">
      {files.map((file) => (
        <button
          key={file}
          className={file === current ? "active" : ""}
          onClick={() => onSelect(file)}
        >
          {file.replace(/\.excalidraw$/, "")}
        </button>
      ))}
    </nav>
  );
}

function Viewer({ initialFiles, initialFile }) {
  const [files, setFiles] = useState(initialFiles);
  const [current, setCurrent] = useState(initialFile);
  const [scene, setScene] = useState(null);
  const apiRef = useRef(null);

  const fitToScreen = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9 });
  }, []);

  const load = useCallback(async (file, keepView) => {
    const nextScene = await fetchScene(file);
    if (keepView && apiRef.current) {
      apiRef.current.updateScene({ elements: nextScene.elements });
      return;
    }
    setScene(nextScene);
  }, []);

  useEffect(() => {
    load(current, false);
    const url = new URL(window.location.href);
    url.searchParams.set("file", current);
    window.history.replaceState(null, "", url);
    document.title = `${current} · excali`;
  }, [current, load]);

  useEffect(() => {
    const events = new EventSource("/events");
    events.onmessage = async (event) => {
      const changed = event.data;
      if (changed === current) return load(current, true);
      const latest = await fetchFiles();
      setFiles(latest);
      if (latest.includes(changed)) setCurrent(changed);
    };
    return () => events.close();
  }, [current, load]);

  return (
    <div className="layout">
      <FileList files={files} current={current} onSelect={setCurrent} />
      <main>
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

  const files = await fetchFiles();
  const requested = new URLSearchParams(window.location.search).get("file");
  const initialFile = files.includes(requested) ? requested : files[0];
  createRoot(document.getElementById("root")).render(<Viewer initialFiles={files} initialFile={initialFile} />);
}

main();
