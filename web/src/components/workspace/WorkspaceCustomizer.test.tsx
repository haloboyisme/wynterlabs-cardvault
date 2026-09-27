import {render,screen,fireEvent} from '@testing-library/react';
import {useState} from 'react';
import {it,expect} from 'vitest';
import {WorkspaceCustomizer} from './WorkspaceCustomizer';
import {normalizeWorkspaceLayout} from '../../lib/workspace-layout';
function Demo(){const[value,setValue]=useState(normalizeWorkspaceLayout(null));return <><WorkspaceCustomizer value={value} onChange={setValue}/><output>{JSON.stringify(value)}</output></>}
it('reorders, hides and restores panels without dropping any',()=>{
 render(<Demo/>);fireEvent.click(screen.getByRole('button',{name:'Move Top sets up'}));
 expect(screen.getByRole('list').children[2]).toHaveTextContent('Top sets');
 fireEvent.click(screen.getByLabelText('Value history'));expect(screen.getByLabelText('Value history')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'Restore all dashboard panels'}));expect(screen.getByLabelText('Value history')).toBeChecked();
 expect(screen.getByRole('list').children.length).toBe(5);
});
