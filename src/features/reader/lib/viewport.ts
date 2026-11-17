export function constrainPan(x: number, y: number, zoom: number) {
  const limit = (zoom - 1) * 220;
  return {
    x: Math.max(-limit, Math.min(limit, x)),
    y: Math.max(-limit, Math.min(limit, y)),
  };
}
