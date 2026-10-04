#!/usr/bin/env python3
"""Contract degree-two chains without changing distances; publish compact IGN walking data.

Original vertices and segment lengths are retained for snapping arbitrary points.
Only junctions/dead ends participate in runtime shortest-path searches.
"""
import argparse, array, datetime, gzip, hashlib, json, math, struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def prepare(road):
    nodes=road['nodes']; adjacency=[[] for _ in nodes]
    for eid,(a,b,minutes) in enumerate(road['edges']):
        length=max(1,round(minutes*80*100))
        adjacency[a].append((b,length,eid)); adjacency[b].append((a,length,eid))
    anchors={i for i,a in enumerate(adjacency) if len(a)!=2}
    # Closed all-degree-two components need an anchor too.
    visited=set()
    for start in range(len(nodes)):
        if start in visited:continue
        stack=[start]; component=[]; has_anchor=False
        while stack:
            n=stack.pop()
            if n in visited:continue
            visited.add(n);component.append(n);has_anchor|=n in anchors
            stack.extend(a for a,_,_ in adjacency[n] if a not in visited)
        if not has_anchor: anchors.add(min(component))
    anchor_list=sorted(anchors); core={n:i for i,n in enumerate(anchor_list)}
    chains=[];used=set()
    for start in anchor_list:
        for nxt,length,eid in adjacency[start]:
            if eid in used:continue
            used.add(eid);points=[(start,0),(nxt,length)];previous=start;current=nxt;total=length
            while current not in anchors:
                dest,cost,edge=next(e for e in adjacency[current] if e[2] not in used)
                used.add(edge);total+=cost;points.append((dest,total));previous,current=current,dest
            chains.append((core[start],core[current],total,points))
    assert len(used)==len(road['edges'])
    origin=[math.floor(min(p[i] for p in nodes)) for i in (0,1)]
    coords=[];offsets=[0];ends=[];lengths=[];positions=[]
    for a,b,length,points in chains:
        ends.extend((a,b));lengths.append(length)
        for n,progress in points:
            coords.extend(round((nodes[n][i]-origin[i])*10) for i in (0,1));positions.append(progress)
        offsets.append(len(positions))
    adj=[[] for _ in core]
    for eid,(a,b,_,_) in enumerate(chains):adj[a].append(eid);adj[b].append(eid)
    csr=[0];edge_ids=[]
    for row in adj:edge_ids.extend(row);csr.append(len(edge_ids))
    # First geometry point comes from the junction. Subsequent deltas fit in
    # 16 bits because source segments are <=140 m. Distances remain in cm.
    core_coords=[round((nodes[n][i]-origin[i])*10) for n in anchor_list for i in (0,1)]
    deltas=[];increments=[]
    for edge in range(len(chains)):
        for point in range(offsets[edge]+1,offsets[edge+1]-1):
            deltas.extend(coords[point*2+i]-coords[(point-1)*2+i] for i in (0,1))
            increments.append(positions[point]-positions[point-1])
    assert max(map(abs,deltas),default=0)<32768 and max(increments,default=0)<65536
    if len(increments)%2:increments.append(0) # next uint32 block stays aligned
    header=struct.pack('<4I2i2I',0x32574B54,len(core),len(chains),len(positions),*origin,3,0)
    blocks=[('i',core_coords),('I',ends),('I',lengths),('I',offsets),('h',deltas),('H',increments),('I',csr),('I',edge_ids)]
    raw=header+b''.join(array.array(t,values).tobytes() for t,values in blocks)
    return raw,{'junctions':len(core),'chains':len(chains),'geometryPoints':len(positions),'rawBytes':len(raw)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--road',type=Path,required=True);args=parser.parse_args()
    road=json.loads(args.road.read_text());raw,stats=prepare(road)
    output=ROOT/'site/data/point_walking.bin.gz';output.write_bytes(gzip.compress(raw,compresslevel=9,mtime=0))
    stats['gzipBytes']=output.stat().st_size
    meta={'format':'TKW2','source':road['source'],'license':'Licence Ouverte Etalab 2.0','sourceSHA256':hashlib.sha256(args.road.read_bytes()).hexdigest(),'sourceArtifactRun':args.artifact_run,'preparedDate':datetime.date.today().isoformat(),'maxFreePointSnapMetres':75,'maxStopSnapMetres':150,'quantization':'coordinates 0.1 m, lengths 0.01 m','stats':stats}
    (ROOT/'site/data/point_walking.meta.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(stats))
if __name__=='__main__':main()
