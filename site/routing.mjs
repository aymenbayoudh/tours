// Pure routing core: directed, observed stopping patterns; estimated waiting.
class MinHeap {
  constructor() { this.items = []; }
  push(item) { const a=this.items; a.push(item); let i=a.length-1; while(i>0){const p=(i-1)>>1;if(a[p][0]<=item[0])break;a[i]=a[p];i=p;}a[i]=item; }
  pop() {const a=this.items;if(!a.length)return null;const first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1][0]<a[c][0])c++;if(a[c][0]>=last[0])break;a[i]=a[c];i=c;}a[i]=last;}return first;}
  get length(){return this.items.length;}
}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function buildTravelModel(data, origin, includeProjects=true) {
  const distances=new Float64Array(data.routeStates.length).fill(Infinity);
  const previous=new Int32Array(data.routeStates.length).fill(-1);
  const allowed=data.routeStates.map(s=>includeProjects||!data.routeInfo[s.routeId]?.planned);
  const queue=new MinHeap();
  // Consider every possible boarding stop, not just the closest handful.
  data.stations.forEach((station,index)=>{
    const access=distance(origin,station.point)/data.meta.walkMetersPerMinute+data.meta.stationAccessPenalty;
    for(const node of data.boardingStates[index]||[]){
      if(!allowed[node])continue;
      const value=access+(data.routeWaits[data.routeStates[node].routeId]??data.meta.defaultBoardWait);
      if(value<distances[node]){distances[node]=value;queue.push([value,node]);}
    }
  });
  while(queue.length){
    const [value,node]=queue.pop();if(value!==distances[node])continue;
    for(const [next,cost] of data.adjacency[node]){
      if(!allowed[next])continue;
      const candidate=value+cost;
      if(candidate<distances[next]){distances[next]=candidate;previous[next]=node;queue.push([candidate,next]);}
    }
  }
  const stationArrivals=data.stationStates.map(nodes=>{
    let best=Infinity,node=-1;
    for(const n of nodes)if(allowed[n]&&distances[n]<best){best=distances[n];node=n;}
    return {minutes:best,node};
  });
  const activeStations=data.boardingStates.map(nodes=>nodes.some(n=>allowed[n]));
  return {origin,includeProjects,distances,previous,stationArrivals,activeStations};
}
export function estimateTravel(data, model, destination, details=false) {
  const walk=data.meta.walkMetersPerMinute,access=data.meta.stationAccessPenalty;
  let best=distance(model.origin,destination)/walk,bestStation=-1;
  for(let i=0;i<data.stations.length;i++){
    const arrival=model.stationArrivals[i].minutes+access;
    if(arrival>=best)continue;
    const point=data.stations[i].point,remaining=(best-arrival)*walk;
    if(Math.abs(point[0]-destination[0])>=remaining||Math.abs(point[1]-destination[1])>=remaining)continue;
    const value=arrival+distance(point,destination)/walk;
    if(value<best){best=value;bestStation=i;}
  }
  return details?{minutes:best,station:bestStation}:best;
}
export function reachability(data, model, threshold) {
  let reachable=0,total=0;
  data.stations.forEach((station,i)=>{if(!model.activeStations[i])return;total++;if(estimateTravel(data,model,station.point)<=threshold+1e-7)reachable++;});
  return {reachable,total};
}
export function describeJourney(data,model,destination) {
  const result=estimateTravel(data,model,destination,true);
  if(result.station<0)return {minutes:result.minutes,legs:[],walking:result.minutes,waiting:0};
  const nodes=[];let n=model.stationArrivals[result.station].node;
  while(n>=0){nodes.push(n);n=model.previous[n];}nodes.reverse();
  const legs=[];
  for(let i=1;i<nodes.length;i++){
    const a=data.routeStates[nodes[i-1]],b=data.routeStates[nodes[i]];
    if(a.role!=='departure'||b.role!=='arrival'||a.stationIndex===b.stationIndex)continue;
    const last=legs.at(-1);
    if(last&&last.pattern===a.pattern&&last.routeId===a.routeId&&last.to===a.stationIndex){last.to=b.stationIndex;last.end=model.distances[nodes[i]];last.minutes=last.end-last.start;}
    else legs.push({routeId:a.routeId,pattern:a.pattern,from:a.stationIndex,to:b.stationIndex,start:model.distances[nodes[i-1]],end:model.distances[nodes[i]],minutes:model.distances[nodes[i]]-model.distances[nodes[i-1]]});
  }
  const first=data.routeStates[nodes[0]].stationIndex;
  let walking=(distance(model.origin,data.stations[first].point)+distance(destination,data.stations[result.station].point))/data.meta.walkMetersPerMinute;
  for(let i=1;i<nodes.length;i++){
    const a=data.routeStates[nodes[i-1]],b=data.routeStates[nodes[i]];
    if(a.role==='arrival'&&b.role==='departure'&&a.stationIndex!==b.stationIndex)walking+=distance(data.stations[a.stationIndex].point,data.stations[b.stationIndex].point)/data.meta.walkMetersPerMinute;
  }
  return {minutes:result.minutes,legs,walking,waiting:Math.max(0,result.minutes-walking-legs.reduce((sum,l)=>sum+l.minutes,0))};
}
