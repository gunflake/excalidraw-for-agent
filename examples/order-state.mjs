import { fileURLToPath } from "node:url";
import { Scene } from "../lib/scene.mjs";

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "주문 상태 전이도", size: 30 });

const created = scene.box({ cx: 160, cy: 220, label: "주문 생성", color: "gray", shape: "ellipse" });
const pending = scene.box({ cx: 640, cy: 220, label: "결제 대기", color: "yellow", shape: "ellipse" });
const paid = scene.box({ cx: 1120, cy: 220, label: "결제 완료", color: "green", shape: "ellipse" });
const shipping = scene.box({ cx: 1600, cy: 220, label: "배송 중", color: "blue", shape: "ellipse" });
const delivered = scene.box({ cx: 1600, cy: 520, label: "배송 완료", color: "purple", shape: "ellipse" });
const canceled = scene.box({ cx: 640, cy: 520, label: "취소", color: "red", shape: "ellipse" });
const refunded = scene.box({ cx: 1120, cy: 520, label: "환불", color: "red", shape: "ellipse" });

scene.arrow(created, pending, { label: "장바구니 결제" });
scene.arrow(pending, paid, { label: "결제 승인" });
scene.arrow(paid, shipping, { label: "출고" });
scene.arrow(shipping, delivered, { label: "수령 확인", fromSide: "bottom", toSide: "top" });
scene.arrow(pending, canceled, { label: "30분 초과", fromSide: "bottom", toSide: "top", color: "#e03131", dashed: true });
scene.arrow(paid, refunded, { label: "출고 전 취소", fromSide: "bottom", toSide: "top", color: "#e03131", dashed: true });

console.log(scene.save(fileURLToPath(new URL("./out/order-state.excalidraw", import.meta.url))));
