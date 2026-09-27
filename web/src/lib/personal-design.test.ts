import {it,expect,beforeEach,vi} from 'vitest';
import {brandDesign} from './brand-design';
import {effectiveBrandDesign,applyPersonalLook} from './personal-design';
import {presetDesign} from './workspace-presets';
beforeEach(()=>localStorage.clear());
it('preserves personal background when choosing and exporting a preset',()=>{
 localStorage.setItem('wynterlabs.background.v277.u',JSON.stringify({preset:'anime',upload:'',still:'',opacity:.5,position:'top',size:'cover'}));
 const current=effectiveBrandDesign(brandDesign(), 'u');
 expect(current.background.preset).toBe('anime');
 expect(applyPersonalLook(presetDesign('paper',current),'u')).toBe(true);
 expect(JSON.parse(localStorage.getItem('wynterlabs.background.v277.u')!).preset).toBe('anime');
});
it('does not partially change the look when browser storage fails',()=>{
 localStorage.setItem('wynterlabs.background.v277.u',JSON.stringify({preset:'magic'}));
 const before={...localStorage};const set=Storage.prototype.setItem;let calls=0;
 const spy=vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,v){if(++calls===2)throw Error('full');set.call(this,k,v)});
 expect(applyPersonalLook(brandDesign(),'u')).toBe(false);spy.mockRestore();expect({...localStorage}).toEqual(before);
});
