import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { FocalPoint } from '@novan/shared-schemas';

let nextId = 0;

const toPercent = (fraction: number): number => Math.round(fraction * 100);

/** How far each arrow key moves the point (5%). */
const arrows: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-0.05, 0],
  ArrowRight: [0.05, 0],
  ArrowUp: [0, -0.05],
  ArrowDown: [0, 0.05],
};

/**
 * Sets the part of an image to keep in view when it is cropped: click the image, focus it and use the
 * arrow keys, or use the two sliders. Crosshairs are drawn over the image. `null` means the centre.
 */
@Component({
  selector: 'nv-focal-point-picker',
  templateUrl: './focal-point-picker.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocalPointPicker {
  readonly src = input.required<string>();
  readonly value = input<FocalPoint | null>(null);
  readonly disabled = input(false);
  readonly changed = output<FocalPoint | null>();

  protected readonly id = `focal-${nextId++}`;
  protected readonly point = computed(() => this.value() ?? { x: 0.5, y: 0.5 });
  protected readonly x = computed(() => toPercent(this.point().x));
  protected readonly y = computed(() => toPercent(this.point().y));
  protected readonly description = computed(() =>
    this.value() ? `${this.x()}% from the left, ${this.y()}% from the top.` : 'Not set: crops keep the centre.',
  );

  protected pick(event: MouseEvent): void {
    // Enter and Space also "click" a button; only a pointer click says where.
    if (this.disabled() || event.detail === 0) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.emit((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  }

  /** Arrow keys move the point by 5%. */
  protected nudge(event: KeyboardEvent): void {
    const step = arrows[event.key];
    if (!step || this.disabled()) return;
    event.preventDefault();
    this.emit(this.point().x + step[0], this.point().y + step[1]);
  }

  protected setX(event: Event): void {
    this.emit(Number((event.target as HTMLInputElement).value) / 100, this.point().y);
  }

  protected setY(event: Event): void {
    this.emit(this.point().x, Number((event.target as HTMLInputElement).value) / 100);
  }

  protected clear(): void {
    this.changed.emit(null);
  }

  private emit(x: number, y: number): void {
    const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    this.changed.emit({ x: clamp(x), y: clamp(y) });
  }
}
