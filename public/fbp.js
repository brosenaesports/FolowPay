/* Meta Pixel 1678328160663000. Starts after the page has loaded, so it never slows the first paint. */
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
var go=function(){t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)};
b.readyState==='complete'?go():f.addEventListener('load',go)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','1678328160663000');fbq('track','PageView');
// fbe(name, data, onceId): safe event helper. With onceId the event is sent only once per browser (no double counting).
window.fbe=function(name,data,id){try{if(id){var k='fbe_'+id;if(localStorage.getItem(k))return;localStorage.setItem(k,'1')}fbq('track',name,data||{})}catch(e){}};
