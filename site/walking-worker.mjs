import { WalkingEngine } from './walking-engine.mjs?v=2026-10-04i';
let engine;
self.onmessage = async ({data: message}) => {
  try {
    if (message.type === 'init') {
      const response = await fetch(new URL('./data/point_walking.bin.gz?v=2026-10-04c', import.meta.url));
      if (!response.ok) throw Error(`Voirie : ${response.status}`);
      const packed = await response.arrayBuffer(), signature = new Uint8Array(packed, 0, 2);
      const buffer = signature[0] === 31 && signature[1] === 139
        ? await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : packed;
      engine = new WalkingEngine(message.data, buffer);
      self.postMessage({type: 'ready'});
    } else if (message.type === 'calculate') {
      self.postMessage({type: 'result', result: engine.calculate(message.request)});
    }
  } catch (error) {
    self.postMessage({type: 'error', message: error.message});
  }
};
