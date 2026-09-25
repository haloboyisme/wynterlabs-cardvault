import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useScanExitWarning} from './exit-warning';
function Guard({active=true}:{active?:boolean}){useScanExitWarning(active);return null;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('Cancel prevents collection navigation; OK allows it',()=>{
 const next=vi.fn();const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<><Guard/><a href='/collection' onClick={e=>{e.preventDefault();next();}}>Collection</a></>);
 fireEvent.click(screen.getByText('Collection'));expect(confirm).toHaveBeenCalledOnce();expect(next).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByText('Collection'));expect(next).toHaveBeenCalledOnce();
});
it('multiple active owners warn once and protect until all finish',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 const ui=(a:boolean,b:boolean)=><><Guard active={a}/><Guard active={b}/><a href='/collection' onClick={e=>e.preventDefault()}>Collection</a></>;
 const {rerender}=render(ui(true,true));fireEvent.click(screen.getByText('Collection'));expect(confirm).toHaveBeenCalledOnce();
 rerender(ui(false,true));const closing=new Event('beforeunload',{cancelable:true});window.dispatchEvent(closing);expect(closing.defaultPrevented).toBe(true);
 rerender(ui(false,false));fireEvent.click(screen.getByText('Collection'));expect(confirm).toHaveBeenCalledOnce();
 const safe=new Event('beforeunload',{cancelable:true});window.dispatchEvent(safe);expect(safe.defaultPrevented).toBe(false);
});
it('same-page anchors and new tabs leave the scanner intact',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<><Guard/><a href='#details' onClick={e=>e.preventDefault()}>Details</a><a href='/collection' target='_blank' onClick={e=>e.preventDefault()}>New tab</a></>);
 fireEvent.click(screen.getByText('Details'));fireEvent.click(screen.getByText('New tab'));expect(confirm).not.toHaveBeenCalled();
});
