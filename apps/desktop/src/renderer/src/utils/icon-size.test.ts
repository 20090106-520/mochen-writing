import { describe, expect, it } from "vitest";
import {
  ICON_SIZE_MAX,
  ICON_SIZE_MIN,
  ICON_SIZE_SNAP_FLOOR,
  ICON_SIZE_STEPS,
  snapIconSize
} from "./icon-size";
import { templateSource, scriptSource } from "./vue-source-reader";

describe("图标尺寸吸附：八档，区间外不动，平局取大", () => {
  it("阶梯是 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32", () => {
    expect([...ICON_SIZE_STEPS]).toEqual([12, 14, 16, 18, 20, 24, 28, 32]);
    expect(ICON_SIZE_MIN).toBe(12);
    expect(ICON_SIZE_MAX).toBe(32);
  });

  it("本来就在档上的值一个不动", () => {
    for (const step of ICON_SIZE_STEPS) expect(snapIconSize(step)).toBe(step);
  });

  it("13 / 15 / 17 / 22 / 26 吸到最近档；15 与 26 的平局取较大一档", () => {
    expect(snapIconSize(13)).toBe(14);
    expect(snapIconSize(15)).toBe(16);
    expect(snapIconSize(17)).toBe(18);
    expect(snapIconSize(22)).toBe(24);
    expect(snapIconSize(26)).toBe(28);
  });

  it("小于 11 的角标与大于 32 的头像保持原样", () => {
    expect(ICON_SIZE_SNAP_FLOOR).toBe(11);
    expect(snapIconSize(9)).toBe(9);
    expect(snapIconSize(10)).toBe(10);
    // 11 抬到 12：0.92 CSS px 的描边在 1.5 倍屏上发灰，抬一档才够一个设备像素。
    expect(snapIconSize(11)).toBe(12);
    expect(snapIconSize(40)).toBe(40);
    expect(snapIconSize(120)).toBe(120);
  });

  it("幂等：吸过一次的值再吸不变（组件重渲染不会漂）", () => {
    for (let size = 0; size <= 48; size += 1) {
      expect(snapIconSize(snapIconSize(size))).toBe(snapIconSize(size));
    }
  });
});

describe("AppIcon 接线：模板与描边都读吸附后的尺寸", () => {
  const template = templateSource("components/AppIcon.vue");
  const script = scriptSource("components/AppIcon.vue");

  it("宽高读 box，不再直接用 props.size", () => {
    expect(template).toContain(':width="box"');
    expect(template).toContain(':height="box"');
    expect(template).not.toContain(':width="size"');
  });

  it("描边补偿也读 box：15 被吸到 16 时线宽跟着换档", () => {
    expect(script).toContain("snapIconSize(props.size)");
    expect(script).toContain("box.value >= 16");
    expect(script).not.toContain("props.size >= 16");
  });
});
