import { fileURLToPath } from "node:url";
import { Scene } from "../lib/scene.mjs";

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "웹 서비스 구조도", size: 30 });

const browser = scene.box({ cx: 130, cy: 300, label: "브라우저 / 앱", color: "blue" });
const cdn = scene.box({ cx: 540, cy: 140, label: "CDN\n(정적 파일)", color: "gray" });
const lb = scene.box({ cx: 540, cy: 300, label: "로드 밸런서", color: "yellow" });
const api1 = scene.box({ cx: 940, cy: 220, label: "API 서버 1", color: "green" });
const api2 = scene.box({ cx: 940, cy: 380, label: "API 서버 2", color: "green" });
const cache = scene.box({ cx: 1340, cy: 140, label: "Redis 캐시", color: "red", shape: "ellipse" });
const db = scene.box({ cx: 1340, cy: 300, label: "PostgreSQL", color: "purple", shape: "ellipse" });
const queue = scene.box({ cx: 1340, cy: 500, label: "메시지 큐", color: "orange" });
const worker = scene.box({ cx: 900, cy: 640, label: "백그라운드 워커\n(메일·알림)", color: "orange" });

scene.arrow(browser, cdn, { label: "이미지·JS" });
scene.arrow(browser, lb, { label: "HTTPS" });
scene.arrow(lb, api1);
scene.arrow(lb, api2);
scene.arrow(api1, cache, { dashed: true });
scene.arrow(api1, db);
scene.arrow(api2, db);
scene.arrow(api2, queue, { label: "작업 등록" });
scene.arrow(queue, worker, { label: "꺼내서 처리" });
scene.group([api1, api2, cache, db, queue, worker], { label: "사설 네트워크 (VPC)" });

console.log(scene.save(fileURLToPath(new URL("./out/web-architecture.excalidraw", import.meta.url))));
