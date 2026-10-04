"""Independent checks of degree-two contraction, including closed loops."""
import heapq,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts.prepare_point_walking import prepare

def shortest(adj,start):
    best={start:0};q=[(0,start)]
    while q:
        cost,node=heapq.heappop(q)
        if cost!=best[node]:continue
        for other,length in adj[node]:
            candidate=cost+length
            if candidate<best.get(other,float('inf')):best[other]=candidate;heapq.heappush(q,(candidate,other))
    return best

for edges in [
    [(0,1,40),(1,2,70),(2,3,30),(2,4,90)],
    [(0,1,40),(1,2,70),(2,0,60)],
    [(0,1,40),(2,3,70)],
]:
    count=max(max(a,b) for a,b,_ in edges)+1
    nodes=[[i*20,0] for i in range(count)]
    road={'nodes':nodes,'edges':[[a,b,m/80] for a,b,m in edges]}
    raw,stats=prepare(road);h=struct.unpack_from('<4I2i2I',raw)
    n,e=h[1:3];offset=32+n*8
    ends=struct.unpack_from('<'+str(e*2)+'I',raw,offset);offset+=e*8
    lengths=struct.unpack_from('<'+str(e)+'I',raw,offset)
    core=[[] for _ in range(n)]
    for i in range(e):a,b=ends[i*2:i*2+2];core[a].append((b,lengths[i]/100));core[b].append((a,lengths[i]/100))
    full=[[] for _ in nodes]
    for a,b,m in edges:full[a].append((b,m));full[b].append((a,m))
    anchors=[i for i,row in enumerate(full) if len(row)!=2]
    if not anchors:anchors=[0]
    assert len(anchors)==n
    for i,a in enumerate(anchors):
        expected=shortest(full,a);observed=shortest(core,i)
        for j,b in enumerate(anchors):assert expected.get(b,float('inf'))==observed.get(j,float('inf'))
print('point walking contraction tests: ok')
