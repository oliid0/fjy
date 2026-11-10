import { interactiveHtml } from "./interactiveHtml";
import { validateVisualization } from "./visualizationRuntime";

import type { InteractiveResource } from "./interactiveHtml";

/** Assemble trusted local runtimes after the ordinary lesson sanitizer. The
 * AI supplies JSON only. AST interpretation keeps the iframe's no-eval CSP. */
export const visualizationHtml = async (resource: InteractiveResource) => {
  const visualization = validateVisualization(resource.visualization);
  const [compatibility, core, lite, embed] = await Promise.all([
    import("./vendor/vega/compatibility.js?raw"),
    import("vega-offline-core?raw"),
    import("vega-offline-lite?raw"),
    import("vega-offline-embed?raw"),
  ]);
  const document = new DOMParser().parseFromString(
    interactiveHtml(resource.html),
    "text/html",
  );
  for (const module of [compatibility, core, lite, embed]) {
    const script = document.createElement("script");
    script.textContent = module.default.replace(/<\/script/gi, "<\\/script");
    document.body.append(script);
  }
  const script = document.createElement("script");
  const payload = JSON.stringify(visualization).replace(/</g, "\\u003c");
  script.textContent = `(function(){
    var input=${payload},root=document.getElementById('fc-vega'),result,observer;
    if(!root){root=document.createElement('main');root.id='fc-vega';document.body.append(root)}
    var loader={load:function(){return Promise.reject(Error('External data is disabled'))},sanitize:function(uri){return /^data:image\\/(png|jpeg|webp|gif);base64,/i.test(uri)?Promise.resolve({href:uri}):Promise.reject(Error('External assets are disabled'))}};
    vegaEmbed(root,input.spec,{mode:input.mode,renderer:'svg',actions:false,defaultStyle:false,ast:true,loader:loader}).then(function(value){
      result=value;
      function resize(){if(root.clientWidth>0&&root.clientHeight>0){result.view.width(Math.max(100,root.clientWidth-72)).height(Math.max(100,root.clientHeight-64)).resize().runAsync().catch(failed)}}
      observer=new ResizeObserver(resize);observer.observe(root);resize();
    }).catch(failed);
    function failed(error){var status=document.createElement('p');status.setAttribute('role','alert');status.textContent=error.message||String(error);root.replaceChildren(status)}
    addEventListener('pagehide',function(){if(observer)observer.disconnect();if(result)result.finalize()},{once:true});
  })();`;
  document.body.append(script);
  return `<!doctype html>${document.documentElement.outerHTML}`;
};
