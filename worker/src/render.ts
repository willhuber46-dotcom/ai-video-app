import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeZooms, zoomRamp, type OverlayDoc, type Zoom } from '@app/shared';

import { FFMPEG, probe, run } from './ffmpeg';
import { renderOverlayTrack } from './overlay-render';

/**
 * FFmpeg expressions matching zoomAt() in @app/shared: a smoothstep ramp in
 * and out of each zoom, aimed at the zoom's focus point.
 */
export function zoomExpressions(zooms: Zoom[]): { scale: string; focusX: string; focusY: string } {
  const f = (n: number) => n.toFixed(4);
  const terms = zooms.map((z) => {
    const r = zoomRamp(z);
    const u = `min(min((t-${f(z.start)})/${f(r)},(${f(z.end)}-t)/${f(r)}),1)`;
    return `if(between(t,${f(z.start)},${f(z.end)}),${f(z.scale - 1)}*${u}*${u}*(3-2*${u}),0)`;
  });
  const focus = (axis: 'x' | 'y') =>
    zooms.reduceRight((rest, z) => `if(between(t,${f(z.start)},${f(z.end)}),${f(z[axis])},${rest})`, '0.5');
  return { scale: `1+${terms.join('+')}`, focusX: focus('x'), focusY: focus('y') };
}

export async function renderFinal(opts: { input: string; doc: OverlayDoc; output: string; workDir: string }): Promise<void> {
  const { input, doc, output, workDir } = opts;
  const source = await probe(input);
  const W = source.width;
  const H = source.height;
  if (!W || !H) throw new Error('Could not read video size');

  const zooms = normalizeZooms(doc.zooms, source.duration);
  const overlayList = await renderOverlayTrack({ doc, width: W, height: H, duration: source.duration, workDir });

  const chains: string[] = [];
  let video = '[0:v]';
  if (zooms.length > 0) {
    const z = zoomExpressions(zooms);
    chains.push(
      `${video}scale=w='trunc(${W}*(${z.scale})/2)*2':h='trunc(${H}*(${z.scale})/2)*2':eval=frame:flags=bicubic,` +
        `crop=w=${W}:h=${H}:x='clip((${z.focusX})*iw-${W}/2,0,iw-${W})':y='clip((${z.focusY})*ih-${H}/2,0,ih-${H})'[zoomed]`,
    );
    video = '[zoomed]';
  }
  if (overlayList) {
    chains.push(`[1:v]format=rgba[ov]`, `${video}[ov]overlay=0:0:eof_action=repeat:format=auto[over]`);
    video = '[over]';
  }
  chains.push(`${video}format=yuv420p[vout]`);

  const script = path.join(workDir, 'filters.txt');
  await writeFile(script, chains.join(';\n'));

  const args = ['-y', '-i', input];
  if (overlayList) args.push('-f', 'concat', '-safe', '0', '-i', overlayList);
  args.push(
    '-filter_complex_script', script,
    '-map', '[vout]',
    '-map', '0:a?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    output,
  );
  await run(FFMPEG, args);
}
