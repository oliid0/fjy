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
