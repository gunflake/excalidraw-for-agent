import { Scene } from "../lib/scene.mjs";

const scene = new Scene();
scene.text({ x: 60, y: 20, text: "Kafka 리밸런싱으로 생기는 중복 처리", size: 30 });
scene.sequence({
  y: 100,
  participants: [
    { label: "컨슈머 A", color: "blue" },
    { label: "Kafka\n파티션 0", color: "yellow" },
    { label: "컨슈머 B", color: "green" },
  ],
  steps: [
    { from: 0, to: 1, label: "① poll() → 오프셋 100~199" },
    { note: "② 100~149 처리 (DB 저장)", over: [0, 0], color: "blue" },
    { note: "③ 커밋 전에 리밸런싱 발생\n커밋된 오프셋 = 100", over: [0, 1], color: "red" },
    { from: 1, to: 2, label: "④ 파티션 0 할당", dashed: true },
    { from: 2, to: 1, label: "⑤ 오프셋 100부터 다시 읽기" },
    { note: "⑥ 100~149 다시 처리\n⚠ 중복!", over: [2, 2], color: "red" },
  ],
});
console.log(scene.save(new URL("./out/kafka-rebalance.excalidraw", import.meta.url).pathname));
