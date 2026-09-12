"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[2301],{52301:(t,e,n)=>{n.d(e,{generateKotHtml:()=>$,resolveKotTicketLanguage:()=>m});var r=n(16191),i=n(55655),a=n(58487),o=n(9932),s=n(65287),l=n(4743),p=n(67489),d=n(10393),u=n(54836),c=n(83766);function m(t){if(t)return t;try{let t=p.I.getState(),e=t.language;return(0,o.Tt)(t.kotLanguagePolicy??(0,o.di)(),e)}catch{return"en"}}function g(t){let e=a.Yj[t]?.locale??"en",n=(0,i.TF)(t)??(0,i.TF)("en")??{};return(0,r.HM)({locale:e,messages:n})}function y(t,e){return"ltr"===t.direction&&"rtl"===e?`<span dir="ltr" style="direction:ltr;unicode-bidi:isolate;">${(0,c.ZD)(t.text)}</span>`:(0,c.ZD)(t.text)}function $(t,e={}){var n,r;let i,o,p,Z,f=e.paperWidth??58,x=m(e.language),v=g(x),D=function(t){try{return(0,a.iJ)(t)}catch{let e=g(t)("print.kot.banner");return(0,l.Xf)(e)?"rtl":"ltr"}}(x),b=function(t){if(t)return t;try{return d.n.getState().currentTenant?.timezone??void 0}catch{return}}(e.timezone),h=58===f?"4px":"6px",k=a.Yj[x]?.locale??"en-US",S=(0,s.UZ)(String(t.order_number??""),D),_=String(t.created_at??""),T=String(e.stationName??""),U=(n=t.type,(o=({dine_in:"pos.orderTypeDineIn",delivery:"pos.orderTypeDelivery",online:"pos.orderTypeOnline",takeaway:"pos.orderTypeTakeaway"})[i=String(n??"").trim()])?v(o):i.replace(/_/g," ").toUpperCase()),w=(t.items??[]).filter(t=>(0,s.Ny)(t.status)).map(t=>({name:(0,s.UZ)(String(t.product_name??""),D),quantity:Number(t.quantity)||0,addons:(Array.isArray(t.addons)?t.addons:[]).filter(t=>t?.name),specialInstructions:t.special_instructions?(0,s.UZ)(String(t.special_instructions),D):null})),N=w.length>0?w.map(t=>`
        <div style="margin:${h} 0;">
          <div style="font-weight:bold;">${(0,c.ZD)(t.quantity)}x ${y(t.name,D)}</div>
          ${t.addons.map(t=>{let e="quantity"in t&&"number"==typeof t.quantity&&t.quantity||1,n=e>1?` x${e}`:"";return`<div style="padding-inline-start:1em;">+ ${(0,c.ZD)(t.name)}${(0,c.ZD)(n)}</div>`}).join("")}
          ${t.specialInstructions?`<div style="padding-inline-start:1em;font-style:italic;">&gt;&gt; ${y(t.specialInstructions,D)}</div>`:""}
        </div>
      `).join(""):`<div style="margin:${h} 0;">${(0,c.ZD)(v("print.kot.noPendingItems"))}</div>`;return`
    <div class="kot-container" dir="${D}" style="text-align:start;padding:${h};font-family:'Courier New',monospace;font-size:${58===f?"10px":"12px"};">
      <h2 style="margin:0 0 ${h} 0;font-size:${58===f?"14px":"16px"};text-align:center;">${(0,c.ZD)(v("print.kot.banner"))}</h2>
      ${T?`<p style="margin:2px 0;">${(0,c.ZD)(v("print.kot.station"))}: ${y((0,s.UZ)(T,D),D)}</p>`:""}
      <p style="margin:2px 0;font-weight:bold;">${r=v("pos.orderNumber"),p="{number}",-1===(Z=r.indexOf(p))?(0,c.ZD)(r+": ")+y(S,D):(0,c.ZD)(r.slice(0,Z))+y(S,D)+(0,c.ZD)(r.slice(Z+p.length))}</p>
      ${t.table?.name?`<p style="margin:2px 0;">${(0,c.ZD)(v("pos.tableLabel").replace("{name}","").replace(/[:：]\s*$/,"").trim())}: ${y((0,s.UZ)(String(t.table.name),D),D)}</p>`:""}
      ${U?`<p style="margin:2px 0;">${(0,c.ZD)(v("print.kot.type"))}: ${(0,c.ZD)(U)}</p>`:""}
      ${t.customer?.name?`<p style="margin:2px 0;">${(0,c.ZD)(v("pos.customer"))}: ${y((0,s.UZ)(String(t.customer.name),D),D)}</p>`:""}
      <p style="margin:2px 0;">${(0,c.ZD)(`${v("print.time")}: ${(0,u.f)(_,k,b?{timeZone:b}:void 0)}`)}</p>
      <hr style="border:1px dashed #000;margin:${h} 0;">
      ${N}
      <hr style="border:1px dashed #000;margin:${h} 0;">
      <p style="margin:2px 0;text-align:center;">${(0,c.ZD)(`--- ${v("print.kot.end")} ---`)}</p>
    </div>
  `}}}]);