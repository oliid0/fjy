import { validateInteractiveResource } from "./interactiveHtml";

import type { InteractiveResource } from "./interactiveHtml";

/** Engine code is supplied only from installed pinned packages, after authored
 * HTML validation. It executes in the existing opaque-origin/no-eval sandbox. */
export const resourceHtml = async (
  resource: InteractiveResource,
  bootstrap: readonly { name: string; code: string }[] = [],
) => {
  const value = validateInteractiveResource(resource);
  const libraries = new Set(value.libraries || []);
  if (value.visualization) {
    libraries.add("vega");
  }
  const document = new DOMParser().parseFromString(value.html, "text/html");
  const modules: { name: string; code: string }[] = [];
  if (libraries.size) {
    modules.push({
      name: "resource-errors",
      code: `(function(){
        function failed(error){
          var message=String(error&&error.message||error||'Resource initialization failed').slice(0,2000);
          function show(){
            var status=document.querySelector('[data-fc-runtime-error]')||document.createElement('p');
            status.setAttribute('data-fc-runtime-error','');status.setAttribute('role','alert');
            status.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;margin:0;padding:12px;background:#fff;color:#9c182f;border:1px solid currentColor';
            status.textContent=message;document.body.append(status);
          }
          if(document.body)show();else addEventListener('DOMContentLoaded',show,{once:true});
        }
        addEventListener('error',function(event){if(event.message)failed(event.error||event.message)});
        addEventListener('unhandledrejection',function(event){failed(event.reason)});
      })();`,
    });
  }
  if (libraries.has("vega")) {
    const [compatibility, core, lite, embed] = await Promise.all([
      import("./vendor/vega/compatibility.js?raw"),
      import("vega-offline-core?raw"),
      import("vega-offline-lite?raw"),
      import("vega-offline-embed?raw"),
    ]);
    for (const [index, module] of [
      compatibility,
      core,
      lite,
      embed,
    ].entries()) {
      modules.push({ name: `vega-${index}`, code: module.default });
    }
    modules.push({
      name: "vega-config",
      code: `
      (function(){
        var embed=vegaEmbed;
        window.vegaEmbed=function(target,spec,options){
          return embed(target,spec,Object.assign({},options,{ast:true,loader:{
            load:function(){return Promise.reject(Error('External data is disabled'))},
            sanitize:function(uri){return /^data:image\\/(png|jpeg|webp|gif);base64,/i.test(uri)?Promise.resolve({href:uri}):Promise.reject(Error('External assets are disabled'))}
          }}));
        };
        Object.assign(window.vegaEmbed,embed);
      })();`,
    });
  }
  if (libraries.has("jsxgraph")) {
    const core = await import("jsxgraph-offline-core?raw");
    modules.push({ name: "jsxgraph", code: core.default });
    modules.push({
      name: "jsxgraph-config",
      code: `
      JXG.Options.jc.compile=false;
      addEventListener('pagehide',function(){
        Object.keys(JXG.boards).forEach(function(id){JXG.JSXGraph.freeBoard(JXG.boards[id])});
      },{once:true});`,
    });
  }
  modules.push(...bootstrap);
  // A lesson may initialize its board in a head script. All requested engines
  // and their no-eval settings must precede every authored script.
  const firstAuthoredScript = document.head.querySelector("script");
  for (const module of modules) {
    const script = document.createElement("script");
    script.setAttribute("data-fc-library", module.name);
    script.textContent = module.code.replace(/<\/script/gi, "<\\/script");
    document.head.insertBefore(script, firstAuthoredScript);
  }
  if (value.visualization) {
    const visualization = value.visualization;
    const script = document.createElement("script");
    const payload = JSON.stringify(visualization).replace(/</g, "\\u003c");
    script.textContent = `(function(){
    var input=${payload},root=document.getElementById('fc-vega'),result,observer;
    if(!root){root=document.createElement('main');root.id='fc-vega';document.body.append(root)}
    vegaEmbed(root,input.spec,{mode:input.mode,renderer:'svg',actions:false,defaultStyle:false,ast:true}).then(function(value){
      result=value;
      document.dispatchEvent(new CustomEvent('fc-visualization-ready',{detail:result.view}));
      function resize(){if(root.clientWidth>0&&root.clientHeight>0){result.view.width(Math.max(100,root.clientWidth-72)).height(Math.max(100,root.clientHeight-64)).resize().runAsync().catch(failed)}}
      observer=new ResizeObserver(resize);observer.observe(root);resize();
    }).catch(failed);
    function failed(error){var status=document.createElement('p');status.setAttribute('role','alert');status.textContent=error.message||String(error);root.replaceChildren(status)}
    addEventListener('pagehide',function(){if(observer)observer.disconnect();if(result)result.finalize()},{once:true});
  })();`;
    script.setAttribute("data-fc-visualization-runtime", "");
    document.body.append(script);
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
};
