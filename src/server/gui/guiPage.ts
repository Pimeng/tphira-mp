/**
 * 服务端 GUI 页面（嵌入式单文件 HTML）
 *
 * 类似 Minecraft 服务端 GUI 的管理面板：
 * - 左侧：CPU / 内存实时曲线、业务计数器、房间 / 玩家列表；
 * - 右侧：日志控制台（WebSocket 实时流）+ 命令输入（与终端 CLI 同一套命令）。
 *
 * 设计为零外部资源依赖（无字体 / CDN / 图片请求），离线与 SEA 单文件打包均可用。
 * 页面本身公开（GET /gui），所有数据接口均需管理员 token（x-admin-token）。
 *
 * 注意：嵌入的客户端 JS 刻意不使用模板字符串（反引号与 ${），
 * 以避免与本文件的 TS 模板字符串转义冲突。
 */
export const GUI_HTML = `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%230c1016'/%3E%3Cpath d='M4 5l3 3-3 3' stroke='%233fdc97' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3Cpath d='M8.5 11.2h3.5' stroke='%233fdc97' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E">
<title>Phira MP 服务端控制台</title>
<style>
:root{
  --bg:#0c1016;--panel:#141a23;--panel2:#0a0e14;--border:#222c3b;--border2:#2e3a4d;
  --text:#c8d3e4;--muted:#5d6b82;--dim:#8b97ab;
  --acc:#3fdc97;--warn:#f7b955;--err:#ff6e6e;--info:#58c4dc;--debug:#7aa2f7;--mark:#7e8aa0;
  --acc-contrast:#06281a;--strong:#e8eefb;
  --hover:rgba(255,255,255,.025);--gridline:rgba(255,255,255,.012);--scanline:rgba(0,0,0,.12);
  --chip-bg:#1a2230;--scrollbar:#2a3547;
  --chart-mem:63,220,151;--chart-cpu:88,196,220;--chart-grid:rgba(255,255,255,.05);
  --mono:"Cascadia Mono","JetBrains Mono",Consolas,"Sarasa Mono SC","Noto Sans Mono CJK SC","Microsoft YaHei",monospace;
  color-scheme:dark;
}
:root[data-theme="light"]{
  --bg:#eef1f5;--panel:#ffffff;--panel2:#f3f5f9;--border:#dbe1ea;--border2:#c4cedd;
  --text:#222c3a;--muted:#8a94a6;--dim:#525e72;
  --acc:#0c9d5e;--warn:#b3791b;--err:#d23f3f;--info:#0c7f9b;--debug:#3a5bc7;--mark:#74808f;
  --acc-contrast:#ffffff;--strong:#101723;
  --hover:rgba(20,30,50,.04);--gridline:rgba(20,30,50,.025);--scanline:rgba(20,30,50,.025);
  --chip-bg:#e9edf3;--scrollbar:#c2ccda;
  --chart-mem:12,157,94;--chart-cpu:12,127,155;--chart-grid:rgba(20,30,45,.08);
  color-scheme:light;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{
  background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;
  background-image:
    repeating-linear-gradient(0deg,var(--gridline) 0,var(--gridline) 1px,transparent 1px,transparent 32px),
    repeating-linear-gradient(90deg,var(--gridline) 0,var(--gridline) 1px,transparent 1px,transparent 32px);
  transition:background-color .2s,color .2s;
}
.hidden{display:none!important}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:4px}
::-webkit-scrollbar-track{background:transparent}

/* ===== 登录层 ===== */
#login{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:50}
.login-box{width:min(360px,90vw);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:28px 26px}
.login-box h1{font-size:16px;letter-spacing:.08em;margin-bottom:4px}
.login-box p{color:var(--muted);font-size:11px;margin-bottom:18px}
.login-box input{width:100%;background:var(--panel2);border:1px solid var(--border2);color:var(--text);
  font-family:var(--mono);font-size:13px;padding:9px 10px;border-radius:5px;outline:none}
.login-box input:focus{border-color:var(--acc)}
.login-box button{width:100%;margin-top:12px;background:var(--acc);color:var(--acc-contrast);border:0;border-radius:5px;
  padding:9px;font-family:var(--mono);font-size:13px;font-weight:700;letter-spacing:.2em;cursor:pointer}
.login-box button:hover{filter:brightness(1.1)}
#loginErr{color:var(--err);font-size:11px;margin-top:10px;min-height:14px}

/* ===== 框架 ===== */
#app{display:flex;flex-direction:column;height:100vh;padding:10px;gap:10px}
header{display:flex;align-items:center;justify-content:space-between;gap:14px;
  background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 16px}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.dot{width:9px;height:9px;border-radius:50%;background:var(--acc);box-shadow:0 0 8px var(--acc);animation:pulse 2s infinite}
.dot.off{background:var(--err);box-shadow:0 0 8px var(--err);animation:none}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
.brand h1{font-size:14px;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand .sub{font-size:10px;color:var(--muted);letter-spacing:.1em}
.head-right{display:flex;align-items:center;gap:18px}
.hstat{text-align:right}
.hstat label{display:block;font-size:9px;color:var(--muted);letter-spacing:.18em;text-transform:uppercase}
.hstat b{font-size:12px;font-weight:600;color:var(--dim)}
.head-btn{background:transparent;border:1px solid var(--border2);color:var(--muted);border-radius:5px;
  padding:5px 12px;font-family:var(--mono);font-size:11px;cursor:pointer}
#themeToggle{padding:5px 9px;font-size:13px;line-height:1}
#themeToggle:hover{color:var(--acc);border-color:var(--acc)}
#logout:hover{color:var(--err);border-color:var(--err)}

main{display:flex;gap:10px;flex:1;min-height:0}
aside{width:320px;display:flex;flex-direction:column;gap:10px;min-height:0;flex-shrink:0}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;flex-direction:column;min-height:0;transition:background-color .2s,border-color .2s}
.panel>h2{font-size:10px;color:var(--muted);letter-spacing:.22em;text-transform:uppercase;margin-bottom:10px}
.grow{flex:1}

/* ===== 图表 ===== */
canvas{width:100%;height:64px;display:block;background:var(--panel2);border:1px solid var(--border);border-radius:5px}
.cap{display:flex;justify-content:space-between;font-size:10px;color:var(--dim);margin:5px 1px 12px}
.cap b{color:var(--text)}
.counters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px}
.counter{background:var(--panel2);border:1px solid var(--border);border-radius:5px;padding:8px 10px}
.counter b{display:block;font-size:18px;color:var(--acc);font-weight:700;line-height:1.2}
.counter label{font-size:9px;color:var(--muted);letter-spacing:.15em}

/* ===== 列表 ===== */
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{flex:1;background:var(--panel2);border:1px solid var(--border);color:var(--muted);border-radius:5px;
  padding:6px;font-family:var(--mono);font-size:11px;letter-spacing:.15em;cursor:pointer}
.tabs button.active{color:var(--acc);border-color:var(--acc)}
.list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:0}
.empty{color:var(--muted);font-size:11px;text-align:center;padding:24px 0}
.room{background:var(--panel2);border:1px solid var(--border);border-radius:5px;overflow:hidden}
.room-head{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;user-select:none}
.room-head:hover{background:var(--hover)}
.rid{font-weight:700;letter-spacing:.05em}
.badge{font-size:9px;padding:2px 6px;border-radius:3px;letter-spacing:.08em;flex-shrink:0}
.st-select{background:color-mix(in srgb,var(--debug) 16%,transparent);color:var(--debug)}
.st-ready{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.st-playing{background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--acc)}
.flag{font-size:10px;color:var(--muted)}
.room-cnt{margin-left:auto;color:var(--muted);font-size:11px}
.room-body{display:none;border-top:1px solid var(--border);padding:8px 9px;font-size:11px;color:var(--dim)}
.room.open .room-body{display:block}
.room-body .row{margin-bottom:5px}
.room-body .row:last-child{margin-bottom:0}
.room-body .k{color:var(--muted)}
.chip{display:inline-block;background:var(--chip-bg);border:1px solid var(--border);border-radius:3px;
  padding:1px 6px;margin:2px 3px 0 0;font-size:10px;color:var(--dim)}
.chip.host{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.chip.offline{opacity:.45;text-decoration:line-through}
.player-row{display:flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--border);
  border-radius:5px;padding:6px 9px;font-size:11px}
.player-row .pname{color:var(--text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.player-row .pid{color:var(--muted);font-size:10px}
.player-row .proom{margin-left:auto;color:var(--info);font-size:10px}
.player-row .proom.lobby{color:var(--muted)}
.player-row .prole{color:var(--muted);font-size:10px;flex-shrink:0}
.player-row .pban{color:var(--err);font-size:10px;flex-shrink:0}

/* ===== 控制台 ===== */
.console{flex:1;min-width:0}
#log{flex:1;overflow-y:auto;background:var(--panel2);border:1px solid var(--border);border-radius:5px;
  padding:8px 10px;font-size:12px;line-height:1.55;min-height:0;
  background-image:repeating-linear-gradient(0deg,transparent 0,transparent 2px,var(--scanline) 3px)}
.ll{white-space:pre-wrap;word-break:break-all}
.ll .t{color:var(--muted)}
.ll .lv{font-weight:700}
.lv-DEBUG{color:var(--debug)}.lv-INFO{color:var(--acc)}.lv-MARK{color:var(--mark)}
.lv-WARN{color:var(--warn)}.lv-ERROR{color:var(--err)}
.ll.k-cmd{color:var(--strong);font-weight:700}
.ll.k-error{color:var(--err)}
.ll.k-success{color:var(--acc)}
.ll.k-info{color:var(--info)}
.ll.k-out{color:var(--dim)}
#cmdForm{display:flex;align-items:center;gap:8px;margin-top:10px}
.prompt{color:var(--acc);font-weight:700;position:relative}
.prompt::after{content:"";display:inline-block;width:7px;height:14px;background:var(--acc);
  margin-left:4px;vertical-align:-2px;animation:blink 1.1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
#cmdInput{flex:1;background:var(--panel2);border:1px solid var(--border2);color:var(--text);
  font-family:var(--mono);font-size:13px;padding:8px 10px;border-radius:5px;outline:none}
#cmdInput:focus{border-color:var(--acc);box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 30%,transparent)}
#cmdSend{background:var(--acc);color:var(--acc-contrast);border:0;border-radius:5px;padding:8px 16px;
  font-family:var(--mono);font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.1em}
#cmdSend:hover{filter:brightness(1.1)}

@media (max-width:900px){
  #app{height:auto;min-height:100vh}
  main{flex-direction:column}
  aside{width:100%}
  .console{min-height:60vh}
  #log{min-height:40vh}
}
</style>
</head>
<body>

<div id="login">
  <form class="login-box" id="loginForm">
    <h1>PHIRA MP 服务端控制台</h1>
    <p>请输入管理员令牌（ADMIN_TOKEN）</p>
    <input id="tokenInput" type="password" placeholder="admin token" autocomplete="current-password">
    <button type="submit">进 入</button>
    <div id="loginErr"></div>
  </form>
</div>

<div id="app" class="hidden">
  <header>
    <div class="brand">
      <span class="dot off" id="connDot"></span>
      <div>
        <h1 id="srvName">Phira MP</h1>
        <span class="sub" id="srvSub">v- · -</span>
      </div>
    </div>
    <div class="head-right">
      <div class="hstat"><label>运行时间</label><b id="uptime">--:--:--</b></div>
      <div class="hstat"><label>连接</label><b id="connText">未连接</b></div>
      <button id="themeToggle" class="head-btn" type="button" title="切换深浅色">☀</button>
      <button id="logout" class="head-btn" type="button">退出</button>
    </div>
  </header>

  <main>
    <aside>
      <section class="panel">
        <h2>性能监控</h2>
        <canvas id="memChart" height="64"></canvas>
        <div class="cap"><span>内存 <b id="memNow">-</b></span><span id="memDetail">-</span></div>
        <canvas id="cpuChart" height="64"></canvas>
        <div class="cap"><span>CPU <b id="cpuNow">-</b></span><span id="cpuDetail">-</span></div>
        <div class="counters">
          <div class="counter"><b id="cUsers">0</b><label>在线玩家</label></div>
          <div class="counter"><b id="cRooms">0</b><label>活跃房间</label></div>
          <div class="counter"><b id="cSessions">0</b><label>活跃会话</label></div>
          <div class="counter"><b id="cWs">0</b><label>WS 连接</label></div>
        </div>
      </section>
      <section class="panel grow">
        <div class="tabs">
          <button type="button" id="tabRooms" class="active">房间</button>
          <button type="button" id="tabPlayers">玩家</button>
        </div>
        <div id="roomList" class="list"><div class="empty">暂无房间</div></div>
        <div id="playerList" class="list hidden"><div class="empty">暂无玩家</div></div>
      </section>
    </aside>

    <section class="panel console">
      <h2>控制台</h2>
      <div id="log"></div>
      <form id="cmdForm">
        <span class="prompt">&gt;</span>
        <input id="cmdInput" placeholder="输入命令，help 查看全部命令" autocomplete="off" spellcheck="false">
        <button id="cmdSend" type="submit">执行</button>
      </form>
    </section>
  </main>
</div>

<script>
(function(){
'use strict';
var TOKEN_KEY='phira_mp_admin_token';
var MAX_POINTS=150, MAX_LOG_DOM=800;
var $=function(id){return document.getElementById(id);};
var token=localStorage.getItem(TOKEN_KEY)||'';
// GUI 窗口模式：服务器把本机专用 token 放在 URL 片段里（不经过网络请求与日志），读取后立即清除
var hashToken=/[#&]token=([^&]+)/.exec(location.hash||'');
if(hashToken){
  token=decodeURIComponent(hashToken[1]);
  localStorage.setItem(TOKEN_KEY,token);
  try{history.replaceState(null,'',location.pathname);}catch(e){}
}
var ws=null, wsRetry=null, pollTimer=null, upTimer=null;
var samples=[];            // {timestamp,cpuPercent,rss,heapUsed,heapTotal}
var rooms=[];              // admin rooms data
var players=[];            // 全部在线用户（含未进房间的大厅玩家）
var pollTick=0;
var openRooms={};          // roomid -> true（保持展开状态）
var cpuCores=1, sysTotal=0, uptimeBase=0, uptimeAt=0;
var cmdHistory=[], histIdx=-1;

function esc(s){return String(s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

/* ===== 深浅色主题 ===== */
var THEME_KEY='phira_mp_gui_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  var btn=$('themeToggle');
  if(btn)btn.textContent=t==='dark'?'☀':'☾';
  drawCharts();
}
var savedTheme=localStorage.getItem(THEME_KEY);
var sysLight=window.matchMedia?window.matchMedia('(prefers-color-scheme: light)'):null;
applyTheme(savedTheme==='light'||savedTheme==='dark'?savedTheme:(sysLight&&sysLight.matches?'light':'dark'));
// 未手动选择时跟随系统深浅色切换
if(sysLight&&sysLight.addEventListener){
  sysLight.addEventListener('change',function(e){
    if(!localStorage.getItem(THEME_KEY))applyTheme(e.matches?'light':'dark');
  });
}
$('themeToggle').addEventListener('click',function(){
  var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
  localStorage.setItem(THEME_KEY,next);
  applyTheme(next);
});
function pad(n){return n<10?'0'+n:''+n;}
function fmtTime(ts){var d=new Date(ts);return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());}
function fmtBytes(n){
  if(n>=1073741824)return (n/1073741824).toFixed(2)+' GB';
  return (n/1048576).toFixed(1)+' MB';}
function fmtUptime(sec){
  sec=Math.floor(sec);
  var d=Math.floor(sec/86400),h=Math.floor(sec%86400/3600),m=Math.floor(sec%3600/60),s=sec%60;
  var hms=pad(h)+':'+pad(m)+':'+pad(s);
  return d>0?d+'天 '+hms:hms;}

function req(path,opts){
  opts=opts||{};
  opts.headers=opts.headers||{};
  opts.headers['x-admin-token']=token;
  if(opts.body)opts.headers['content-type']='application/json';
  return fetch(path,opts).then(function(r){
    if(r.status===401||r.status===403){throw {auth:true,status:r.status};}
    return r.json();
  });}

/* ===== 登录 ===== */
function showLogin(msg){
  $('login').classList.remove('hidden');
  $('app').classList.add('hidden');
  $('loginErr').textContent=msg||'';
  stopAll();
}
function stopAll(){
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  if(upTimer){clearInterval(upTimer);upTimer=null;}
  if(wsRetry){clearTimeout(wsRetry);wsRetry=null;}
  if(ws){try{ws.close();}catch(e){}ws=null;}
}
$('loginForm').addEventListener('submit',function(e){
  e.preventDefault();
  var t=$('tokenInput').value.trim();
  if(!t){$('loginErr').textContent='令牌不能为空';return;}
  token=t;
  req('/admin/metrics?history=1').then(function(data){
    localStorage.setItem(TOKEN_KEY,token);
    enter(data);
  }).catch(function(err){
    $('loginErr').textContent=(err&&err.auth)?'令牌无效或未授权':'连接失败，请检查服务状态';
  });
});
$('logout').addEventListener('click',function(){
  localStorage.removeItem(TOKEN_KEY);token='';
  showLogin('');
});

/* ===== 进入主界面 ===== */
function enter(metrics){
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  applyMetrics(metrics,true);
  pollTimer=setInterval(poll,2000);
  upTimer=setInterval(tickUptime,1000);
  req('/admin/rooms').then(function(d){if(d&&d.ok){rooms=d.rooms||[];renderRooms();}}).catch(function(){});
  fetchPlayers();
  req('/admin/console/logs?limit=300').then(function(d){
    if(d&&d.ok){clearLog();(d.lines||[]).forEach(function(l){appendServerLog(l);});}
  }).catch(function(){});
  connectWs();
}

function poll(){
  req('/admin/metrics').then(function(d){applyMetrics(d,false);}).catch(function(err){
    if(err&&err.auth)showLogin('令牌已失效，请重新登录');
  });
  // 玩家列表低频轮询（每 4 秒），房间变化时由 admin_update 即时触发刷新
  pollTick++;
  if(pollTick%2===0)fetchPlayers();
}

function fetchPlayers(){
  req('/admin/users').then(function(d){
    if(d&&d.ok){players=d.users||[];renderPlayers();}
  }).catch(function(){});
}

function applyMetrics(d,withHistory){
  if(!d||!d.ok)return;
  if(d.server){
    $('srvName').textContent=d.server.name||'Phira MP';
    document.title=(d.server.name||'Phira MP')+' · 服务端控制台';
  }
  $('srvSub').textContent='v'+((d.server&&d.server.version)||'-')+' · PID '+(d.process?d.process.pid:'-')
    +' · Node '+(d.process?d.process.nodeVersion:'-');
  if(d.cpu)cpuCores=d.cpu.cores||1;
  if(d.memory&&d.memory.systemTotal)sysTotal=d.memory.systemTotal;
  uptimeBase=d.process?d.process.uptime:0;uptimeAt=Date.now();
  tickUptime();
  if(d.business){
    $('cUsers').textContent=d.business.onlineUsers;
    $('cRooms').textContent=d.business.activeRooms;
    $('cSessions').textContent=d.business.activeSessions;
    $('cWs').textContent=d.business.wsConnections;
  }
  if(withHistory&&d.history&&d.history.length){samples=d.history.slice(-MAX_POINTS);}
  else if(d.memory&&d.cpu){
    samples.push({timestamp:d.timestamp,cpuPercent:d.cpu.percent,
      rss:d.memory.rss,heapUsed:d.memory.heapUsed,heapTotal:d.memory.heapTotal});
    if(samples.length>MAX_POINTS)samples.splice(0,samples.length-MAX_POINTS);
  }
  drawCharts();
}

function tickUptime(){
  if(!uptimeAt)return;
  $('uptime').textContent=fmtUptime(uptimeBase+(Date.now()-uptimeAt)/1000);
}

/* ===== 图表 ===== */
function drawSeries(canvas,arr,maxV,color,fixedMax){
  var dpr=window.devicePixelRatio||1;
  var w=canvas.clientWidth,h=canvas.clientHeight;
  if(!w||!h)return;
  if(canvas.width!==w*dpr||canvas.height!==h*dpr){canvas.width=w*dpr;canvas.height=h*dpr;}
  var ctx=canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  // 网格（颜色随主题）
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim()||'rgba(255,255,255,.05)';
  ctx.lineWidth=1;
  for(var gy=1;gy<4;gy++){var y=h*gy/4;ctx.beginPath();ctx.moveTo(0,y+.5);ctx.lineTo(w,y+.5);ctx.stroke();}
  if(arr.length<2)return;
  var mx=fixedMax||Math.max(maxV,1);
  var step=w/(MAX_POINTS-1);
  var x0=w-(arr.length-1)*step;
  ctx.beginPath();
  for(var i=0;i<arr.length;i++){
    var px=x0+i*step,py=h-Math.min(arr[i]/mx,1)*(h-6)-3;
    if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  }
  ctx.strokeStyle=color;ctx.lineWidth=1.5;
  ctx.shadowColor=color;ctx.shadowBlur=6;
  ctx.stroke();
  ctx.shadowBlur=0;
  ctx.lineTo(x0+(arr.length-1)*step,h);ctx.lineTo(x0,h);ctx.closePath();
  var grad=ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,color.replace(')',',.28)').replace('rgb','rgba'));
  grad.addColorStop(1,color.replace(')',',.02)').replace('rgb','rgba'));
  ctx.fillStyle=grad;ctx.fill();
}
function drawCharts(){
  var rss=samples.map(function(s){return s.rss;});
  var cpu=samples.map(function(s){return s.cpuPercent;});
  var maxRss=Math.max.apply(null,rss.concat([1]))*1.25;
  // 曲线颜色从 CSS 变量读取（RGB 三元组），随主题切换
  var cs=getComputedStyle(document.documentElement);
  var memColor='rgb('+(cs.getPropertyValue('--chart-mem').trim()||'63,220,151')+')';
  var cpuColor='rgb('+(cs.getPropertyValue('--chart-cpu').trim()||'88,196,220')+')';
  drawSeries($('memChart'),rss,maxRss,memColor);
  drawSeries($('cpuChart'),cpu,100,cpuColor,100);
  var last=samples[samples.length-1];
  if(last){
    $('memNow').textContent=fmtBytes(last.rss);
    $('memDetail').textContent='堆 '+fmtBytes(last.heapUsed)+' / '+fmtBytes(last.heapTotal)
      +(sysTotal?' · 系统 '+fmtBytes(sysTotal):'');
    $('cpuNow').textContent=last.cpuPercent.toFixed(1)+'%';
    $('cpuDetail').textContent=cpuCores+' 核';
  }
}
window.addEventListener('resize',drawCharts);

/* ===== WebSocket ===== */
function setConn(ok,text){
  $('connDot').classList.toggle('off',!ok);
  $('connText').textContent=text;
}
function connectWs(){
  var url=(location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';
  try{ws=new WebSocket(url);}catch(e){scheduleReconnect();return;}
  ws.onopen=function(){
    setConn(true,'已连接');
    ws.send(JSON.stringify({type:'console_subscribe',token:token}));
    ws.send(JSON.stringify({type:'admin_subscribe',token:token}));
  };
  ws.onmessage=function(ev){
    var msg;try{msg=JSON.parse(ev.data);}catch(e){return;}
    if(msg.type==='console_subscribed'){
      clearLog();(msg.data.lines||[]).forEach(function(l){appendServerLog(l);});
    }else if(msg.type==='console_log'){
      appendServerLog(msg.data);
    }else if(msg.type==='admin_update'){
      if(msg.data&&msg.data.changes&&msg.data.changes.rooms){
        rooms=msg.data.changes.rooms;renderRooms();fetchPlayers();
      }
    }else if(msg.type==='error'&&msg.message==='unauthorized'){
      showLogin('令牌已失效，请重新登录');
    }
  };
  ws.onclose=function(){setConn(false,'重连中…');scheduleReconnect();};
  ws.onerror=function(){try{ws.close();}catch(e){}};
}
function scheduleReconnect(){
  if(wsRetry||!token||!$('login').classList.contains('hidden'))return;
  wsRetry=setTimeout(function(){wsRetry=null;connectWs();},3000);
}

/* ===== 控制台 ===== */
function logNearBottom(){
  var el=$('log');
  return el.scrollHeight-el.scrollTop-el.clientHeight<48;
}
function trimLog(){
  var el=$('log');
  while(el.childNodes.length>MAX_LOG_DOM)el.removeChild(el.firstChild);
}
function clearLog(){$('log').innerHTML='';}
function appendLine(html,cls){
  var el=$('log');
  var stick=logNearBottom();
  var div=document.createElement('div');
  div.className='ll'+(cls?' '+cls:'');
  div.innerHTML=html;
  el.appendChild(div);
  trimLog();
  if(stick)el.scrollTop=el.scrollHeight;
}
function appendServerLog(l){
  appendLine('<span class="t">['+fmtTime(l.timestamp)+']</span> <span class="lv lv-'+esc(l.level)+'">['
    +esc(l.level)+']</span> '+esc(l.message));
}
$('cmdForm').addEventListener('submit',function(e){
  e.preventDefault();
  var input=$('cmdInput');
  var cmd=input.value.trim();
  if(!cmd)return;
  input.value='';
  cmdHistory.push(cmd);histIdx=cmdHistory.length;
  appendLine('<span class="t">['+fmtTime(Date.now())+']</span> &gt; '+esc(cmd),'k-cmd');
  req('/admin/console/command',{method:'POST',body:JSON.stringify({command:cmd})})
    .then(function(d){
      if(d&&d.ok){(d.lines||[]).forEach(function(l){appendLine(esc(l.text),'k-'+l.kind);});}
      else appendLine(esc((d&&d.error)||'命令执行失败'),'k-error');
    })
    .catch(function(err){
      if(err&&err.auth)showLogin('令牌已失效，请重新登录');
      else appendLine('命令发送失败：服务不可达','k-error');
    });
});
$('cmdInput').addEventListener('keydown',function(e){
  if(e.key==='ArrowUp'){
    if(histIdx>0){histIdx--;this.value=cmdHistory[histIdx];e.preventDefault();}
  }else if(e.key==='ArrowDown'){
    if(histIdx<cmdHistory.length-1){histIdx++;this.value=cmdHistory[histIdx];}
    else{histIdx=cmdHistory.length;this.value='';}
    e.preventDefault();
  }
});

/* ===== 房间 / 玩家 ===== */
var ST_TEXT={select_chart:'选谱中',waiting_for_ready:'准备中',playing:'游戏中'};
var ST_CLS={select_chart:'st-select',waiting_for_ready:'st-ready',playing:'st-playing'};
function renderRooms(){
  var el=$('roomList');
  if(!rooms.length){el.innerHTML='<div class="empty">暂无房间</div>';return;}
  var html='';
  rooms.forEach(function(r){
    var st=r.state&&r.state.type?r.state.type:'select_chart';
    var flags='';
    if(r.locked)flags+='<span class="flag" title="已锁定">[锁]</span>';
    if(r.cycle)flags+='<span class="flag" title="循环模式">[循]</span>';
    if(r.live)flags+='<span class="flag" title="直播开启">[播]</span>';
    var users='';
    (r.users||[]).forEach(function(u){
      var cls='chip'+(u.is_host?' host':'')+(u.connected?'':' offline');
      var extra='';
      if(st==='playing'){
        if(u.aborted)extra=' ×';
        else if(u.finished)extra=' ✓';
      }
      users+='<span class="'+cls+'" title="ID '+u.id+'">'+esc(u.name)+extra+'</span>';
    });
    var mons='';
    (r.monitors||[]).forEach(function(m){
      mons+='<span class="chip'+(m.connected?'':' offline')+'" title="ID '+m.id+'">'+esc(m.name)+'</span>';
    });
    html+='<div class="room'+(openRooms[r.roomid]?' open':'')+'" data-rid="'+esc(r.roomid)+'">'
      +'<div class="room-head">'
      +'<span class="rid">'+esc(r.roomid)+'</span>'
      +'<span class="badge '+ST_CLS[st]+'">'+ST_TEXT[st]+'</span>'+flags
      +'<span class="room-cnt">'+r.current_users+'/'+r.max_users
      +(r.current_monitors?' +'+r.current_monitors+'观':'')+'</span>'
      +'</div>'
      +'<div class="room-body">'
      +'<div class="row"><span class="k">房主：</span>'+esc(r.host?r.host.name:'-')+'</div>'
      +(r.chart?'<div class="row"><span class="k">谱面：</span>'+esc(r.chart.name)+' <span class="k">#'+r.chart.id+'</span></div>':'')
      +'<div class="row"><span class="k">玩家：</span>'+(users||'<span class="k">无</span>')+'</div>'
      +(mons?'<div class="row"><span class="k">观战：</span>'+mons+'</div>':'')
      +'</div></div>';
  });
  el.innerHTML=html;
  el.querySelectorAll('.room-head').forEach(function(head){
    head.addEventListener('click',function(){
      var room=head.parentNode,rid=room.getAttribute('data-rid');
      room.classList.toggle('open');
      if(room.classList.contains('open'))openRooms[rid]=true;else delete openRooms[rid];
    });
  });
}
function renderPlayers(){
  var el=$('playerList');
  if(!players.length){el.innerHTML='<div class="empty">暂无玩家</div>';return;}
  var html='';
  players.forEach(function(u){
    var role=u.monitor?'观战':'玩家';
    if(!u.connected)role+='·离线';
    html+='<div class="player-row"><span class="pname">'+esc(u.name)+'</span>'
      +'<span class="pid">#'+u.id+'</span>'
      +(u.banned?'<span class="pban">已封禁</span>':'')
      +'<span class="prole">'+role+'</span>'
      +'<span class="proom'+(u.room?'':' lobby')+'">'+(u.room?esc(u.room):'大厅')+'</span></div>';
  });
  el.innerHTML=html;
}

/* ===== Tabs ===== */
$('tabRooms').addEventListener('click',function(){switchTab(true);});
$('tabPlayers').addEventListener('click',function(){switchTab(false);});
function switchTab(showRooms){
  $('tabRooms').classList.toggle('active',showRooms);
  $('tabPlayers').classList.toggle('active',!showRooms);
  $('roomList').classList.toggle('hidden',!showRooms);
  $('playerList').classList.toggle('hidden',showRooms);
}

/* ===== 启动 ===== */
if(token){
  req('/admin/metrics?history=1').then(enter).catch(function(err){
    showLogin((err&&err.auth)?'令牌已失效，请重新登录':'');
  });
}else{
  showLogin('');
}
})();
</script>
</body>
</html>
`;
