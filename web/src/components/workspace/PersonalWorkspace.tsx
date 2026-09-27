import {useEffect,useState} from 'react';
import {useBranding} from '../../app/branding';
import {brandDesign} from '../../lib/brand-design';
import {useWorkspaceLayout} from '../../lib/use-workspace-layout';
import {effectiveBrandDesign,applyPersonalLook} from '../../lib/personal-design';
import {presetDesign} from '../../lib/workspace-presets';
import {WorkspaceCustomizer} from './WorkspaceCustomizer';
import {WorkspacePresetTools} from './WorkspacePresetTools';
export function PersonalWorkspace(){
 const {branding}=useBranding();const{layout,personal,save,userId}=useWorkspaceLayout();const [message,setMessage]=useState('');const[,refresh]=useState(0);
 useEffect(()=>{const update=()=>refresh(v=>v+1);window.addEventListener('workspace-background',update);return()=>window.removeEventListener('workspace-background',update);},[]);
 const design={...effectiveBrandDesign(brandDesign(branding.design),userId),workspace:layout};
 function apply(next:typeof design){setMessage(applyPersonalLook(next,userId)?'Your look is saved for this account in this browser. Text size, contrast and motion settings stay unchanged.':'Could not save this look. Your previous settings were kept. Check browser storage.');}
 return <section className="personal-workspace" aria-label="Workspace customization"><header><p className="eyebrow">Your space, your way</p><h2>Workspace designer</h2><p>{personal?'Your personal layout is active.':'Following the site layout.'} Choose a style, then make it yours.</p></header><WorkspaceCustomizer value={layout} onChange={next=>{setMessage(save(next)?'Layout saved.':'Could not save this layout.');}} onPreset={id=>apply(presetDesign(id,design))}/><WorkspacePresetTools design={design} onChange={apply}/><button type="button" onClick={()=>setMessage(applyPersonalLook(null,userId)?'Following the site layout and design. All personal themes remain available below.':'Could not reset this browser. Your previous settings were kept.')}>Use site layout and design</button>{message&&<p role="status">{message}</p>}</section>;
}
