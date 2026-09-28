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
  rightDown = false;
  /** right button released without dragging */
  rightClicked = false;
  /** mouse movement (px) while the right button is held, this frame */
  dragX = 0;
  dragY = 0;
  private dragDist = 0;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // Let text fields (workshop gun names) keep their keys.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => {
      this.down.clear();
      this.leftDown = false;
      this.rightDown = false;
    });
    el.addEventListener('mousemove', (e) => this.move(e));
    el.addEventListener('mousedown', (e) => {
      this.move(e);
      if (e.button === 0) {
        this.leftDown = true;
        this.leftPressed = true;
      }
      if (e.button === 2) {
        this.rightPressed = true;
        this.rightDown = true;
        this.dragDist = 0;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.leftDown = false;
      if (e.button === 2 && this.rightDown) {
        this.rightDown = false;
        if (this.dragDist < 6) this.rightClicked = true;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.rightDown) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
      this.dragDist += Math.abs(e.movementX) + Math.abs(e.movementY);
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
    this.rightClicked = false;
    this.dragX = 0;
    this.dragY = 0;
    this.wheel = 0;
  }
}
