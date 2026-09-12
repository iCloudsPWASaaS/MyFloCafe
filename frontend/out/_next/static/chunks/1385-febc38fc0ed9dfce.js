"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1385],{83766:(t,e,r)=>{r.d(e,{ZD:()=>p,mj:()=>b,printWebBill:()=>m});var a=r(38434),n=r(30283),l=r(40980);r(55655);var i=r(8509),o=r(83749),d=r(58487),s=r(65287);function p(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function c(t,e){return t?"ltr"===t.direction&&"rtl"===e?`<span class="ltr" dir="ltr">${p(t.text)}</span>`:p(t.text):""}async function m(t,e,r={}){let n=u(r),l=window.open("","_blank","width=800,height=600");if(!l)throw a.Ay.error("Please allow popups to print bills"),Error("Popup window was blocked by browser");let o=(await (0,i.OG)(n)).map(t=>({field:"receipt language",text:t,message:`Receipt language "${t}" could not be loaded, so English labels were used. Check the locale bundle and retry.`,kind:"locale"})),d=b(t,e,{...r,languages:n});if(l.closed)throw Error("Print window was closed before receipt could be printed");return new Promise((t,e)=>{let r=!1,n=null,i=a=>{r||(r=!0,n&&(clearInterval(n),n=null),a?e(a):t())},o=()=>{try{if(l.closed)return void i(Error("Print window was closed before receipt could be printed"));l.print(),i()}catch(t){console.error("Failed to trigger print on window:",t),a.Ay.error("Failed to open print dialog"),i(t instanceof Error?t:Error(String(t)))}};try{if(l.document.open(),l.document.write(d),l.document.close(),"complete"===l.document.readyState)o();else{l.onload=()=>{o()};let t=0;n=setInterval(()=>{t+=50,l.closed?i(Error("Print window was closed before receipt could be printed")):("complete"===l.document.readyState||t>=3e3)&&o()},50)}}catch(t){console.error("Failed to write receipt to print window:",t),a.Ay.error("Failed to open print dialog"),i(t instanceof Error?t:Error(String(t)))}}).then(()=>o)}function b(t,e,r={}){var a;let{paperSize:m="thermal58",includeTaxId:$=!1,taxRegistrationNumber:y,address:w,phone:f,footerNote:v,businessName:I,showBusinessName:N=!0,showTaxBreakdown:k=!0,showCustomerName:C=!0,showCustomerPhone:T=!0,showTableNumber:B=!0,isReprint:E=!1,trimDecimals:z=!1}=r,_=u(r),D=_[0],j=(0,i.Zt)(t,e,{columns:"thermal80"===m?48:42,businessName:N?I??e.business_name:void 0,address:w,phone:f,footerNote:v,taxRegistrationNumber:y,includeTaxId:$&&!!y,taxIdLabel:(a=e.country,a?.toUpperCase()==="IR"?(0,i.wv)("receipt.economicCode",D):(0,n.jM)(a??"IN")?.taxIdLabel||"Tax ID"),showBusinessName:N,showTaxBreakdown:k,showCustomerName:C,showCustomerPhone:T,showTableNumber:B,isReprint:E,trimDecimals:z,languages:_}),O=j.direction.base,S=d.Yj[D]?.locale??D,A=(0,s.gd)(j,"business-header"),F=(0,s.gd)(j,"document-meta"),P=(0,s.gd)(j,"customer"),R=(0,s.gd)(j,"item-table"),L=(0,s.gd)(j,"tax-breakdown"),Y=(0,s.gd)(j,"totals"),q=(0,s.gd)(j,"payments"),H=(0,s.gd)(j,"message"),U=g(F?.table?.label,"pos.tableLabel",D),Z={billNumber:g(F?.billNumberLabel,"receipt.billNumber",D),date:g(F?.dateLabel,"receipt.date",D),table:U.replace("{name}","").replace(/[:：]\s*$/,"").trim(),customer:g(P?.nameLabel,"pos.customer",D),customerNo:g(P?.phoneLabel,"print.numberShort",D),deliveryAddress:(0,i.wv)("pos.deliveryAddress",D),rate:(0,i.wv)("receipt.rate",D),totalTax:x(Y?.tax?.label,"pos.tax","receipt.totalTax",D),deliveryCharge:x(Y?.deliveryCharge?.label,"pos.delivery","receipt.deliveryCharge",D),packagingCharge:g(Y?.packagingCharge?.label,"pos.packaging",D),grandTotal:x(Y?.grandTotal?.label,"print.grandTotal","receipt.grandTotal",D),taxDetails:(0,i.wv)("receipt.taxDetails",D),paymentsHeader:(0,i.wv)("receipt.payments",D),thankYou:x(H?.thankYou,"print.thankYouShort","receipt.thankYou",D),taxIncluded:(0,i.wv)("receipt.taxIncluded",D),printBill:(0,i.wv)("receipt.printBill",D)},M=Z.billNumber,G=function(t){let e=`
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, 'Segoe UI', Tahoma, 'Noto Naskh Arabic', 'Helvetica Neue', Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #333; }
    .bill-container { max-width: 100%; margin: 0 auto; }
    .reprint-banner { text-align: center; font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #c00; border: 3px solid #c00; padding: 6px; margin-bottom: 15px; }
    .online-order-banner { text-align: center; font-size: 18px; font-weight: bold; letter-spacing: 1px; border: 2px solid #333; padding: 6px; margin-bottom: 15px; }
    .online-order-banner .online-order-detail { font-size: 13px; font-weight: normal; letter-spacing: normal; margin-top: 2px; }
    .header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 1px solid #ccc; }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .bill-details { margin-bottom: 15px; }
    .bill-details table { width: 100%; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .items-table th, .items-table td { padding: 8px; border-bottom: 1px solid #eee; text-align: start; }
    .items-table th { background: #f5f5f5; font-weight: bold; }
    .tax-table, .payments-table { width: 50%; margin-inline-start: 50%; border-collapse: collapse; margin-bottom: 15px; }
    .tax-table th, .tax-table td, .payments-table th, .payments-table td { padding: 6px 8px; }
    .tax-table th, .payments-table th { background: #f9f9f9; text-align: start; }
    .totals-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .totals-table td { padding: 6px 8px; }
    .total-row { border-top: 2px solid #333; font-size: 16px; }
    .footer { text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #ccc; }
    .powered-by { font-size: 10px; margin-top: 8px; color: #555; }
    .text-end { text-align: end !important; }
    .num { unicode-bidi: isolate; white-space: nowrap; }
    .ltr { direction: ltr; unicode-bidi: isolate; }
    .text-muted { color: #666; }
    .text-italic { font-style: italic; color: #888; }
  `;switch(t){case"thermal58":return e+`
        .bill-container { padding: 5px; max-width: 58mm; font-size: 10px; }
        .header h1 { font-size: 14px; }
        .items-table th, .items-table td, .tax-table td, .totals-table td, .payments-table td { padding: 2px 4px; }
      `;case"thermal80":return e+`
        .bill-container { padding: 10px; max-width: 80mm; font-size: 11px; }
        .header h1 { font-size: 16px; }
      `;default:return e}}(m),J=R?.rows??[],W=Y?.tax!=null||null!=L&&L.lines.length>0;return`<!DOCTYPE html>
<html lang="${S}" dir="${O}">
<head>
  <meta charset="utf-8">
  <title>${p(M)} ${p(F?.invoiceNumber.text??"")}</title>
  <style>
    ${G}
    @media print {
      .no-print { display: none !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="bill-container">
    ${H?.reprintBanner?`<div class="reprint-banner">${p(H.reprintBanner.primary)}</div>`:""}
    ${H?.onlineOrderBanner?`<div class="online-order-banner">${p(H.onlineOrderBanner.label.primary)}${H.onlineOrderBanner.platform.text?`<div class="online-order-detail">${p(H.onlineOrderBanner.platform.text)}</div>`:""}${H.onlineOrderBanner.externalOrderId.text?`<div class="online-order-detail">#${p(H.onlineOrderBanner.externalOrderId.text)}</div>`:""}</div>`:""}
    <!-- Header -->
    <div class="header">
      ${A?.name?`<h1>${p(A.name.text)}</h1>`:""}
      ${A?.address?`<p>${p(A.address.text).replace(/\n/g,"<br>")}</p>`:""}
      ${A?.phone&&A.phoneLabel?`<p>${p(A.phoneLabel.primary)}: ${c(A.phone,O)}</p>`:""}
      ${A?.taxId?`<p>${p(A.taxId.label.primary)}: ${c(A.taxId.value,O)}</p>`:""}
    </div>

    <!-- Bill Details -->
    <div class="bill-details">
      <table>
        <tr>
          <td><strong>${p(M)}</strong> ${F?c(F.invoiceNumber,O):""}</td>
          <td class="text-end"><strong>${p(Z.date)}</strong> ${F?p(function(t,e,r){if(!t)return"";try{let a=(0,l.A)(t);if(isNaN(a.getTime()))return t;return(0,n.nN)(a,e.country,e.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,{digits:e.number_digits,calendar:e.calendar},{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"},r)}catch{return t}}(F.timestamp.text,e,d.Yj[D]?.locale??D)):""}</td>
        </tr>
        ${F?.table?`<tr><td><strong>${p(Z.table)}</strong> ${p(F.table.name.text)}</td><td></td></tr>`:""}
        ${P?.name?`<tr><td><strong>${p(Z.customer)}</strong> ${p(P.name.text)}</td><td></td></tr>`:""}
        ${P?.phone?`<tr><td><strong>${p(Z.customerNo)}</strong> ${c(P.phone,O)}</td><td></td></tr>`:""}
        ${P?.address?`<tr><td><strong>${p(Z.deliveryAddress)}</strong> ${p(P.address.text)}</td><td></td></tr>`:""}
      </table>
    </div>

    <!-- Items Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th>${p(R?.header.item.primary??"")}</th>
          <th class="text-end">${p(R?.header.quantity.primary??"")}</th>
          <th class="text-end">${p(Z.rate)}</th>
          <th class="text-end">${p(R?.header.amount.primary??"")}</th>
        </tr>
      </thead>
      <tbody>
        ${J.map(t=>{let r;return`
          <tr>
            <td>
              ${p(t.name.text)}
              ${t.addons.length>0?`<br><small class="text-muted">${t.addons.map(t=>`+ ${p(t.name.text)}${(t.quantity??1)>1?` \xd7${p(t.quantity)}`:""}`).join(", ")}</small>`:""}
              ${t.specialInstructions?`<br><small class="text-italic">${p(t.specialInstructions.text)}</small>`:""}
            </td>
            <td class="text-end num">${r=t.quantity,(0,n.w4)(Number(r)||0,e.country,{digits:e.number_digits})}</td>
            <td class="text-end num">${h(t.unitPrice??0,e,z)}</td>
            <td class="text-end num">${h(t.amount,e,z)}</td>
          </tr>
        `}).join("")}
      </tbody>
    </table>

    <!-- Tax Breakdown -->
    ${L&&L.lines.length>0?`
    <table class="tax-table">
      <thead>
        <tr><th colspan="2">${p(Z.taxDetails)}</th></tr>
      </thead>
      <tbody>
        ${L.lines.map(t=>`
          <tr><td>${p(null===t.rate?t.label.primary:`${t.label.primary} @${t.rate}%`)}</td><td class="text-end num">${h(t.amount,e,z)}</td></tr>
        `).join("")}
      </tbody>
    </table>
    `:""}

    <!-- Totals -->
    <table class="totals-table">
      ${Y?`
      ${Y.pointsRedeemed?`<tr><td>${p(Y.pointsRedeemed.label.primary)}</td><td class="text-end num">-${p(Y.pointsRedeemed.points)} pts</td></tr>`:""}
      <tr><td>${p(Y.subtotal.label.primary)}</td><td class="text-end num">${h(Y.subtotal.amount,e,z)}</td></tr>
      ${Y.discount?`<tr><td>${p(Y.discount.label.primary)}</td><td class="text-end num">-${h(Y.discount.amount,e,z)}</td></tr>`:""}
      ${Y.tax?`<tr><td>${p(Z.totalTax)}</td><td class="text-end num">${h(Y.tax.amount,e,z)}</td></tr>`:""}
      ${Y.serviceCharge?`<tr><td>${p(Y.serviceCharge.label.primary)}</td><td class="text-end num">${h(Y.serviceCharge.amount,e,z)}</td></tr>`:""}
      ${Y.deliveryCharge?`<tr><td>${p(Z.deliveryCharge)}</td><td class="text-end num">${h(Y.deliveryCharge.amount,e,z)}</td></tr>`:""}
      ${Y.packagingCharge?`<tr><td>${p(Z.packagingCharge)}</td><td class="text-end num">${h(Y.packagingCharge.amount,e,z)}</td></tr>`:""}
      <tr class="total-row"><td><strong>${p(Z.grandTotal)}</strong></td><td class="text-end num"><strong>${h(Y.grandTotal.amount,e,z)}</strong></td></tr>
      ${Y.pointsEarned?`<tr><td>${p(Y.pointsEarned.label.primary)}</td><td class="text-end num">${p(Y.pointsEarned.points)} pts</td></tr>`:""}
      ${Y.pointsBalance?`<tr><td>${p(Y.pointsBalance.label.primary)}</td><td class="text-end num">${p(Y.pointsBalance.points)} pts</td></tr>`:""}
      `:""}
    </table>

    <!-- Payments -->
    ${q&&q.lines.length>0?`
    <table class="payments-table">
      <thead>
        <tr><th colspan="2">${p(Z.paymentsHeader)}</th></tr>
      </thead>
      <tbody>
        ${q.lines.map(t=>{var r;return`
          <tr><td>${p(void 0!==(r=t.label).conceptId?r.primary:r.primary.charAt(0).toUpperCase()+r.primary.slice(1))}</td><td class="text-end num">${h(t.amount,e,z)}</td></tr>
        `}).join("")}
      </tbody>
    </table>
    `:""}

    <!-- Footer -->
    <div class="footer">
      ${H?.footerNote?`<p>${p(H.footerNote.text)}</p>`:`<p>${p(Z.thankYou)}</p>`}
      ${W?`<p>${p(Z.taxIncluded)}</p>`:""}
      <p class="powered-by">${p(o.P)}<br>${p(o.Z)}</p>
    </div>
  </div>

  <div class="no-print" style="text-align:center;margin-top:20px;">
    <button onclick="window.print()" style="padding:10px 20px;font-size:16px;cursor:pointer;">${p(Z.printBill)}</button>
  </div>
</body>
</html>
  `}function u(t){return t.languages??(0,i.Si)(t.language)}function g(t,e,r){return t?.primary??(0,i.wv)(e,r)}function x(t,e,r,a){let n=(0,i.wv)(e,a);return t&&t.primary!==n?t.primary:(0,i.wv)(r,a)}function h(t,e,r=!1){let a=Number.isFinite(Number(t))?Number(t):0,l={currencyDisplay:e.currency_display,digits:e.number_digits},i=(0,n.EJ)(e.currency??"INR"),o=10**i,d=i>0&&Math.round(a*o)%o!=0,s=("IRR"===e.currency||!e.currency&&"IR"===e.country)&&("toman"===e.currency_display||"toman_short"===e.currency_display);if(r&&!d&&!s){let t=(0,n.jM)(e.country??"IN")?.locale??"en-US",r="latin"===e.number_digits?"latn":void 0;try{return new Intl.NumberFormat(t,{style:"currency",currency:e.currency||"INR",currencyDisplay:"narrowSymbol",...r?{numberingSystem:r}:{},minimumFractionDigits:0,maximumFractionDigits:0}).format(a)}catch{}}return(0,n.wH)(a,e.country,e.currency,l)}}}]);