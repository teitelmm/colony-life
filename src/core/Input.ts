/** Keyboard + mouse state with edge-triggered key presses. */

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  /** normalised device coords */
  ndcX = 0;
  ndcY = 0;
  leftDown = false;
  rightPressed = false;
  leftPressed = false;
  wheel = 0;
  hasMouse = false;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.leftDown = false;
    });
    el.addEventListener('mousemove', (e) => this.move(e));
    el.addEventListener('mousedown', (e) => {
      this.move(e);
      if (e.button === 0) {
        this.leftDown = true;
        this.leftPressed = true;
      }
      if (e.button === 2) this.rightPressed = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
  }

  private move(e: MouseEvent): void {
    const r = this.el.getBoundingClientRect();
    this.mouseX = e.clientX - r.left;
    this.mouseY = e.clientY - r.top;
    this.ndcX = (this.mouseX / r.width) * 2 - 1;
    this.ndcY = -(this.mouseY / r.height) * 2 + 1;
    this.hasMouse = true;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
    this.leftPressed = false;
    this.rightPressed = false;
    this.wheel = 0;
  }
}
