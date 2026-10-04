// Contracted IGN graph. Coordinates describe geometry, never create junctions.
class Heap {
  constructor() { this.n=0;this.ids=new Uint32Array(4096);this.costs=new Float64Array(4096); }
  push(id,cost) {
    if(this.n===this.ids.length){const a=new Uint32Array(this.n*2),b=new Float64Array(this.n*2);a.set(this.ids);b.set(this.costs);this.ids=a;this.costs=b;}
    let i=this.n++;while(i){const p=(i-1)>>1;if(this.costs[p]<=cost)break;this.ids[i]=this.ids[p];this.costs[i]=this.costs[p];i=p;}this.ids[i]=id;this.costs[i]=cost;
  }
  pop() {const id=this.ids[0],cost=this.costs[0],last=--this.n,x=this.ids[last],v=this.costs[last];let i=0;
    while(i*2+1<last){let c=i*2+1;if(c+1<last&&this.costs[c+1]<this.costs[c])c++;if(this.costs[c]>=v)break;this.ids[i]=this.ids[c];this.costs[i]=this.costs[c];i=c;}this.ids[i]=x;this.costs[i]=v;return [id,cost];}
}
export class WalkingNetwork {
  constructor(buffer,coverage=()=>true) {
    const h=new Uint32Array(buffer,0,8);if(h[0]!==0x32574B54)throw Error('Unsupported walking graph');
    this.count=h[1];this.chainCount=h[2];this.pointCount=h[3];this.origin=[h[4]|0,h[5]|0];this.coverageCache=new Map();this.coverage=(point)=>{
      const key=point.join(',');if(this.coverageCache.has(key))return this.coverageCache.get(key);
      const covered=coverage(point);if(this.coverageCache.size>60000)this.coverageCache.clear();this.coverageCache.set(key,covered);return covered;
    };
    let offset=32;const take=(Type,n)=>{const a=new Type(buffer,offset,n);offset+=n*Type.BYTES_PER_ELEMENT;return a;};
    const coreCoords=h[6]>=2?take(Int32Array,this.count*2):null;
    this.ends=take(Uint32Array,this.chainCount*2);this.lengths=take(Uint32Array,this.chainCount);this.shapes=take(Uint32Array,this.chainCount+1);
    if(coreCoords){
      const interiors=h[6]===3?this.pointCount-this.chainCount*2:this.pointCount;
      const delta=take(Int16Array,interiors*2),steps=take(Uint16Array,interiors+(interiors%2));
      this.coords=new Int32Array(this.pointCount*2);this.along=new Uint32Array(this.pointCount);let cursor=0;
      for(let e=0;e<this.chainCount;e++){
        const start=this.shapes[e],end=this.shapes[e+1]-1,node=this.ends[e*2];this.coords[start*2]=coreCoords[node*2];this.coords[start*2+1]=coreCoords[node*2+1];
        for(let p=start+1;p<=end;p++){
          if(h[6]===3&&p===end){const last=this.ends[e*2+1];this.coords[p*2]=coreCoords[last*2];this.coords[p*2+1]=coreCoords[last*2+1];this.along[p]=this.lengths[e];}
          else {const i=h[6]===3?cursor++:p;this.coords[p*2]=this.coords[p*2-2]+delta[i*2];this.coords[p*2+1]=this.coords[p*2-1]+delta[i*2+1];this.along[p]=this.along[p-1]+steps[i];}
        }
      }
    }else{this.coords=take(Int32Array,this.pointCount*2);this.along=take(Int32Array,this.pointCount);
      if(h[6]===1){for(let i=2;i<this.coords.length;i++)this.coords[i]+=this.coords[i-2];for(let i=1;i<this.along.length;i++)this.along[i]+=this.along[i-1];}}
    this.offsets=take(Uint32Array,this.count+1);this.edges=take(Uint32Array,this.chainCount*2);
    if(offset!==buffer.byteLength)throw Error('Truncated walking graph');
    this.pointChain=new Uint32Array(this.pointCount);let maxX=0,maxY=0;
    for(let p=0;p<this.pointCount;p++){maxX=Math.max(maxX,this.coords[p*2]);maxY=Math.max(maxY,this.coords[p*2+1]);}
    this.width=Math.ceil(maxX/2000)+2;this.height=Math.ceil(maxY/2000)+2;
    const counts=new Uint32Array(this.width*this.height);
    const buckets=(p,fn)=>{const x=this.coords[p*2],y=this.coords[p*2+1],xx=this.coords[p*2+2],yy=this.coords[p*2+3];
      for(let by=Math.floor(Math.min(y,yy)/2000);by<=Math.floor(Math.max(y,yy)/2000);by++)for(let bx=Math.floor(Math.min(x,xx)/2000);bx<=Math.floor(Math.max(x,xx)/2000);bx++)fn(by*this.width+bx);};
    for(let e=0;e<this.chainCount;e++)for(let p=this.shapes[e];p<this.shapes[e+1];p++){this.pointChain[p]=e;if(p+1<this.shapes[e+1])buckets(p,b=>counts[b]++);}
    this.bucketOffsets=new Uint32Array(counts.length+1);for(let i=0;i<counts.length;i++)this.bucketOffsets[i+1]=this.bucketOffsets[i]+counts[i];
    this.bucketSegments=new Uint32Array(this.bucketOffsets.at(-1));counts.fill(0);
    for(let e=0;e<this.chainCount;e++)for(let p=this.shapes[e];p+1<this.shapes[e+1];p++)buckets(p,b=>{this.bucketSegments[this.bucketOffsets[b]+counts[b]++]=p;});
    this.snapCache=new Map();
  }
  snap(point,maxGap=75,vertexOnly=false) {
    const x=(point[0]-this.origin[0])*10,y=(point[1]-this.origin[1])*10,bx=Math.floor(x/2000),by=Math.floor(y/2000),r=Math.ceil(maxGap/200)+1;
    let best=maxGap*10,bestSnap=null;
    for(let yy=Math.max(0,by-r);yy<=Math.min(this.height-1,by+r);yy++)for(let xx=Math.max(0,bx-r);xx<=Math.min(this.width-1,bx+r);xx++){
      const bucket=yy*this.width+xx;
      for(let k=this.bucketOffsets[bucket];k<this.bucketOffsets[bucket+1];k++){
        const p=this.bucketSegments[k],a=p*2,dx=this.coords[a+2]-this.coords[a],dy=this.coords[a+3]-this.coords[a+1],den=dx*dx+dy*dy;
        let t=den?Math.max(0,Math.min(1,((x-this.coords[a])*dx+(y-this.coords[a+1])*dy)/den)):0;
        if(vertexOnly)t=t<0.5?0:1;
        const gap=Math.hypot(x-this.coords[a]-t*dx,y-this.coords[a+1]-t*dy);
        if(gap<best){best=gap;bestSnap={chain:this.pointChain[p],along:this.along[p]+t*(this.along[p+1]-this.along[p]),gap:gap/10};}
      }
    }
    return bestSnap;
  }
  freeSnap(point) {
    if(!this.coverage(point))return undefined; // explicit geometric fallback outside coverage
    const key=point.join(',');if(this.snapCache.has(key))return this.snapCache.get(key);
    const snap=this.snap(point);if(this.snapCache.size>60000)this.snapCache.clear();this.snapCache.set(key,snap);return snap;
  }
  stationSnaps(stations) {
    const snaps=stations.map(s=>s.inSerm?this.snap(s.point,150,true):undefined);
    const names=new Map();
    stations.forEach((s,i)=>{if(!s.inSerm)return;const name=s.name.trim().toLocaleLowerCase('fr');const peers=names.get(name)||[];const peer=peers.find(j=>Math.hypot(s.point[0]-stations[j].point[0],s.point[1]-stations[j].point[1])<=5);if(peer!==undefined&&snaps[peer]){
      const old=snaps[peer],point=this.snapPoint(old);snaps[i]={...old,gap:Math.hypot(s.point[0]-point[0],s.point[1]-point[1])};
    }peers.push(i);names.set(name,peers);});
    const station=stations.findIndex(s=>s.id==='SNCF:87571240'),portal=stations.findIndex(s=>s.id==='FILBLEU:TTR:SPGAB-1A');
    if(station>=0&&portal>=0&&snaps[portal])snaps[station]={...snaps[portal],gap:snaps[portal].gap+Math.hypot(stations[station].point[0]-stations[portal].point[0],stations[station].point[1]-stations[portal].point[1])};
    this.stations=stations;this.stops=snaps;this.stationLookup=new Map();this.stationBuckets=new Map();
    stations.forEach((s,i)=>{const bucket=`${Math.floor(s.point[0]/4)},${Math.floor(s.point[1]/4)}`;const entries=this.stationBuckets.get(bucket)||[];entries.push(i);this.stationBuckets.set(bucket,entries);const key=s.point.join(',');const list=this.stationLookup.get(key)||[];list.push(i);this.stationLookup.set(key,list);});
    return snaps;
  }
  stationsAt(point) {
    const exact=this.stationLookup.get(point.join(','));if(exact)return exact;
    const x=Math.floor(point[0]/4),y=Math.floor(point[1]/4),matches=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const i of this.stationBuckets.get(`${x+dx},${y+dy}`)||[]){const s=this.stations[i];if(Math.hypot(point[0]-s.point[0],point[1]-s.point[1])<=2)matches.push(i);}
    return matches;
  }
  snapPoint(snap) {let p=this.shapes[snap.chain];while(p+1<this.shapes[snap.chain+1]&&this.along[p+1]<snap.along)p++;const d=this.along[p+1]-this.along[p],t=d?(snap.along-this.along[p])/d:0;return [this.origin[0]+(this.coords[p*2]+t*(this.coords[p*2+2]-this.coords[p*2]))/10,this.origin[1]+(this.coords[p*2+1]+t*(this.coords[p*2+3]-this.coords[p*2+1]))/10];}
  search(seeds,labels=false,limit=Infinity) {
    const values=new Float64Array(this.count).fill(Infinity),owners=labels?new Int32Array(this.count).fill(-1):null,queue=new Heap();
    const relax=(node,value,owner)=>{if(value<=limit && value<values[node]){values[node]=value;if(owners)owners[node]=owner;queue.push(node,value);}};
    for(const [snap,cost,owner] of seeds){if(!snap||!Number.isFinite(cost))continue;const e=snap.chain,base=cost+snap.gap*100;relax(this.ends[e*2],base+snap.along,owner);relax(this.ends[e*2+1],base+this.lengths[e]-snap.along,owner);}
    while(queue.n){const [n,cost]=queue.pop();if(cost!==values[n])continue;for(let k=this.offsets[n];k<this.offsets[n+1];k++){const e=this.edges[k],next=this.ends[e*2]===n?this.ends[e*2+1]:this.ends[e*2];relax(next,cost+this.lengths[e],owners?.[n]??-1);}}
    const seedChains=new Map();
    for(const seed of seeds)if(seed[0]){const chain=seed[0].chain;const list=seedChains.get(chain)||[];list.push(seed);seedChains.set(chain,list);}
    return {values,owners,seeds,seedChains,limit};
  }
  at(field,snap) {
    if(!snap)return {cost:Infinity,owner:-1};const e=snap.chain,a=this.ends[e*2],b=this.ends[e*2+1];let cost=field.values[a]+snap.along,owner=field.owners?.[a]??-1;
    const other=field.values[b]+this.lengths[e]-snap.along;if(other<cost){cost=other;owner=field.owners?.[b]??-1;}
    // Direct route within one contracted chain, without going via its endpoints.
    for(const [source,base,id] of field.seedChains.get(e)||[]){const direct=base+source.gap*100+Math.abs(source.along-snap.along);if(direct<cost){cost=direct;owner=id;}}
    cost+=snap.gap*100;return {cost:cost<=field.limit?cost:Infinity,owner};
  }
}
