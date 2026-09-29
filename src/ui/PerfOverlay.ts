/** Frame-rate readout toggled with the backtick key. */

import { Vector2, type WebGLRenderer } from 'three';
import type { QualityGovernor } from '../render/Quality';

export class PerfOverlay {
  private readonly el = document.createElement('div');
  private timer = 0;
  private readonly size = new Vector2();

  constructor(parent: HTMLElement) {
    this.el.className = 'perf';
    this.el.hidden = true;
    parent.append(this.el);
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }

  update(q: QualityGovernor, d: { simMs: number; frameMs: number }, r: WebGLRenderer): void {
    if (this.el.hidden) return;
    const now = performance.now();
    if (now - this.timer < 250) return;
    this.timer = now;
    const size = r.getDrawingBufferSize(this.size);
    this.el.textContent =
      `${q.fps.toFixed(0).padStart(3)} fps  ${q.frameMs.toFixed(1)} ms\n` +
      `sim ${d.simMs.toFixed(2)} ms  frame ${d.frameMs.toFixed(2)} ms\n` +
      `${q.mode === 'auto' ? 'auto → ' : ''}${q.tier}  scale ${Math.round(q.scale * 100)}%  ${Math.round(size.x * q.scale)}×${Math.round(size.y * q.scale)}`;
  }
}
