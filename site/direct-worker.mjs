import {buildTravelModel, directModelSnapshot} from './routing.mjs?v=2026-10-06-live';
let data;
self.onmessage = ({data: message}) => {
  try {
    if (message.type === 'init') {
      data = message.data;
      self.postMessage({type:'ready'});
    } else if (message.type === 'calculate') {
      const request = message.request, start = performance.now();
      const model = buildTravelModel(data, request.origin, request.includeProjects,
        {...request.settings, routingVariant:'comfort'});
      const snapshot = directModelSnapshot(model);
      self.postMessage({type:'result', result:{key:request.key, settingsKey:request.settingsKey, snapshot, modelMs:performance.now()-start}}, [snapshot.accessMinutes.buffer]);
    }
  } catch (error) {
    self.postMessage({type:'error', message:error.message});
  }
};
