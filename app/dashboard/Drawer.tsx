"use client";
import { useEffect, useRef, type ReactNode } from "react";
export default function Drawer({close,children}:{close:()=>void;children:ReactNode}) {
 const ref=useRef<HTMLDivElement>(null);const closeRef=useRef(close);
 useEffect(()=>{closeRef.current=close;},[close]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";
  ref.current?.focus();
  function key(e:KeyboardEvent){
   if(e.key==="Escape"){e.preventDefault();closeRef.current();}
   if(e.key==="Tab"){
    const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')||[]).filter(n=>n.getClientRects().length>0);
    const first=nodes[0],last=nodes[nodes.length-1];
    if(!first){e.preventDefault();return;}
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===ref.current)){e.preventDefault();first.focus();}
   }
  }
  document.addEventListener("keydown",key);return()=>{document.removeEventListener("keydown",key);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <div className="nu-drawer-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><div className="nu-drawer" role="dialog" aria-modal="true" aria-label="Карточка задачи" tabIndex={-1} ref={ref}>{children}</div></div>;
}
