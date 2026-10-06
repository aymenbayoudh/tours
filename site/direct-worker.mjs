import {buildTravelModel, directModelSnapshot, estimateTravelTimes, reachability, describeJourney, estimateTravel} from './routing.mjs?v=2026-10-06-live2';
let data, model, modelKey, cachedWarp, rasterKey, cachedReach, reachKey;
self.onmessage = ({data: message}) => {
  try {
    if (message.type === 'init') {
      data = message.data;
      self.postMessage({type:'ready'});
    } else if (message.type === 'calculate') {
      const request = message.request, start = performance.now();
      const key = JSON.stringify([request.origin,request.includeProjects,request.settings]);
      if (modelKey !== key) {
        model = buildTravelModel(data, request.origin, request.includeProjects,
          {...request.settings, routingVariant:'comfort'});
        modelKey = key;
      }
      const snapshot = directModelSnapshot(model);
      const result = {key:request.key, settingsKey:request.settingsKey, preview:request.preview,
        snapshot, rasterKey:request.rasterKey, modelMs:performance.now()-start};
      const transfers = [snapshot.accessMinutes.buffer];
      if (!request.preview && request.spec) {
        if (rasterKey !== request.rasterKey) {
        const {bounds,cols,rows} = request.spec;
        const cellW = (bounds[2]-bounds[0])/cols, cellH = (bounds[3]-bounds[1])/rows;
        const points=[], cells=[], validMask=Array.from({length:rows},()=>Array(cols).fill(false));
        const minutes=Array.from({length:rows},()=>new Float64Array(cols).fill(Infinity));
        const b=data.meta.bounds;
        for(let row=0;row<rows;row++)for(let col=0;col<cols;col++) {
          const point=[bounds[0]+(col+.5)*cellW,bounds[1]+(row+.5)*cellH];
          const c=Math.floor((point[0]-b[0])/(b[2]-b[0])*data.meta.gridCols),r=Math.floor((point[1]-b[1])/(b[3]-b[1])*data.meta.gridRows);
          if(c<0||r<0||c>=data.meta.gridCols||r>=data.meta.gridRows||data.mask[r*data.meta.gridCols+c]===-1)continue;
          points.push(point);cells.push([row,col]);validMask[row][col]=true;
        }
        const values=estimateTravelTimes(data,model,points);
        for(let i=0;i<cells.length;i++){const [r,c]=cells[i];minutes[r][c]=values[i];}
        cachedWarp={minutes,validMask,bounds,cellW,cellH,origin:request.origin}; rasterKey=request.rasterKey;
        }
        result.warp={...cachedWarp,minutes:cachedWarp.minutes.map(row=>row.slice())};
        const nextReachKey=`${modelKey}:${request.threshold}`;
        if (reachKey!==nextReachKey) {cachedReach=reachability(data,model,request.threshold);reachKey=nextReachKey;}
        result.reach=cachedReach;
        result.probe=request.probe;
        result.journey=request.probe ? describeJourney(data,model,request.probe) : null;
        result.probeMinutes=request.probe ? estimateTravel(data,model,request.probe) : null;
        transfers.push(...result.warp.minutes.map(row=>row.buffer));
      }
      self.postMessage({type:'result', result},transfers);
    }
  } catch (error) {
    self.postMessage({type:'error', message:error.message});
  }
};
