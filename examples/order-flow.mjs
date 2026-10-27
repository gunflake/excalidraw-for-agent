import { Scene } from "../lib/scene.mjs";

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "주문 결제 흐름", size: 30 });

const client = scene.box({ cx: 130, cy: 200, label: "사용자 앱", color: "blue" });
const api = scene.box({ cx: 600, cy: 200, label: "주문 API", color: "yellow" });
const check = scene.box({ cx: 600, cy: 440, w: 200, h: 120, label: "재고 있음?", color: "orange", shape: "diamond" });
const payment = scene.box({ cx: 1000, cy: 440, label: "결제 서버\n(PG 연동)", color: "purple" });
const soldOut = scene.box({ cx: 600, cy: 680, label: "품절 안내", color: "red" });
const db = scene.box({ cx: 1000, cy: 200, label: "주문 DB", color: "gray", shape: "ellipse" });

scene.arrow(client, api, { label: "POST /orders" });
scene.arrow(api, check, { fromSide: "bottom", toSide: "top" });
scene.arrow(check, payment, { label: "예", fromSide: "right", toSide: "left" });
scene.arrow(check, soldOut, { label: "아니오", fromSide: "bottom", toSide: "top", color: "#e03131" });
scene.arrow(payment, db, { label: "승인 결과 저장", fromSide: "top", toSide: "bottom" });
scene.arrow(api, db, { label: "주문 생성", dashed: true });
scene.group([api, check, payment, db], { label: "백엔드" });

console.log(scene.save(new URL("./out/order-flow.excalidraw", import.meta.url).pathname));
