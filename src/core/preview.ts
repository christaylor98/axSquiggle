import { avatarPath, esc, tlineCount } from './exporters';
import { bounds, type Box } from './geom';
import { classify, type El } from './semantics';
import { linkable } from './links';
import { frameSize, type Board, type Frame, type Shape } from './types';

/**
 * A realistic preview of the whole board: every frame is rebuilt from what its shapes MEAN (a button is a real button, an input a real
 * input, a card a card), dressed in a chosen style, shown inside a phone or browser, with working links. One offline HTML file.
 * The style can be changed live in the preview (S), so the file doubles as a "which look do we like" tool.
 */

export interface PreviewStyle { name: string; label: string; vars: Record<string, string> }

export const PREVIEW_STYLES: PreviewStyle[] = [
  { name: 'clean', label: 'Clean (iOS-like)', vars: { font: "-apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif", bg: '#f2f2f7', surface: '#ffffff', ink: '#111114', mute: '#6b6b74', line: '#dcdce2', accent: '#007aff', 'accent-ink': '#ffffff', 'head-bg': 'rgba(249,249,251,.96)', 'head-ink': '#111114', side: '#ececf1', r: '14px', br: '12px', shadow: '0 1px 3px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.06)', 'in-bg': '#ffffff', chrome: '#d9d9de' } },
  { name: 'material', label: 'Material', vars: { font: "Roboto, 'Segoe UI', system-ui, sans-serif", bg: '#fef7ff', surface: '#ffffff', ink: '#1d1b20', mute: '#625b71', line: '#cac4d0', accent: '#6750a4', 'accent-ink': '#ffffff', 'head-bg': '#6750a4', 'head-ink': '#ffffff', side: '#f3edf7', r: '16px', br: '999px', shadow: '0 1px 2px rgba(0,0,0,.2),0 2px 6px rgba(0,0,0,.12)', 'in-bg': '#fffbfe', chrome: '#e7e0ec' } },
  { name: 'dark', label: 'Dark', vars: { font: "Inter, 'Segoe UI', system-ui, sans-serif", bg: '#121316', surface: '#1e2025', ink: '#f1f1f4', mute: '#9a9ea8', line: '#2e3138', accent: '#4f8cff', 'accent-ink': '#ffffff', 'head-bg': '#1a1c20', 'head-ink': '#f1f1f4', side: '#17191d', r: '12px', br: '10px', shadow: '0 1px 2px rgba(0,0,0,.5),0 6px 18px rgba(0,0,0,.35)', 'in-bg': '#16181c', chrome: '#2a2d33' } },
  { name: 'brand', label: 'Bold brand', vars: { font: "Inter, 'Segoe UI', system-ui, sans-serif", bg: '#ffffff', surface: '#ffffff', ink: '#0b132b', mute: '#5c6477', line: '#dfe3ea', accent: '#e8590c', 'accent-ink': '#ffffff', 'head-bg': '#0b132b', 'head-ink': '#ffffff', side: '#f3f5f9', r: '8px', br: '6px', shadow: '0 2px 6px rgba(11,19,43,.10),0 8px 24px rgba(11,19,43,.08)', 'in-bg': '#ffffff', chrome: '#dfe3ea' } },
  { name: 'minimal', label: 'Minimal mono', vars: { font: "'Helvetica Neue', Helvetica, Arial, sans-serif", bg: '#fafafa', surface: '#ffffff', ink: '#222222', mute: '#777777', line: '#dddddd', accent: '#222222', 'accent-ink': '#ffffff', 'head-bg': '#ffffff', 'head-ink': '#222222', side: '#f0f0f0', r: '4px', br: '3px', shadow: 'none', 'in-bg': '#ffffff', chrome: '#e6e6e6' } },
];

const n1 = (v: number) => Math.round(v * 10) / 10;
const box = (b: Box) => `left:${n1(b.x)}px;top:${n1(b.y)}px;width:${n1(b.w)}px;height:${n1(b.h)}px`;

/** The label's lines: the first is the label, indented lines after it are muted sub-lines. */
function lines(s: string): string {
  return s.split('\n').filter((l, i) => l.trim() || i === 0).map((l, i) => (i > 0 && /^[ \t]+\S/.test(l) ? `<small>${esc(l.trim())}</small>` : `<span>${esc(l.trim())}</span>`)).join('');
}

const PERSON = (b: Box) => `<svg viewBox="0 0 ${n1(b.w)} ${n1(b.h)}" width="100%" height="100%"><path d="${avatarPath(0, 0, b.w, b.h)}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const PICTURE = '<svg viewBox="0 0 48 32" class="ph"><path d="M2 30 16 14l9 10 6-7 15 13z" fill="currentColor" opacity=".35"/><circle cx="36" cy="8" r="4" fill="currentColor" opacity=".35"/></svg>';

function frameHTML(f: Frame, fi: number, all: Board): string {
  const { w, h } = frameSize(f);
  const c = classify(f);
  const sh = f.shapes;
  const target = (s: Shape): string => {
    if (!linkable(s) || !s.link) return '';
    const to = all.frames.findIndex((g) => g.id === s.link);
    return to >= 0 ? ` data-to="${to + 1}" tabindex="0"` : '';
  };
  const rot = (s: Shape) => ('rot' in s && s.rot ? `;transform:rotate(${s.rot}deg)` : '');
  const out: string[] = [];

  const label = (e: El, cls: string) => {
    if (e.labelIdx === null) return;
    const t = sh[e.labelIdx];
    if (t.k !== 'text') return;
    const b = bounds(t);
    out.push(`<div class="t ${cls}${target(sh[e.i]) ? ' go' : ''}"${target(sh[e.i])} style="left:${n1(b.x)}px;top:${n1(b.y)}px;${t.wrap ? `width:${n1(t.wrap)}px;` : 'white-space:nowrap;'}${t.al ? `text-align:${t.al};` : ''}">${lines(t.s)}</div>`);
  };

  for (const e of c.els) {
    const s = sh[e.i], b = bounds(s), tg = target(s), go = tg ? ' go' : '';
    switch (e.role) {
      case 'Header': out.push(`<div class="e header${go}"${tg} style="${box(b)}${rot(s)}"></div>`); label(e, 'lbl-header'); break;
      case 'Sidebar': out.push(`<div class="e side${go}"${tg} style="${box(b)}"></div>`); label(e, 'lbl-side'); break;
      case 'Card': out.push(`<div class="e card${s.k === 'rect' && s.grp ? ' grp' : ''}${go}"${tg} style="${box(b)}${rot(s)}"></div>`); label(e, 'lbl-card'); break;
      case 'List item': out.push(`<div class="e item${go}"${tg} style="${box(b)}">${tg ? '<i>›</i>' : ''}</div>`); label(e, 'lbl-item'); break;
      case 'Button': {
        const t = e.labelIdx !== null && sh[e.labelIdx].k === 'text' ? (sh[e.labelIdx] as { s: string }).s : e.label;
        out.push(`<button class="e btn${s.k === 'rect' && s.sm ? ' sm' : ''}${go}"${tg} style="${box(b)}${rot(s)}">${esc(t.split('\n')[0].trim())}</button>`);
        break;
      }
      case 'Input': {
        const multi = b.h > 64;
        out.push(multi ? `<textarea class="e inp" style="${box(b)}" placeholder="${esc(e.hint)}"></textarea>` : `<input class="e inp" style="${box(b)}" placeholder="${esc(e.hint)}">`);
        label(e, 'lbl-input');
        break;
      }
      case 'Checkbox': out.push(`<label class="e chk" style="${box(b)}"><input type="checkbox"></label>`); label(e, 'lbl-opt'); break;
      case 'Radio': out.push(`<label class="e chk" style="${box(b)}"><input type="radio" name="r${e.parent ?? 'x'}"></label>`); label(e, 'lbl-opt'); break;
      case 'Avatar': out.push(`<div class="e avatar${go}"${tg} style="${box(b)}">${PERSON(b)}</div>`); label(e, 'lbl-cap'); break;
      case 'Circle': out.push(`<div class="e dot${go}"${tg} style="${box(b)}"></div>`); label(e, 'lbl-dot'); break;
      case 'Image': {
        const inner = s.k === 'img' && s.src ? `<img src="${esc(s.src)}" alt="">` : PICTURE;
        out.push(`<div class="e img${go}"${tg} style="${box(b)}${rot(s)}">${inner}</div>`);
        label(e, 'lbl-cap');
        break;
      }
      case 'Paragraph': {
        if (s.k !== 'tlines') break;
        if (s.s) out.push(`<p class="e para${go}"${tg} style="${box(b)};text-align:${s.al ?? 'left'};${s.av === 'bottom' ? 'display:flex;align-items:flex-end;' : s.av === 'middle' ? 'display:flex;align-items:center;' : ''}"><span>${esc(s.s)}</span></p>`);
        else {
          const n = tlineCount(s.h);
          out.push(`<div class="e skel" style="${box(b)}">${Array.from({ length: n }, (_, i) => `<b style="width:${i === n - 1 && n > 1 ? 60 : 100}%"></b>`).join('')}</div>`);
        }
        break;
      }
      case 'Text': {
        if (s.k !== 'text') break;
        const bb = bounds(s);
        out.push(`<div class="t body${s.ghost ? ' ghost' : ''}${go}"${tg} style="left:${n1(bb.x)}px;top:${n1(bb.y)}px;${s.wrap ? `width:${n1(s.wrap)}px;` : 'white-space:nowrap;'}${s.al ? `text-align:${s.al};` : ''}${rot(s)}">${lines(s.s)}</div>`);
        break;
      }
      case 'Divider': out.push(`<div class="e rule" style="${box({ x: b.x, y: b.y, w: Math.max(b.w, 1), h: Math.max(b.h, 1) })}"></div>`); break;
      default: break;   // arrows, connectors and sketches are notes to the designer, not part of the screen
    }
  }
  return `<section class="frame" data-i="${fi + 1}" data-w="${w}" data-h="${h}" data-phone="${f.device === 'phone' ? 1 : 0}" aria-label="Screen ${fi + 1}${f.caption ? ': ' + esc(f.caption) : ''}" style="width:${w}px;height:${h}px">${out.join('')}</section>`;
}

const CSS = `
*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:flex;flex-direction:column;background:#1b1c1f;color:#ddd;font:14px system-ui,sans-serif;overflow:hidden}
#bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#0f1012;color:#fff;flex-wrap:wrap}#bar b{font-weight:600}#cap{opacity:.7;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bar button,#bar select{font:inherit;color:#fff;background:#2a2c31;border:1px solid #444850;border-radius:6px;padding:3px 10px;cursor:pointer}#bar button:hover,#bar select:hover{border-color:#e8590c}
#stage{flex:1;min-height:0;position:relative;overflow:hidden}
#dev{position:absolute;left:50%;top:50%;transform-origin:0 0;background:var(--chrome);box-shadow:0 20px 60px rgba(0,0,0,.55)}
#dev.phone{border-radius:54px;padding:14px;background:#0b0b0d;box-shadow:0 0 0 2px #3a3b40,0 24px 70px rgba(0,0,0,.6)}
#dev.phone #top{height:46px;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 34px;font:600 15px system-ui;position:relative}
#dev.phone #top:before{content:"";position:absolute;left:50%;top:10px;width:110px;height:28px;margin-left:-55px;border-radius:20px;background:#000}
#dev.phone #top span:last-child{letter-spacing:2px;font-size:12px}
#dev.phone #scr{border-radius:0 0 40px 40px;overflow:hidden}
#dev.web{border-radius:12px;overflow:hidden;border:1px solid rgba(0,0,0,.25)}
#dev.web #top{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--chrome)}
#top i{width:12px;height:12px;border-radius:50%;background:#ff5f57;display:inline-block}#top i:nth-child(2){background:#febc2e}#top i:nth-child(3){background:#28c840}
#url{flex:1;margin-left:14px;height:26px;border-radius:13px;background:rgba(255,255,255,.55);color:#444;font:13px system-ui;display:flex;align-items:center;padding:0 14px;overflow:hidden;white-space:nowrap}
#dev.phone #url,#dev.phone #top i{display:none}#dev.web #clock,#dev.web #sig{display:none}
#scr{position:relative;background:var(--bg);color:var(--ink);font-family:var(--font);overflow:hidden}
.frame{position:absolute;left:0;top:0;display:none;background:var(--bg);overflow:hidden}.frame.on{display:block}
.frame.fwd{animation:fwd .28s ease}.frame.bak{animation:bak .28s ease}.frame.fade{animation:fade .22s ease}
@keyframes fwd{from{transform:translateX(40px);opacity:0}}@keyframes bak{from{transform:translateX(-40px);opacity:0}}@keyframes fade{from{opacity:0}}
.e,.t{position:absolute;margin:0}
.t{line-height:1.3;font-size:16px;color:var(--ink)}.t span{display:block}.t small{display:block;font-size:13px;color:var(--mute);margin-top:1px}
.t.body.ghost{color:var(--mute)}
.lbl-header{font-weight:650;font-size:18px;color:var(--head-ink)}.lbl-card{font-weight:650;font-size:17px}.lbl-side{font-weight:600;color:var(--mute);text-transform:none}
.lbl-item{font-size:16px}.lbl-input{font-size:13px;font-weight:600;color:var(--mute)}.lbl-opt{font-size:15px}.lbl-cap{font-size:13px;color:var(--mute)}.lbl-dot{font-weight:650;color:var(--accent-ink)}
.header{background:var(--head-bg);box-shadow:0 1px 0 var(--line),0 2px 10px rgba(0,0,0,.06)}
.side{background:var(--side);border-right:1px solid var(--line)}
.card{background:var(--surface);border-radius:var(--r);box-shadow:var(--shadow)}.card.grp{background:transparent;box-shadow:none;border:1px solid var(--line)}
.item{background:var(--surface);border-bottom:1px solid var(--line)}.item i{position:absolute;right:16px;top:50%;transform:translateY(-52%);font-style:normal;font-size:22px;color:var(--mute)}
.btn{border:0;border-radius:var(--br);background:var(--accent);color:var(--accent-ink);font:600 16px var(--font);padding:0 14px;cursor:default;box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .08s,filter .08s}
.btn.sm{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 1.5px var(--accent);font-size:14px}
.inp{border:1px solid var(--line);border-radius:calc(var(--br) * .8);background:var(--in-bg);color:var(--ink);font:16px var(--font);padding:0 12px;outline:0;resize:none}textarea.inp{padding:10px 12px}
.inp::placeholder{color:var(--mute);opacity:.8}.inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.chk{display:flex;align-items:center;justify-content:center}.chk input{width:100%;height:100%;margin:0;accent-color:var(--accent)}
.avatar{border-radius:50%;background:var(--side);color:var(--mute);overflow:hidden}
.dot{border-radius:50%;background:var(--accent)}
.img{background:linear-gradient(135deg,var(--side),var(--line));border-radius:calc(var(--r) * .7);color:var(--mute);display:flex;align-items:center;justify-content:center;overflow:hidden}.img img{width:100%;height:100%;object-fit:cover}.img .ph{width:34%;max-width:96px}
.para{color:var(--ink);font-size:15px;line-height:24px;overflow:hidden}.para span{display:block;width:100%;white-space:pre-wrap}
.skel b{display:block;height:9px;border-radius:5px;margin:0 0 11px;background:linear-gradient(90deg,var(--line) 25%,var(--side) 50%,var(--line) 75%);background-size:200% 100%;animation:sh 1.6s linear infinite}
@keyframes sh{to{background-position:-200% 0}}
.rule{background:var(--line)}
.go{cursor:pointer}.go:active{transform:scale(.97);filter:brightness(.93)}.go:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hint .go{outline:2px dashed #e8590c;outline-offset:2px}
#toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);background:#000c;color:#fff;padding:6px 14px;border-radius:999px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none}#toast.on{opacity:1}
@media(prefers-reduced-motion:reduce){.frame,.skel b{animation:none}}
`;

export function previewHTML(b: Board, title = 'Preview', style = PREVIEW_STYLES[0].name): string {
  const frames = b.frames.map((f, i) => frameHTML(f, i, b)).join('\n');
  const css = PREVIEW_STYLES.map((s) => `body[data-style="${s.name}"]{${Object.entries(s.vars).map(([k, v]) => `--${k}:${v}`).join(';')}}`).join('\n');
  const caps = JSON.stringify(b.frames.map((f) => f.caption || ''));
  const styles = JSON.stringify(PREVIEW_STYLES.map((s) => [s.name, s.label]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>${CSS}\n${css}</style></head><body data-style="${esc(style)}">
<div id="bar"><b>${esc(title)}</b><span id="cap"></span><button id="back" title="Back (Backspace)">&larr; Back</button><select id="jump" aria-label="Go to screen"></select><select id="sty" aria-label="Style (S)"></select><button id="h" title="Outline everything that can be tapped (H)">Show taps</button></div>
<main id="stage"><div id="dev" class="web"><div id="top"><i></i><i></i><i></i><span id="clock">9:41</span><div id="url"></div><span id="sig">●●●● ▮</span></div><div id="scr">${frames}</div></div><div id="toast"></div></main>
<script>
(function(){
var caps=${caps},styles=${styles},fr=[].slice.call(document.querySelectorAll('.frame')),dev=document.getElementById('dev'),scr=document.getElementById('scr'),st=document.getElementById('stage'),
jump=document.getElementById('jump'),sty=document.getElementById('sty'),cap=document.getElementById('cap'),url=document.getElementById('url'),toast=document.getElementById('toast'),cur=0,prev=-1,base=document.title,tt=0;
caps.forEach(function(c,i){var o=document.createElement('option');o.value=i+1;o.textContent=(i+1)+(c?'. '+c:'');jump.appendChild(o);});
styles.forEach(function(s){var o=document.createElement('option');o.value=s[0];o.textContent=s[1];sty.appendChild(o);});
try{var saved=localStorage.getItem('axsq-preview-style');if(saved&&styles.some(function(s){return s[0]===saved;}))document.body.dataset.style=saved;}catch(e){}
sty.value=document.body.dataset.style;
function say(t){toast.textContent=t;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('on');},1600);}
function fit(){var f=fr[cur],w=+f.dataset.w,h=+f.dataset.h,ph=f.dataset.phone==='1';dev.className=ph?'phone':'web';scr.style.width=w+'px';scr.style.height=h+'px';
var pad=ph?28:0,top=ph?46:40,dw=w+pad,dh=h+pad+top,k=Math.min((st.clientWidth-40)/dw,(st.clientHeight-30)/dh,1.6);
dev.style.transform='scale('+k+') translate(-50%,-50%)';}
function show(back){var n=parseInt(location.hash.slice(1),10);if(!(n>=1&&n<=fr.length))n=1;prev=cur;cur=n-1;
fr.forEach(function(f,i){f.classList.remove('on','fwd','bak','fade');if(i===cur){f.classList.add('on');void f.offsetWidth;f.classList.add(prev===cur?'fade':fr[cur].dataset.phone==='1'?(back?'bak':'fwd'):'fade');}});
jump.value=n;cap.textContent=caps[cur]||'';url.textContent='app.example/'+(caps[cur]||'screen-'+n).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
document.title=base+' \\u2013 '+n;fit();}
var goingBack=false;
function go(n,back){if(n>=1&&n<=fr.length){goingBack=!!back;location.hash='#'+n;}}
addEventListener('hashchange',function(){show(goingBack);goingBack=false;});addEventListener('resize',fit);
jump.onchange=function(){go(+jump.value,+jump.value<cur+1);};
sty.onchange=function(){document.body.dataset.style=sty.value;try{localStorage.setItem('axsq-preview-style',sty.value);}catch(e){}};
document.getElementById('back').onclick=function(){goingBack=true;history.length>1?history.back():go(1);};
function hint(){st.classList.toggle('hint');}
document.getElementById('h').onclick=hint;
scr.addEventListener('click',function(e){var t=e.target.closest('[data-to]');if(t){go(+t.dataset.to,false);return;}
if(e.target.closest('input,textarea,label,button'))return;st.classList.add('hint');setTimeout(function(){st.classList.remove('hint');},900);});
scr.addEventListener('keydown',function(e){if(e.key==='Enter'){var t=e.target.closest('[data-to]');if(t)go(+t.dataset.to,false);}});
addEventListener('keydown',function(e){var t=e.target.tagName;if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT')return;
if(e.key==='ArrowRight')go(cur+2,false);else if(e.key==='ArrowLeft')go(cur,true);else if(e.key==='Backspace'){e.preventDefault();goingBack=true;history.back();}
else if(e.key==='h'||e.key==='H')hint();
else if(e.key==='s'||e.key==='S'){var i=(styles.findIndex(function(s){return s[0]===document.body.dataset.style;})+1)%styles.length;sty.value=styles[i][0];sty.onchange();say(styles[i][1]);}});
show(false);
})();
</script></body></html>`;
}
