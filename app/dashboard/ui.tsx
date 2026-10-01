import type { CSSProperties } from "react";
export type IconName = "home"|"tasks"|"mine"|"repeat"|"calendar"|"team"|"bell"|"search"|"plus"|"arrow"|"check"|"clock"|"alert"|"logout"|"menu"|"close"|"send"|"wallet";
const paths: Record<IconName,string[]> = {
 home:["m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z","M9 21v-8h6v8"],
 tasks:["M8 4H5a1 1 0 0 0-1 1v15h16V5a1 1 0 0 0-1-1h-3","M8 2h8v5H8Z","m8 13 2 2 5-5","M8 18h8"],
 mine:["M9 3H5v18h14V3h-4","M9 2h6v4H9Z","m8 12 2 2 5-5","M8 18h7"],
 repeat:["M20 7a9 9 0 0 0-15-2L2 8","M2 3v5h5","M4 17a9 9 0 0 0 15 2l3-3","M22 21v-5h-5"],
 calendar:["M3 5h18v16H3Z","M7 2v6m10-6v6M3 11h18","M7 15h2m3 0h2m3 0h1M7 18h2m3 0h2"],
 team:["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0","M17 3a4 4 0 0 1 0 8m3 10v-2a4 4 0 0 0-3-4"],
 bell:["M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9","M10 21h4"],
 search:["M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0","m15 15 6 6"],plus:["M12 5v14M5 12h14"],arrow:["M5 12h14m-5-5 5 5-5 5"],check:["m5 12 4 4L19 6"],clock:["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0","M12 7v5l3 2"],alert:["m12 3 10 18H2Z","M12 9v5m0 3v.5"],logout:["M9 3H3v18h6","M8 12h13m-4-4 4 4-4 4"],menu:["M4 6h16M4 12h16M4 18h16"],close:["m6 6 12 12M6 18 18 6"],send:["m22 2-7 20-4-9-9-4Z","m22 2-11 11"],wallet:["M20 8V4H4a2 2 0 0 0 0 4h17v13H4a2 2 0 0 1-2-2V6","M21 12h-6v5h6"]
};
export function Icon({name,size=20}:{name:IconName;size?:number}) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name].map((d,i)=><path d={d} key={i}/>)}</svg>; }
export function Avatar({name,small=false}:{name:string;small?:boolean}) { const hue=[...name].reduce((n,c)=>n+c.charCodeAt(0),0)%360; return <span className={`nu-avatar ${small?"nu-avatar-sm":""}`} style={{"--avatar-bg":`hsl(${hue} 35% 91%)`,"--avatar-fg":`hsl(${hue} 35% 30%)`} as CSSProperties}>{name.trim().split(/\s+/).slice(0,2).map(s=>s[0]).join("")||"НУ"}</span>; }
export function Brand() {return <div className="nu-brand" aria-label="Не Усложняй"><span>НЕ</span><span><b>У</b>СЛОЖНЯЙ<span className="nu-brand-dot">.</span></span></div>;}
