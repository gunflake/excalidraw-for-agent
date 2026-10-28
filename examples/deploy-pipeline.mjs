import { fileURLToPath } from "node:url";
import { Scene } from "../lib/scene.mjs";

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "CI/CD 배포 파이프라인", size: 30 });

const push = scene.box({ cx: 140, cy: 200, label: "main에 병합", color: "blue" });
const test = scene.box({ cx: 540, cy: 200, label: "테스트·린트", color: "yellow" });
const passed = scene.box({ cx: 540, cy: 420, w: 200, h: 120, label: "통과?", color: "orange", shape: "diamond" });
const build = scene.box({ cx: 940, cy: 420, label: "이미지 빌드", color: "green" });
const staging = scene.box({ cx: 1340, cy: 420, label: "스테이징 배포", color: "green" });
const approve = scene.box({ cx: 1340, cy: 660, w: 200, h: 120, label: "승인?", color: "orange", shape: "diamond" });
const prod = scene.box({ cx: 940, cy: 660, label: "운영 배포", color: "purple" });
const notify = scene.box({ cx: 140, cy: 420, label: "실패 알림\n(Slack)", color: "red" });

scene.arrow(push, test, { label: "트리거" });
scene.arrow(test, passed, { fromSide: "bottom", toSide: "top" });
scene.arrow(passed, build, { label: "예" });
scene.arrow(passed, notify, { label: "아니오", color: "#e03131" });
scene.arrow(build, staging, { label: "태그 푸시" });
scene.arrow(staging, approve, { fromSide: "bottom", toSide: "top" });
scene.arrow(approve, prod, { label: "예" });
scene.group([build, staging, approve, prod], { label: "배포 단계" });

console.log(scene.save(fileURLToPath(new URL("./out/deploy-pipeline.excalidraw", import.meta.url))));
