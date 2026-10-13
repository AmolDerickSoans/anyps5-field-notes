(function(){
const sequences={amd:['66','0F','78','C3','00','00'],intel:['F3','0F','7E','DB','66','90']};
window.mountBinary=function(container,onInspect){
let state='amd',at=0,target=0,last=0,raf=0,visible=true,scanStart=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const cells=[...container.querySelectorAll('[data-byte]')],carriages=[...container.querySelectorAll('[data-carriage]')];
const centers=[15.5,70.5,125.5,180.5,235.5,290.5];
function draw(){carriages.forEach(el=>el.setAttribute('transform','translate('+(at*1.3278190058389328)+' '+(at*0.46396984610689174)+')'));}
function frame(t){raf=0;if(!visible)return;const dt=Math.min((t-(last||t))/1000,.05);last=t;
if(scanStart){const phase=Math.min((t-scanStart)/1300,1);target=centers[0]+(centers[5]-centers[0])*phase;if(phase===1)scanStart=0;}
at+= (target-at)*(1-Math.exp(-10*dt));if(Math.abs(target-at)<.04)at=target;draw();if(scanStart||Math.abs(target-at)>.04)raf=requestAnimationFrame(frame);}
function move(value){target=value;if(reduced.matches){scanStart=0;at=target;draw();return;}if(!raf){last=0;raf=requestAnimationFrame(frame);}}
function inspect(i){scanStart=0;move(centers[i]);const code=sequences[state][i];if(onInspect)onInspect(i,code,parseInt(code,16).toString(2).padStart(8,'0'));}
function setState(next){const changed=state!==next;state=next==='intel'?'intel':'amd';cells.forEach(cell=>{const i=Number(cell.dataset.byte),value=parseInt(sequences[state][i],16);cell.setAttribute('aria-label','Byte '+(i+1)+': '+sequences[state][i]+', binary '+value.toString(2).padStart(8,'0'));cell.querySelectorAll('[data-bit]').forEach(lamp=>lamp.classList.toggle('on',Boolean(value&(1<<(7-Number(lamp.dataset.bit))))));});if(changed){if(reduced.matches){move(centers[5]);}else{scanStart=performance.now();move(centers[0]);}}}
cells.forEach(cell=>{const i=Number(cell.dataset.byte);cell.addEventListener('pointerenter',()=>inspect(i));cell.addEventListener('focus',()=>inspect(i));cell.addEventListener('click',()=>inspect(i));cell.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect(i);}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:-1)+6)%6;cells.forEach(c=>c.tabIndex=-1);const el=cells.find(c=>Number(c.dataset.byte)===next);el.tabIndex=0;el.focus();}});});
const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)move(target);else if(raf){cancelAnimationFrame(raf);raf=0;}});observer.observe(container);
reduced.addEventListener('change',()=>{if(reduced.matches){scanStart=0;at=target;draw();}});setState('amd');return {setState};};})();