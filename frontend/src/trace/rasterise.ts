import {
  DEFAULT_TRACE_OPTIONS,
  canvasFromImage,
  loadImage,
  svgPathFor,
  trace,
  type TraceResult,
} from './tracer';

/** paper the ink sits on — light ground is what the classifier expects */
const PAPER = '#f6f5f2';

/**
 * Render traced strokes to a PNG.
 *
 * Full frame, not cropped to the ink: the on-screen overlay is drawn in canvas
 * coordinates, so a tight crop would make the drawing jump the moment the photo
 * is swapped for it. Same box in, same box out.
 */
export async function rasteriseResult(
  result: TraceResult,
  strokeWidth: number,
  ink: string
): Promise<string> {
  const body = result.strokes
    .map((stroke) => svgPathFor(stroke, strokeWidth, ink))
    .join('\n  ');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${result.width} ${result.height}" ` +
    `width="${result.width}" height="${result.height}">\n  ${body}\n</svg>`;

  const image = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));

  const longest = Math.max(image.width, image.height, 1);
  const scale = Math.min(900 / longest, 3);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** trace a photo and hand back the drawing as a PNG */
export async function traceImage(
  imageUrl: string,
  maxDim = 900
): Promise<TraceResult> {
  const image = await loadImage(imageUrl);
  const canvas = canvasFromImage(image, maxDim);
  // skeleton follows the line through the middle of each stroke, so it reads as
  // someone drawing rather than outlining shapes
  return trace(canvas, { ...DEFAULT_TRACE_OPTIONS, mode: 'skeleton' });
}

export async function traceImageToPng(
  imageUrl: string,
  strokeWidth: number,
  ink: string
): Promise<string> {
  return rasteriseResult(await traceImage(imageUrl), strokeWidth, ink);
}
