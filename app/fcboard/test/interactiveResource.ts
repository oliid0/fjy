export const interactiveResource = {
  id: "generated:force",
  title: "Force and acceleration",
  html: `<!doctype html><html><head><title>Force and acceleration</title></head><body>
<h1>Force and acceleration</h1><p>Explore Newton's second law with mass fixed at 2 kg.</p>
<label>Force (N)<input id="force" type="range" min="0" max="20" value="4"></label>
<svg viewBox="0 0 400 100"><rect id="block" x="0" y="20" width="40" height="40" fill="#245bd6"/></svg>
<output id="acceleration"></output><button id="reset">Reset</button>
<script>
const force=document.getElementById('force');
function update(){const a=Number(force.value)/2;document.getElementById('acceleration').textContent=a+' m/s²';document.getElementById('block').setAttribute('x',String(a*30));}
force.addEventListener('input',update);document.getElementById('reset').addEventListener('click',()=>{force.value='4';update();});update();
</script></body></html>`,
};

/** Model/provider fixture for the requested zero-net-force coasting demonstration. */
export const inertiaResource = {
  id: "generated:inertia",
  title: "牛顿第一定律：小车惯性",
  html: `<!doctype html><html><head><title>牛顿第一定律：小车惯性</title></head><body>
<h1>牛顿第一定律</h1><p>无摩擦水平面上的2 kg小车，初速度1 m/s。撤去推力后保持匀速运动。</p>
<label>合力 (N)<input id="force" type="range" min="0" max="20" value="4"></label>
<svg viewBox="0 0 400 100"><g id="cart" style="transition:transform .3s linear"><rect x="0" y="20" width="40" height="30" fill="#245bd6"/><circle cx="10" cy="55" r="5"/><circle cx="30" cy="55" r="5"/></g><path d="M0 61H400" stroke="black"/></svg>
<output id="net-force"></output><output id="speed"></output><output id="position"></output><button id="advance">推进1秒</button>
<script>
const force=document.getElementById('force');let velocity=1;let position=0;
function update(){document.getElementById('net-force').textContent='合力：'+force.value+' N';document.getElementById('speed').textContent='速度：'+velocity+' m/s';document.getElementById('position').textContent='位置：'+position+' m';document.getElementById('cart').style.transform='translateX('+position*40+'px)';}
force.addEventListener('input',update);document.getElementById('advance').addEventListener('click',()=>{const acceleration=Number(force.value)/2;position+=velocity+acceleration/2;velocity+=acceleration;update();});update();
</script></body></html>`,
};
