import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const COLORS = {
  blue: { background: "#a5d8ff", stroke: "#1e1e1e", text: "#1e1e1e" },
  green: { background: "#b2f2bb", stroke: "#1e1e1e", text: "#1e1e1e" },
  yellow: { background: "#ffec99", stroke: "#1e1e1e", text: "#1e1e1e" },
  orange: { background: "#ffd8a8", stroke: "#1e1e1e", text: "#1e1e1e" },
  purple: { background: "#d0bfff", stroke: "#1e1e1e", text: "#1e1e1e" },
  gray: { background: "#e9ecef", stroke: "#1e1e1e", text: "#1e1e1e" },
  red: { background: "#ffc9c9", stroke: "#e03131", text: "#e03131" },
  white: { background: "#ffffff", stroke: "#1e1e1e", text: "#1e1e1e" },
  none: { background: "transparent", stroke: "#1e1e1e", text: "#1e1e1e" },
};

const FONT_FAMILY = 5;
const LINE_HEIGHT = 1.25;
const BOX_PADDING_X = 28;
const BOX_PADDING_Y = 18;
const ARROW_GAP = 6;
const ARROW_LABEL_CLEARANCE = 100;
const LIFELINE_COLOR = "#868e96";

/** 글자 하나의 폭을 글자 크기 대비 비율로 어림한다. */
function charWidthRatio(ch) {
  if (ch.codePointAt(0) > 0x2e80) return 1.15;
  if (/[A-Z]/.test(ch)) return 0.72;
  if (/[a-z0-9]/.test(ch)) return 0.6;
  if (ch === " ") return 0.4;
  return 0.5;
}

/** 글자 종류별 폭을 더해 텍스트 크기를 어림한다. */
export function measureText(text, fontSize) {
  const lines = String(text).split("\n");
  const widest = Math.max(...lines.map((line) => [...line].reduce((sum, ch) => sum + charWidthRatio(ch), 0)));
  return { width: widest * fontSize, height: lines.length * fontSize * LINE_HEIGHT };
}

/** 도형의 중심 좌표를 돌려준다. */
export function center(shape) {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

/** 중심에서 상대 쪽으로 그은 선이 도형 테두리와 만나는 점을 구한다. */
function edgePoint(shape, toward) {
  const c = center(shape);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = shape.width / 2 + ARROW_GAP;
  const halfH = shape.height / 2 + ARROW_GAP;
  const scale = Math.min(dx === 0 ? Infinity : halfW / Math.abs(dx), dy === 0 ? Infinity : halfH / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

const SIDE_OFFSETS = {
  top: (shape) => ({ x: shape.x + shape.width / 2, y: shape.y - ARROW_GAP }),
  bottom: (shape) => ({ x: shape.x + shape.width / 2, y: shape.y + shape.height + ARROW_GAP }),
  left: (shape) => ({ x: shape.x - ARROW_GAP, y: shape.y + shape.height / 2 }),
  right: (shape) => ({ x: shape.x + shape.width + ARROW_GAP, y: shape.y + shape.height / 2 }),
};

export class Scene {
  constructor({ background = "#ffffff", seed = 1 } = {}) {
    this.elements = [];
    this.background = background;
    this.seed = seed;
    this.counter = 0;
  }

  nextSeed() {
    this.seed = (this.seed * 48271) % 2147483647;
    return this.seed;
  }

  add(type, fields) {
    this.counter += 1;
    const element = {
      id: `${type}-${this.counter}`,
      type,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: this.nextSeed(),
      version: 1,
      versionNonce: this.nextSeed(),
      isDeleted: false,
      boundElements: [],
      updated: 1,
      link: null,
      locked: false,
      ...fields,
    };
    this.elements.push(element);
    return element;
  }

  /** 자유 위치 텍스트를 만든다. align은 x 기준점(left/center/right)이다. */
  text({ x, y, text, size = 20, color = "#1e1e1e", align = "left" }) {
    const { width, height } = measureText(text, size);
    const left = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
    return this.add("text", {
      x: left, y, width, height, strokeColor: color, text, originalText: text,
      fontSize: size, fontFamily: FONT_FAMILY, textAlign: align, verticalAlign: "top",
      containerId: null, autoResize: true, lineHeight: LINE_HEIGHT,
    });
  }

  /** 컨테이너(도형·화살표) 안에 묶인 텍스트를 만든다. */
  boundText(container, text, size, color) {
    const { width, height } = measureText(text, size);
    const middle = container.type === "arrow"
      ? { x: container.x + container.points.at(-1)[0] / 2, y: container.y + container.points.at(-1)[1] / 2 }
      : center(container);
    const label = this.add("text", {
      x: middle.x - width / 2, y: middle.y - height / 2, width, height, strokeColor: color,
      text, originalText: text, fontSize: size, fontFamily: FONT_FAMILY, textAlign: "center",
      verticalAlign: "middle", containerId: container.id, autoResize: true, lineHeight: LINE_HEIGHT,
    });
    container.boundElements.push({ type: "text", id: label.id });
    return label;
  }

  /**
   * 라벨이 들어간 도형을 만든다.
   * x, y를 주면 왼쪽 위 기준, cx, cy를 주면 중심 기준이다. w, h를 빼면 라벨 크기에 맞춘다.
   */
  box({ x, y, cx, cy, w, h, label = "", color = "blue", size = 20, shape = "rectangle", dashed = false }) {
    const palette = COLORS[color] ?? COLORS.blue;
    const measured = measureText(label || " ", size);
    const shapeScale = shape === "rectangle" ? 1 : 1.45;
    const width = w ?? Math.max(120, (measured.width + BOX_PADDING_X * 2) * shapeScale);
    const height = h ?? Math.max(56, (measured.height + BOX_PADDING_Y * 2) * shapeScale);
    const element = this.add(shape, {
      x: x ?? cx - width / 2, y: y ?? cy - height / 2, width, height,
      backgroundColor: palette.background, strokeColor: palette.stroke,
      strokeStyle: dashed ? "dashed" : "solid",
      roundness: shape === "rectangle" ? { type: 3 } : { type: 2 },
    });
    if (label) this.boundText(element, label, size, palette.text);
    return element;
  }

  /**
   * 두 도형을 잇는 화살표를 만들고 양쪽에 바인딩한다.
   * fromSide/toSide(top/bottom/left/right)를 빼면 서로 마주 보는 테두리 점을 쓴다.
   */
  arrow(from, to, { label, dashed = false, color = "#1e1e1e", size = 18, fromSide, toSide, head = "arrow", tail = null } = {}) {
    const start = fromSide ? SIDE_OFFSETS[fromSide](from) : edgePoint(from, center(to));
    const end = toSide ? SIDE_OFFSETS[toSide](to) : edgePoint(to, center(from));
    const arrow = this.add("arrow", {
      x: start.x, y: start.y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y),
      points: [[0, 0], [end.x - start.x, end.y - start.y]], strokeColor: color,
      strokeStyle: dashed ? "dashed" : "solid", lastCommittedPoint: null,
      startBinding: { elementId: from.id, focus: 0, gap: ARROW_GAP },
      endBinding: { elementId: to.id, focus: 0, gap: ARROW_GAP },
      startArrowhead: tail, endArrowhead: head, elbowed: false, roundness: { type: 2 },
    });
    from.boundElements.push({ type: "arrow", id: arrow.id });
    to.boundElements.push({ type: "arrow", id: arrow.id });
    if (label) this.boundText(arrow, label, size, color);
    return arrow;
  }

  /** 도형에 묶이지 않은 화살표 또는 선을 점 목록으로 만든다. points는 절대 좌표다. */
  path(points, { arrow = true, dashed = false, color = "#1e1e1e", width = 2 } = {}) {
    const [first] = points;
    const relative = points.map(([px, py]) => [px - first[0], py - first[1]]);
    const xs = relative.map(([px]) => px);
    const ys = relative.map(([, py]) => py);
    return this.add(arrow ? "arrow" : "line", {
      x: first[0], y: first[1], width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      points: relative, strokeColor: color, strokeWidth: width, strokeStyle: dashed ? "dashed" : "solid",
      lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: null, endArrowhead: arrow ? "arrow" : null,
    });
  }

  /** 여러 도형을 감싸는 점선 영역과 제목을 만든다. */
  group(shapes, { label, color = "gray", padding = 30, size = 18 } = {}) {
    const left = Math.min(...shapes.map((s) => s.x)) - padding;
    const top = Math.min(...shapes.map((s) => s.y)) - padding - (label ? size * 1.6 : 0);
    const right = Math.max(...shapes.map((s) => s.x + s.width)) + padding;
    const bottom = Math.max(...shapes.map((s) => s.y + s.height)) + padding;
    const palette = COLORS[color] ?? COLORS.gray;
    const frame = this.add("rectangle", {
      x: left, y: top, width: right - left, height: bottom - top, backgroundColor: "transparent",
      strokeColor: palette.stroke === "#1e1e1e" ? LIFELINE_COLOR : palette.stroke,
      strokeStyle: "dashed", strokeWidth: 1, roundness: { type: 3 }, customData: { role: "group" },
    });
    this.elements.splice(this.elements.indexOf(frame), 1);
    this.elements.unshift(frame);
    if (label) this.text({ x: left + 14, y: top + 10, text: label, size, color: LIFELINE_COLOR });
    return frame;
  }

  /**
   * 시퀀스 다이어그램을 그린다.
   * participants: [{ label, color }]
   * steps: { from, to, label, dashed } 메시지 또는 { note, over: [i, j], color } 메모. from/to/over는 참여자 번호다.
   */
  sequence({ x = 60, y = 100, participants, steps, gap = 360, rowHeight = 80, headWidth = 220 }) {
    const centers = participants.map((_, index) => x + headWidth / 2 + index * gap);
    const heads = participants.map((participant, index) =>
      this.box({ cx: centers[index], y, w: headWidth, h: 64, label: participant.label, color: participant.color ?? "blue" }),
    );
    let cursor = y + 64 + rowHeight;
    const drawn = [];
    for (const step of steps) {
      if (step.note) {
        const [first, last] = step.over;
        const left = centers[Math.min(first, last)] - headWidth / 2 + 10;
        const right = centers[Math.max(first, last)] + headWidth / 2 - 10;
        const note = this.box({ cx: (left + right) / 2, y: cursor - rowHeight / 2, w: Math.max(right - left, measureText(step.note, 20).width + 56), label: step.note, color: step.color ?? "yellow" });
        cursor = note.y + note.height + rowHeight;
        drawn.push(note);
        continue;
      }
      const startX = centers[step.from];
      const endX = centers[step.to];
      this.path([[startX, cursor], [endX, cursor]], { dashed: step.dashed, color: step.color ?? "#1e1e1e" });
      this.text({ x: (startX + endX) / 2, y: cursor - 32, text: step.label, size: 18, align: "center", color: step.color ?? "#1e1e1e" });
      cursor += rowHeight;
    }
    const bottom = cursor;
    heads.forEach((head, index) => {
      const lifeline = this.path([[centers[index], head.y + head.height], [centers[index], bottom]], { arrow: false, dashed: true, color: LIFELINE_COLOR, width: 1 });
      this.elements.splice(this.elements.indexOf(lifeline), 1);
      this.elements.unshift(lifeline);
    });
    return { heads, notes: drawn, bottom };
  }

  /** 라벨이 화살표보다 긴 곳과 도형끼리 겹치는 곳을 찾아 경고 문장 목록으로 돌려준다. */
  lint() {
    const warnings = [];
    const byId = new Map(this.elements.map((element) => [element.id, element]));
    const labelOf = (element) => {
      const bound = element.boundElements.find((item) => item.type === "text");
      return bound ? byId.get(bound.id).text.replace(/\n/g, " ") : element.id;
    };

    for (const arrow of this.elements.filter((element) => element.type === "arrow")) {
      const label = arrow.boundElements.find((item) => item.type === "text");
      if (!label) continue;
      const [dx, dy] = arrow.points.at(-1);
      const length = Math.hypot(dx, dy);
      const text = byId.get(label.id);
      const needed = (Math.abs(dx) >= Math.abs(dy) ? text.width : text.height) + ARROW_LABEL_CLEARANCE;
      if (length < needed) warnings.push(`화살표 라벨 "${text.text}"이 화살표보다 깁니다 (화살표 ${Math.round(length)}px, 필요 ${Math.round(needed)}px 이상). 도형 간격을 넓히세요.`);
    }

    const shapes = this.elements.filter((element) => ["rectangle", "ellipse", "diamond"].includes(element.type) && element.customData?.role !== "group");
    shapes.forEach((a, index) => {
      shapes.slice(index + 1).forEach((b) => {
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapX > 0 && overlapY > 0) warnings.push(`도형 "${labelOf(a)}"와 "${labelOf(b)}"가 겹칩니다.`);
      });
    });
    return warnings;
  }

  /** .excalidraw 파일로 저장하고, 점검 경고가 있으면 stderr로 알린다. */
  save(path) {
    this.lint().forEach((warning) => console.warn(`[excali 점검] ${warning}`));
    mkdirSync(dirname(path), { recursive: true });
    const document = {
      type: "excalidraw",
      version: 2,
      source: "excalidraw-for-agent",
      elements: this.elements,
      appState: { viewBackgroundColor: this.background, gridSize: null },
      files: {},
    };
    writeFileSync(path, JSON.stringify(document, null, 2));
    return path;
  }
}
