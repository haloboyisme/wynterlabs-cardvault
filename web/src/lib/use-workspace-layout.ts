import {useEffect,useState} from 'react';
import {useAuth} from '../app/auth';
import {useBranding} from '../app/branding';
import {DASHBOARD_MODULES,normalizeWorkspaceLayout,readWorkspaceLayout,writeWorkspaceLayout,type WorkspaceLayout} from './workspace-layout';
export function useWorkspaceLayout(){
 const {user}=useAuth();const{branding}=useBranding();const[personal,setPersonal]=useState(()=>readWorkspaceLayout(user?.id));
 useEffect(()=>{const update=()=>setPersonal(readWorkspaceLayout(user?.id));update();window.addEventListener('workspace-layout',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('workspace-layout',update);window.removeEventListener('storage',update);};},[user?.id]);
 const site=normalizeWorkspaceLayout(branding.design?.workspace);
 site.hiddenModules=[...new Set([...site.hiddenModules,...DASHBOARD_MODULES.filter(id=>branding.design?.[`dashboard_${id}`]===false)])];
 return {layout:personal??site,personal,site,save:(v:WorkspaceLayout|null)=>writeWorkspaceLayout(v,user?.id),userId:user?.id};
}
