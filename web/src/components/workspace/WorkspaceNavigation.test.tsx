import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {it,expect,vi} from 'vitest';
import {WorkspaceNavigation} from './WorkspaceNavigation';
it('keeps all destinations and gates administration',()=>{
 const {rerender}=render(<MemoryRouter><WorkspaceNavigation admin={false} restricted={false} onSignOut={vi.fn()}/></MemoryRouter>);
 expect(screen.getByRole('link',{name:/Custom Card Import/})).toHaveAttribute('href','/custom-card-import');
 expect(screen.getByRole('link',{name:/Scan/})).toHaveAttribute('href','/scan');
 expect(screen.queryByRole('link',{name:/Admin/})).not.toBeInTheDocument();
 rerender(<MemoryRouter><WorkspaceNavigation admin restricted onSignOut={vi.fn()}/></MemoryRouter>);
 expect(screen.queryByRole('link',{name:/Collection/})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Account/})).toBeInTheDocument();
});
