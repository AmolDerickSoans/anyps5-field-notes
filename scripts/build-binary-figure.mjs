// Anatomy Figure: a six-byte instruction on an inspection fixture.
// The physical fixture is conceptual. Its 48 lamps encode the exact golden-test bytes.
import {writeFileSync,mkdirSync} from 'node:fs';
import * as k from '../vendor/anatomy/kit/iso-kit.mjs';
import * as A from '../vendor/anatomy/kit/audit.mjs';
const OUT=new URL('../dist/assets/anatomy/',import.meta.url);mkdirSync(OUT,{recursive:true});
const WIDTH=760,HEIGHT=430;
const base={x:-184,y:-66,w:368,d:132,r:12};
const P=k.fitProjection([...k.boxCorners(base,-17,61)],WIDTH,HEIGHT,{pad:30,azimuth:58,elevation:34});
const at=p=>k.iso(p,P),parts=[];
const R=A.recorder(P),shapes=[];let owner='fixture';
function record(shape,svg){const name=R.nameFor(owner);shape.name=name;shapes.push(shape);R.put({name,svg,piece:owner,move:owner==='carriage'?[290.5,0,0]:[0,0,0],shapes:[R.solid(shape)]});return svg;}
const S=(plan,z,h,tone='mid',extra='')=>record(A.slab(plan,z,h),k.solidSvg(k.slabOf(plan,z,h,P,8,Math.min(h/5,1.2)),{tone,inner:extra}));
const C=(x,y,r,z,h,tone='mid')=>record(A.cylinder(x,y,r,z,h,{ground:z===-17}),k.solidSvg(k.cylinder(x,y,r,z,h,P,64,.25),{tone}));
const L=(d,tone='lo')=>k.lineSvg(d,{tone});
parts.push(`<path class="iso-halo" d="${k.haloOf(base,-17,14,P)}"/>`);
for(const [x,y] of k.corners(base,24).sort((a,b)=>k.depthOf([...a,0],P)-k.depthOf([...b,0],P))){parts.push(C(x,y,8,-17,2,'lo'),C(x,y,6,-15,7,'mid'));}
parts.push(S(base,-8,8,'mid'));
parts.push(L(k.planOutline(k.insetPlan(base,6),0,P),'faint'));
const board={x:-166,y:-47,w:332,d:94,r:7};parts.push(S(board,0,4,'lo'));
for(const [x,y] of k.corners(base,12)){parts.push(C(x,y,3.6,0,1.5,'hi'),L(k.ring(x,y,1.8,1.5,P)),k.dotsSvg([at([x,y,1.5])],{size:.6,tone:'lo'}));}
for(const y of [-55,49]){
 parts.push(S({x:-173,y,w:346,d:7,r:2},1,5,'mid'));
 for(const x of [-166,166]){parts.push(S({x:x-5,y:y-2,w:10,d:11,r:2},6,4,'hi'),L(k.ring(x,y+3.5,1.6,10,P)));}
}
// The carriage is a physical inspection head riding the two edge rails.
// Back shoe/post belongs behind the subjects; beam/head/front shoe belong in front.
const carriageX=-151;
const shoe=(y)=>S({x:carriageX-7,y:y-2,w:14,d:11,r:2},6,5,'hi')+S({x:carriageX-4,y:y+1,w:8,d:5,r:1},11,35,'mid');
owner='carriage';
parts.push(`<g data-carriage="back">${shoe(-55)}</g>`);
owner='fixture';
// Modules and contacts are ordered along the camera's true depth.
const cells=Array.from({length:6},(_,i)=>({i,x:-157+i*55})).sort((a,b)=>k.depthOf([a.x,0,0],P)-k.depthOf([b.x,0,0],P));
for(const {i,x} of cells){
 let s='';const socket={x:x-2,y:-35,w:47,d:70,r:5};
 s+=S(socket,4,4,'mid');
 for(const y of [-40,35])for(let pin=0;pin<4;pin++){const px=x+5+pin*9;s+=S({x:px,y:y,w:3.3,d:y<0?5:8,r:.7},4,2,'hi');s+=L(k.planOutline({x:px+.5,y:y+.8,w:2.3,d:y<0?3.4:6.4,r:.3},6,P),'faint');}
 const cap={x,y:-28,w:43,d:56,r:4};s+=S(cap,8,9,'hi');s+=L(k.planOutline(k.insetPlan(cap,3),17,P),'faint');
 for(const [sx,sy]of k.corners(cap,5)){s+=k.dotsSvg([at([sx,sy,17])],{size:.65,tone:'lo'});}
 for(let bit=0;bit<8;bit++){const px=x+12+(bit%2)*19,py=-16+Math.floor(bit/2)*10;const [cx,cy]=at([px,py,18.5]);s+=C(px,py,3.6,17,1.5,'lo');s+=`<path data-bit="${bit}" d="${k.ring(px,py,2.7,18.6,P)}Z" class="binary-lamp ${Boolean(parseInt(['66','0F','78','C3','00','00'][i],16)&(1<<(7-bit)))?'on':''}"/>`;}
 parts.push(`<g class="binary-cell" data-byte="${i}" tabindex="${i===0?'0':'-1'}" role="button" aria-label="Byte ${i+1}">${s}</g>`);
}
owner='carriage';let head=shoe(49);
head+=S({x:carriageX-5,y:-54,w:10,d:112,r:2},46,6,'hi');
// Bolted central optical housing; its recessed nose faces the bits, 12 units clear.
head+=S({x:carriageX-12,y:-16,w:24,d:32,r:4},34,12,'mid');
head+=S({x:carriageX-9,y:-13,w:18,d:26,r:3},52,8,'hi');
head+=S({x:carriageX-7,y:-11,w:14,d:22,r:2},31,3,'lo');
for(const y of [-8,-3,2,7])head+=S({x:carriageX-6,y,w:12,d:1.3,r:.4},60,.6,'mid');
for(const y of[-49,48])head+=C(carriageX,y,1.8,52,1,'lo');
for(const y of[-12,12])for(const x of[carriageX-8,carriageX+8])head+=k.dotsSvg([at([x,y,60])],{size:.7,tone:'lo'});
parts.push(`<g data-carriage="front">${head}</g>`);
owner='fixture';
// A grounded front label plate, two inspection grips and their mounting bolts.
parts.push(S({x:-84,y:57,w:168,d:7,r:2},0,1,'hi'));
parts.push(k.faceTextSvg(k.topMatrix([0,60],1.2,P),'ANYPS5',{size:4.8,tone:'lo',anchor:'middle'}));
for(const x of[-172,172]){parts.push(C(x,0,8,4,8,'lo'),C(x,0,7,12,3,'mid'),L(k.knurl(x,0,7,12,15,24,P),'lo'));}
const svg=k.figureSvg({width:WIDTH,height:HEIGHT,standalone:'light',className:'binary-fixture',label:'A six-byte machine instruction on a conceptual Anatomy inspection fixture. Each of its six modules has eight lamps: one lamp per bit. The values come from the AnyPS5 regression test.',body:parts.join('')});
const travel=k.axisVector(P,[1,0,0]);
const css=`.binary-fixture{background:transparent}.binary-lamp{fill:#bbc1cb;stroke:#667084;stroke-width:.45;transition:fill .45s cubic-bezier(.2,.7,.3,1)}.binary-lamp.on{fill:#3345ee;stroke:#263bd5}.binary-cell{cursor:pointer}.binary-cell:hover .iso-line,.binary-cell:focus .iso-line{stroke:#3345ee}.binary-cell:focus{outline:none}.iso[data-theme=light]{--anatomy-page:transparent;--anatomy-card:transparent;--anatomy-hi:#27314b;--anatomy-mid:#8d95a9;--anatomy-lo:#7d8597;--anatomy-faint:#bbc1ce;--anatomy-shade-0:#737e97;--anatomy-shade-1:#9da8ba;--anatomy-shade-2:#c3ccda;--anatomy-shade-3:#e0e6ef;--anatomy-paper:#f3f4f7;--anatomy-top:#fff;--anatomy-halo-opacity:.12}@media(prefers-reduced-motion:reduce){.binary-lamp{transition:none}}`;
writeFileSync(new URL('binary.svg',OUT),svg.replace('role="img"','role="group"').replace('</style>',css+'</style>'));
writeFileSync(new URL('binary-runtime.js',OUT),`(function(){
const sequences={amd:['66','0F','78','C3','00','00'],intel:['F3','0F','7E','DB','66','90']};
window.mountBinary=function(container,onInspect){
let state='amd',at=0,target=0,last=0,raf=0,visible=true,scanStart=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const cells=[...container.querySelectorAll('[data-byte]')],carriages=[...container.querySelectorAll('[data-carriage]')];
const centers=[15.5,70.5,125.5,180.5,235.5,290.5];
function draw(){carriages.forEach(el=>el.setAttribute('transform','translate('+(at*${travel[0]})+' '+(at*${travel[1]})+')'));}
function frame(t){raf=0;if(!visible)return;const dt=Math.min((t-(last||t))/1000,.05);last=t;
if(scanStart){const phase=Math.min((t-scanStart)/1300,1);target=centers[0]+(centers[5]-centers[0])*phase;if(phase===1)scanStart=0;}
at+= (target-at)*(1-Math.exp(-10*dt));if(Math.abs(target-at)<.04)at=target;draw();if(scanStart||Math.abs(target-at)>.04)raf=requestAnimationFrame(frame);}
function move(value){target=value;if(reduced.matches){scanStart=0;at=target;draw();return;}if(!raf){last=0;raf=requestAnimationFrame(frame);}}
function inspect(i){scanStart=0;move(centers[i]);const code=sequences[state][i];if(onInspect)onInspect(i,code,parseInt(code,16).toString(2).padStart(8,'0'));}
function setState(next){const changed=state!==next;state=next==='intel'?'intel':'amd';cells.forEach(cell=>{const i=Number(cell.dataset.byte),value=parseInt(sequences[state][i],16);cell.setAttribute('aria-label','Byte '+(i+1)+': '+sequences[state][i]+', binary '+value.toString(2).padStart(8,'0'));cell.querySelectorAll('[data-bit]').forEach(lamp=>lamp.classList.toggle('on',Boolean(value&(1<<(7-Number(lamp.dataset.bit))))));});if(changed){if(reduced.matches){move(centers[5]);}else{scanStart=performance.now();move(centers[0]);}}}
cells.forEach(cell=>{const i=Number(cell.dataset.byte);cell.addEventListener('pointerenter',()=>inspect(i));cell.addEventListener('focus',()=>inspect(i));cell.addEventListener('click',()=>inspect(i));cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(i);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:-1)+6)%6;cells.forEach(c=>c.tabIndex=-1);const el=cells.find(c=>Number(c.dataset.byte)===next);el.tabIndex=0;el.focus();}});});
const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)move(target);else if(raf){cancelAnimationFrame(raf);raf=0;}});observer.observe(container);
reduced.addEventListener('change',()=>{if(reduced.matches){scanStart=0;at=target;draw();}});setState('amd');return {setState};};})();`);
if(process.argv.includes('--audit')){const states=[0,1].map(n=>({label:'carriage '+n,shares:{carriage:n}}));const frames=Array.from({length:13},(_,i)=>({label:'scan '+i,shares:{carriage:i/12}}));A.settle(R,P,{states});A.auditOrExit(R,P,{frames,apart:true});}
console.log('Anatomy binary fixture built: 6 bytes, 48 exact bit lamps, grounded inspection carriage.');
