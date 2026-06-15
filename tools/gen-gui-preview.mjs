/**
 * 生成一个自包含的 /gui 预览页（docs/gui-preview.html）。
 *
 * 直接读取真实的 GUI_HTML（src/server/gui/guiPage.ts），在 <body> 顶部注入一段
 * “模拟后端”脚本：拦截 fetch / WebSocket，喂入随时间变化的指标、房间、玩家与日志，
 * 让页面无需真实服务器即可在浏览器中双击打开、完整地“活”起来。
 *
 * 用途：本地肉眼检查 GUI 打磨效果。注意这是演示用 mock，不参与构建与发布。
 *   node tools/gen-gui-preview.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/server/gui/guiPage.ts"), "utf8");

// 取出两个反引号之间的整段 HTML（文件内仅此一处使用反引号）
const first = src.indexOf("`");
const last = src.lastIndexOf("`");
const html = src.slice(first + 1, last);

const mock = `<script>
(function(){
  localStorage.setItem('phira_mp_admin_token','demo');
  var t0=Date.now();
  function hpt(i){return {timestamp:t0-(120-i)*2000,
    cpuPercent:9+13*Math.abs(Math.sin(i/9))+Math.random()*4,
    rss:(120+34*Math.abs(Math.sin(i/14))+Math.random()*4)*1048576,
    heapUsed:(70+12*Math.random())*1048576,heapTotal:118*1048576};}
  var hist=[];for(var i=0;i<120;i++)hist.push(hpt(i));
  function metrics(withHist){var L=hist[hist.length-1];return {ok:true,timestamp:L.timestamp,
    server:{name:'Phira MP',version:'1.11.2'},
    process:{pid:18324,nodeVersion:'v24.3.0',uptime:(Date.now()-(t0-3*3600*1000-12*60*1000))/1000},
    cpu:{percent:L.cpuPercent,cores:16},
    memory:{rss:L.rss,heapUsed:L.heapUsed,heapTotal:L.heapTotal,systemTotal:34359738368},
    business:{onlineUsers:7,activeRooms:2,activeSessions:9,wsConnections:11},
    history:withHist?hist:undefined};}
  var rooms=[{roomid:'A1B2',state:{type:'playing'},locked:true,cycle:false,live:true,
    current_users:3,max_users:8,current_monitors:1,host:{name:'Pimeng'},chart:{name:'Spasmodic',id:90123},
    users:[{id:1,name:'Pimeng',is_host:true,connected:true,finished:true},
      {id:2,name:'霜月',is_host:false,connected:true,aborted:true},
      {id:3,name:'Lyca',is_host:false,connected:false}],
    monitors:[{id:9,name:'观众甲',connected:true}]},
   {roomid:'C3D4',state:{type:'select_chart'},locked:false,cycle:true,live:false,
    current_users:2,max_users:6,current_monitors:0,host:{name:'Aria'},chart:null,
    users:[{id:4,name:'Aria',is_host:true,connected:true},{id:5,name:'Neko',is_host:false,connected:true}],
    monitors:[]}];
  var users=[{id:1,name:'Pimeng',monitor:false,connected:true,banned:false,room:'A1B2'},
    {id:2,name:'霜月',monitor:false,connected:true,banned:false,room:'A1B2'},
    {id:3,name:'Lyca',monitor:false,connected:false,banned:false,room:'A1B2'},
    {id:4,name:'Aria',monitor:false,connected:true,banned:false,room:'C3D4'},
    {id:5,name:'Neko',monitor:false,connected:true,banned:false,room:'C3D4'},
    {id:6,name:'捣蛋鬼',monitor:false,connected:true,banned:true,room:null},
    {id:9,name:'观众甲',monitor:true,connected:true,banned:false,room:'A1B2'}];
  var lv=['INFO','INFO','DEBUG','WARN','INFO','MARK','ERROR'];
  var msgs=['client 7 connected from 1.2.3.4','room A1B2 state -> Playing','heartbeat ok (11 ws)',
    'rate limit near threshold for 5.6.7.8','user 霜月 aborted in room A1B2','chart cache hit #90123',
    'failed to load replay chunk for room A1B2'];
  var logs=[];for(var k=0;k<40;k++)logs.push({timestamp:t0-(40-k)*1500,level:lv[k%lv.length],message:msgs[k%msgs.length]});
  var realFetch=window.fetch;
  window.fetch=function(path,opts){path=String(path);
    function J(o){return Promise.resolve({status:200,json:function(){return Promise.resolve(o);}});}
    if(path.indexOf('/admin/metrics')===0)return J(metrics(path.indexOf('history=1')!==-1));
    if(path.indexOf('/admin/rooms')===0)return J({ok:true,rooms:rooms});
    if(path.indexOf('/admin/users')===0)return J({ok:true,users:users});
    if(path.indexOf('/admin/console/logs')===0)return J({ok:true,lines:logs});
    if(path.indexOf('/admin/console/command')===0){var b=JSON.parse((opts&&opts.body)||'{}');var c=b.command||'';
      var out=[{kind:'cmd',text:'> '+c}];
      if(c==='help')out.push({kind:'info',text:'commands: help list users kick ban broadcast stop ...'});
      else if(c==='list'||c==='rooms')out.push({kind:'out',text:'A1B2 Playing 3/8 +1观  ·  C3D4 SelectChart 2/6'});
      else out.push({kind:'out',text:'(demo) executed: '+c});
      return J({ok:true,lines:out});}
    return realFetch?realFetch(path,opts):J({ok:false});};
  function FakeWS(){var self=this;this.readyState=1;
    setTimeout(function(){if(self.onopen)self.onopen();
      if(self.onmessage)self.onmessage({data:JSON.stringify({type:'console_subscribed',data:{lines:logs}})});},150);
    this._t=setInterval(function(){if(!self.onmessage)return;
      self.onmessage({data:JSON.stringify({type:'console_log',data:{timestamp:Date.now(),
        level:lv[Math.floor(Math.random()*lv.length)],message:msgs[Math.floor(Math.random()*msgs.length)]}})});},1800);}
  FakeWS.prototype.send=function(){};FakeWS.prototype.close=function(){clearInterval(this._t);};
  window.WebSocket=FakeWS;
  setInterval(function(){var L=hist[hist.length-1];
    hist.push({timestamp:Date.now(),cpuPercent:Math.min(98,Math.max(2,L.cpuPercent+(Math.random()-0.5)*9)),
      rss:Math.max(96*1048576,L.rss+(Math.random()-0.5)*9*1048576),
      heapUsed:Math.max(40*1048576,L.heapUsed+(Math.random()-0.5)*5*1048576),heapTotal:L.heapTotal});
    if(hist.length>150)hist.shift();},2000);
})();
</script>`;

const out = html.replace("<body>", "<body>\n" + mock);
writeFileSync(join(root, "docs/gui-preview.html"), out, "utf8");
console.log("wrote docs/gui-preview.html (" + out.length + " bytes)");
