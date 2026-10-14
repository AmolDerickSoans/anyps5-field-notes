'use strict';
let essayData, anatomyController, progressData, activeView = 'recent';
let toastTimer;
const fmt = new Intl.NumberFormat('en-US');
const $ = id => document.getElementById(id);
function notice(message){ $('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},4000); }
async function share(){ const url=document.querySelector('link[rel=canonical]').href;try{if(navigator.share){await navigator.share({title:'All software is open source.',text:'A PS5 executable, a missing function, and four billion checks. Inside AnyPS5’s public engineering workshop.',url});return;}await navigator.clipboard.writeText(url);notice('Link copied.');}catch(e){if(e.name!=='AbortError')notice('Copy the page URL to share this field study.');} }
$('share').addEventListener('click',share);
function drawCharts(){ if(!essayData)return; window.renderCharts({...essayData,activity:activeView==='recent'?essayData.activity.slice(-14):essayData.activity});$('participation-readout').textContent='315 merged-PR authors. Inspect a dot to see their work.'; }
fetch('./data.json').then(r=>{if(!r.ok)throw Error('Snapshot unavailable');return r.json();}).then(data=>{essayData=data;document.querySelectorAll('[data-value]').forEach(el=>el.textContent=fmt.format(data.counts[el.dataset.value]));drawCharts();}).catch(()=>{document.querySelectorAll('.chart-readout').forEach(el=>el.textContent='Reload to inspect the saved data, or download it under Sources.');});
document.querySelectorAll('[data-activity-view]').forEach(button=>button.addEventListener('click',()=>{activeView=button.dataset.activityView;document.querySelectorAll('[data-activity-view]').forEach(b=>{const selected=b===button;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected);});drawCharts();}));
const sequences={amd:['66','0F','78','C3','00','00'],intel:['F3','0F','7E','DB','66','90']};
let binaryState='amd';
function inspectByte(index,hex,bits){$('machine-caption').textContent=`Byte ${index+1}: 0x${hex} = ${bits}. Eight lamps, eight bits.`;}
function setBinaryState(state){binaryState=state;document.querySelectorAll('[data-binary-state]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.binaryState===state));$('byte-strip').querySelectorAll('span').forEach((span,i)=>{span.textContent=sequences[state][i];span.classList.toggle('changed',state==='intel'&&sequences.amd[i]!==sequences.intel[i]);});if(anatomyController)anatomyController.setState(state);$('machine-caption').textContent=state==='amd'?'EXTRQ · a six-byte AMD instruction from the repository’s test.':'MOVQ + NOP padding · exact replacement verified by the regression test.';}
document.querySelectorAll('[data-binary-state]').forEach(button=>button.addEventListener('click',()=>setBinaryState(button.dataset.binaryState)));
async function loadAnatomy(){try{const response=await fetch('./assets/anatomy/binary.svg');if(!response.ok)throw Error('Artwork unavailable');const source=await response.text();const doc=new DOMParser().parseFromString(source,'image/svg+xml');const svg=doc.documentElement;svg.setAttribute('role','group');svg.querySelectorAll('script').forEach(n=>n.remove());$('anatomy-mount').replaceChildren(document.importNode(svg,true));$('anatomy-mount').classList.add('iso');const script=document.createElement('script');script.src='./assets/anatomy/binary-runtime.js';script.onload=()=>{if(window.mountBinary){anatomyController=window.mountBinary($('anatomy-mount'),inspectByte);anatomyController.setState(binaryState);}};document.head.appendChild(script);}catch(e){$('anatomy-mount').textContent='The instruction study is loading. Reload to inspect it.';console.error(e);}}
loadAnatomy();
const steps={binary:'Same CPU vocabulary. Different executable format, libraries, and operating-system expectations.',relink:'The relinker converts the console executable into PE for Windows or ELF for Linux, with imports pointing to the replacement libraries.',libraries:'The game still makes its calls. AnyPS5 supplies PRX implementations to answer them on the host.',host:'The result is designed to run as a native host program. Graphics work also needs shader recompilation to SPIR-V.'};
document.querySelectorAll('[data-step]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-step]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',b===button);});$('step-readout').textContent=steps[button.dataset.step];}));
function moduleSource(name){return 'https://github.com/boykopovar/AnyPS5/tree/main/core/libs/prx/'+encodeURIComponent(name);}
function showModule(name){
 const root=$('progress-map');root.dataset.selected=name;
 root.querySelectorAll('[data-map-module]').forEach(n=>n.classList.toggle('chosen',n.dataset.mapModule===name));
 document.querySelectorAll('[data-module]').forEach(b=>{const active=b.dataset.module===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});
 const readout=$('map-readout');
 if(name==='all'){readout.replaceChildren();const strong=document.createElement('strong');strong.textContent='A map of declared functions.';const span=document.createElement('span');span.textContent='Pick a library, or inspect a tile.';readout.append(strong,span);return;}
 const group=progressData?.libraries?.groups?.find(g=>g.name===name)||progressData?.shaders?.groups?.find(g=>g.name===name);
 if(!group)return;
 const strong=document.createElement('strong');strong.textContent=name;
 const span=document.createElement('span');const total=group.done+group.todo;span.textContent=`${group.done} / ${total} tracked ${name.startsWith('lib')?'functions':'encodings'} implemented`;
 const detail=document.createElement('span');const todo=group.todo_names||[];detail.textContent=todo.length?`Still open: ${todo.slice(0,2).join(' · ')}${todo.length>2?` (+${todo.length-2} more)`:''}`:'All tracked entries marked implemented.';
 const link=document.createElement('a');link.href=name.startsWith('lib')?moduleSource(group.shared_sources?.[0]||name):'https://github.com/boykopovar/AnyPS5/tree/main/core/shader';link.target='_blank';link.rel='noopener';link.textContent='Inspect the source ↗';readout.replaceChildren(strong,span,detail,link);
}
document.querySelectorAll('[data-module]').forEach(button=>button.addEventListener('click',()=>showModule(button.dataset.module)));
async function loadMap(){try{
 const [svgResponse,dataResponse]=await Promise.all([fetch('./assets/repo/progress.svg'),fetch('./assets/repo/progress.json')]);if(!svgResponse.ok||!dataResponse.ok)throw Error('Progress map unavailable');
 progressData=await dataResponse.json();const svgDoc=new DOMParser().parseFromString(await svgResponse.text(),'image/svg+xml');const svg=svgDoc.documentElement;svg.querySelectorAll('script').forEach(n=>n.remove());const names=new Set([...progressData.libraries.groups,...progressData.shaders.groups].map(g=>g.name));
 svg.querySelectorAll('g').forEach(g=>{const title=g.querySelector(':scope > title');if(!title)return;const name=title.textContent.split(':')[0];if(!names.has(name))return;g.dataset.mapModule=name;g.setAttribute('tabindex','0');g.setAttribute('role','button');g.setAttribute('aria-label',title.textContent);g.addEventListener('click',()=>showModule(name));g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showModule(name);}});});
 $('progress-map').replaceChildren(document.importNode(svg,true));
 // importNode copies geometry, not JavaScript listeners.
 $('progress-map').querySelectorAll('[data-map-module]').forEach(g=>{const select=()=>showModule(g.dataset.mapModule);g.addEventListener('click',select);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});});
 showModule('all');
 }catch(e){$('progress-map').textContent='The map could not load. The original is linked below.';console.error(e);}}
loadMap();
