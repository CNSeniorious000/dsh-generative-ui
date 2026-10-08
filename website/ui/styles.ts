/**
 * The page's hand-written CSS: keyframes, the syntax palette and the cursor's sparks. Everything
 * else is UnoCSS classes. Every entrance is a short rise-and-fade on one curve, and every one of
 * them collapses to an opacity change under reduced motion.
 */
export const CSS = `
:root{color-scheme:dark}
html,body{background:#0e0e10}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.dsh-frame{--dsw-alias-label-primary-inverted:#151517;box-shadow:0 40px 120px -40px #7aaaff26}
@keyframes ui4a-rise{from{opacity:0;transform:translateY(8px)}}
@keyframes ui4a-fade{from{opacity:0}}
@keyframes ui4a-leave{to{opacity:0;transform:translateY(-12px)}}
@keyframes ui4a-blink{50%{opacity:0}}
@keyframes ui4a-pulse{50%{opacity:.45}}
@keyframes ui4a-spark{from{opacity:1;transform:rotate(var(--a)) translateX(6px) scaleX(1)}to{opacity:0;transform:rotate(var(--a)) translateX(20px) scaleX(.3)}}
.ui4a-rise{animation:ui4a-rise .5s cubic-bezier(.2,.8,.2,1) both}
.ui4a-fade,.ui4a-sessions>*{animation:ui4a-fade .4s cubic-bezier(.2,.8,.2,1) both}
.ui4a-leave{animation:ui4a-leave .42s cubic-bezier(.4,0,.6,1) both}
.ui4a-pulse{animation:ui4a-pulse 1.4s ease-in-out infinite}
.ui4a-caret{display:inline-block;width:2px;height:1.05em;margin-left:1px;vertical-align:-.15em;background:#7aaaff;animation:ui4a-blink 1s steps(1) infinite}
.ui4a-caret-lg{width:.06em;margin-left:.04em}
.ui4a-canvas{transition:width .6s cubic-bezier(.2,.9,.25,1),border-color .6s}
.ui4a-pointer{will-change:transform,opacity;transform-origin:3px 2px}
.ui4a-spark{position:absolute;z-index:19;width:9px;height:2px;margin:1px 0 0 2px;border-radius:2px;background:#7aaaff;pointer-events:none;transform-origin:0 50%;animation:ui4a-spark .42s cubic-bezier(.2,.8,.2,1) forwards}
.ui4a-card{container-type:inline-size}
.ui4a-scroll{scrollbar-width:thin;scrollbar-color:#ffffff1f transparent;overscroll-behavior:contain}
.hl-k{color:#c792ea}.hl-s{color:#a5d6a7}.hl-t{color:#7aaaff}.hl-c{color:#81858c;font-style:italic}.hl-n{color:#f78c6c}.hl-f{color:#ffcb6b}
@media (prefers-reduced-motion:reduce){
  .ui4a-rise,.ui4a-leave,.ui4a-fade,.ui4a-sessions>*{animation-name:none}
  .ui4a-caret,.ui4a-pulse{animation:none}
  .ui4a-canvas{transition:none}
}
`;
