export const PALETTE = ["#2f80ed", "#eb5757", "#27ae60", "#f2994a", "#9b51e0", "#00a3a3", "#d6336c", "#8a6d3b", "#5c7cfa", "#e8590c", "#f2c94c", "#4f4f4f"];

export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Kolor projektu: wybrany przez użytkownika albo stały kolor wyliczony z id. */
export function projectColor(id: number, color?: string | null): string {
  return color && COLOR_RE.test(color) ? color : PALETTE[Math.abs(id) % PALETTE.length];
}
