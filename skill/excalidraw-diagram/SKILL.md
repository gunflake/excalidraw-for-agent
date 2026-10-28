---
name: excalidraw-diagram
description: 구조, 흐름, 순서, 관계를 손그림 느낌의 Excalidraw 다이어그램으로 그려 PNG와 로컬 뷰어로 보여 주는 스킬이다. 에이전트가 excali CLI와 Scene API로 .excalidraw 파일을 만들고, 사람은 결과를 확인만 한다. 사용자가 "그림으로 설명해줘", "다이어그램으로 그려줘", "excalidraw로 그려줘", "구조도 그려줘", "흐름도 그려줘", "시퀀스 다이어그램", "아키텍처 그림", "도식화해줘"처럼 말하거나, 설명하던 시스템·흐름을 그림으로 보여 달라고 하면 Mermaid나 ASCII 대신 반드시 이 스킬을 쓴다. "책처럼"이 들어간 학습 책 요청(learn), /eli5 요청, 데이터 차트·그래프(dataviz)에는 쓰지 않는다.
---

# Excalidraw 다이어그램

에이전트가 그리고, 사람은 확인한다. 그림은 JS 스크립트(`~/diagrams/src/<이름>.mjs`)로 만들고, `excali build`로 `.excalidraw`와 `.png`를 만든 뒤, PNG를 직접 보고 고친다. 다 되면 PNG를 대화창에 보내고 뷰어를 연다.

`excali`가 없으면(`command -v excali` 실패) https://github.com/gunflake/excalidraw-for-agent 를 clone 해서 `./install.sh`(Windows는 `install.ps1`)를 실행하라고 안내하고 멈춘다.

## 작업 순서

1. **무엇을 그릴지 정한다.** 그림 하나에 메시지 하나. 상자는 대략 12개 이하로 둔다. 더 많으면 그림을 나눈다. 아래 "그림 종류 고르기"로 형태를 고른다.
2. **틀을 만든다.** `excali new <이름>` → `~/diagrams/src/<이름>.mjs`가 생긴다. 이름은 영문 kebab-case(`order-flow`). 이미 있으면 그 파일을 고친다.
3. **스크립트를 쓴다.** 아래 Scene API로 도형과 화살표를 놓는다. import 줄과 마지막 `scene.save(...)` 줄은 틀이 만든 그대로 둔다.
4. **빌드한다.** `excali build <이름>` → `~/diagrams/<이름>.excalidraw`, `~/diagrams/<이름>.png`.
   - `[excali 점검]` 경고가 나오면 반드시 고치고 다시 빌드한다. 라벨이 화살표보다 길면 도형 간격을 넓히고, 도형이 겹치면 좌표를 옮긴다.
5. **PNG를 직접 본다.** Read 도구로 `~/diagrams/<이름>.png`를 열어 확인한다. 점검이 못 잡는 문제(화살표가 다른 도형을 가로지름, 라벨이 선과 겹침, 한쪽으로 쏠린 배치, 읽는 순서가 어색함)를 찾아 3~4단계를 반복한다. 보통 2~3번이면 끝난다.
6. **보여 준다.**
   - `excali -d ~/diagrams/<이름>.excalidraw` 로 뷰어를 연다. 이미 떠 있으면 열린 화면이 이 그림으로 넘어간다.
   - PNG를 대화창에 보낸다. 파일 전송 도구(SendUserFile 등)가 있으면 그것을 쓰고, 없으면 PNG 경로를 알려 준다.
   - 그림에 대한 설명은 2~4줄로 짧게 붙인다. 그림이 하는 말을 글로 다시 풀지 않는다.

## Scene API

```js
const scene = new Scene();

scene.text({ x, y, text, size = 20, color, align = "left" | "center" | "right" });

const a = scene.box({
  cx, cy,              // 중심 좌표 (또는 x, y = 왼쪽 위)
  label: "주문 API",    // "\n"으로 줄바꿈
  color: "blue",        // blue green yellow orange purple gray red white none
  shape: "rectangle",   // rectangle | ellipse | diamond
  w, h,                 // 빼면 라벨 크기에 맞춤 (최소 120x56)
  size: 20, dashed: false,
});

scene.arrow(a, b, {
  label: "POST /orders",
  fromSide: "right", toSide: "left",  // top bottom left right, 빼면 서로 마주 보는 점
  dashed: false, color: "#1e1e1e", size: 18,
  head: "arrow", tail: null,          // 양방향은 tail: "arrow"
});

scene.path([[x1, y1], [x2, y2], [x3, y3]], { arrow: true, dashed, color, width }); // 도형에 안 묶인 꺾은선

scene.group([a, b, c], { label: "백엔드", padding: 30 });  // 점선 영역, 맨 뒤로 깔림

scene.sequence({
  x: 60, y: 100, gap: 360, rowHeight: 80,
  participants: [{ label: "클라이언트", color: "blue" }, { label: "서버", color: "yellow" }],
  steps: [
    { from: 0, to: 1, label: "① 요청" },
    { from: 1, to: 0, label: "② 응답", dashed: true },
    { note: "③ 타임아웃 발생", over: [0, 1], color: "red" },
  ],
});
```

`box`와 `arrow`는 Excalidraw 요소를 돌려준다. 다른 도형 위치를 정할 때 `a.x`, `a.y`, `a.width`, `a.height`를 쓸 수 있다.

## 그림 종류 고르기

| 보여 줄 것 | 형태 | 방법 |
|---|---|---|
| 시간 순서, 요청과 응답 | 시퀀스 | `sequence()` |
| 처리 단계, 분기 | 흐름도 | 왼쪽→오른쪽 또는 위→아래로 `box` + `arrow`, 분기는 `shape: "diamond"` |
| 구성 요소와 연결 | 구조도 | 역할별로 `group()`으로 묶고 층(클라이언트 → 서버 → 저장소)으로 배치 |
| 상태 변화 | 상태도 | `shape: "ellipse"` 상태 + 전이 라벨 화살표 |
| 전후 비교 | 나란히 두 그림 | 왼쪽 "전", 오른쪽 "후" 영역을 `group()`으로 |

## 배치 규칙

- **간격:** 가로 이웃 도형은 중심 간격 360~450px, 세로는 200~240px. 화살표 라벨이 길수록 더 띄운다. 좁게 붙이면 라벨이 선을 덮는다.
- **격자:** 좌표는 대략 격자(가로 열, 세로 행)에 맞춘다. 같은 행의 도형은 `cy`를 같게 둔다. 정렬된 그림이 훨씬 깔끔해 보인다.
- **흐름 방향:** 주 흐름은 한 방향으로만 흐르게 한다. 되돌아가는 화살표는 `dashed: true` 로 구분한다.
- **색의 의미:** 색은 역할을 나타낼 때만 쓴다. 한 그림에 3~4색이면 충분하다.
  - blue 클라이언트·진입점, yellow 서비스·처리, purple 외부 시스템, gray 저장소, green 성공·완료, orange 판단·대기, red 오류·위험
- **라벨:** 상자 라벨은 명사 2~8자, 화살표 라벨은 동작이나 데이터 이름. 문장을 넣지 않는다. 길면 `\n`으로 두 줄.
- **제목:** 맨 위 `scene.text({ x: 60, y: 20, text: "...", size: 30 })`. 제목은 그림이 말하려는 결론을 담는다.
- **번호:** 순서가 중요하면 라벨 앞에 ①②③을 붙인다.

## 주의할 점

깔끔한 그림은 실제보다 확실해 보인다. 확인하지 않은 연결이나 추정한 흐름은 `dashed: true`로 그리고, 설명에 "추정"이라고 밝힌다. 코드나 문서에서 확인한 사실만 실선으로 그린다.

## 그 밖의 명령

- `excali png <파일.excalidraw> [출력.png]`: 이미 있는 .excalidraw를 PNG로 만든다.
- `excali ~/diagrams`: 그림 폴더 전체를 뷰어로 연다. 파일이 2개 이상이면 왼쪽에 목록이 나온다.
- `excali stop`: 백그라운드 뷰어를 모두 끈다.
- 예시 스크립트: 이 스킬이 있는 저장소의 `examples/kafka-rebalance.mjs`(시퀀스), `examples/order-flow.mjs`(흐름도와 group), `examples/web-architecture.mjs`(구조도), `examples/order-state.mjs`(상태 전이도, ellipse), `examples/deploy-pipeline.mjs`(판단이 두 번 있는 파이프라인).
