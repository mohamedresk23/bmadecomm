/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AdminShell } from './admin-shell';
import { staffNavigation } from '../../../modules/identity/application/staff-navigation';
import { isAdminRouteActive } from './admin-navigation';

let pathname = '/admin';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
beforeEach(() => {
  pathname = '/admin';
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function shell(roles = ['owner']) { return render(<AdminShell items={staffNavigation(roles)}><h1>محتوى الصفحة</h1></AdminShell>); }
describe('Admin shell navigation', () => {
  it('restores scroll and focus when resizing in either direction', () => {
    let resize = () => {};
    const media = { matches: true, addEventListener: vi.fn((_event, callback) => { resize = callback; }), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', () => media);
    document.body.style.overflow = 'auto';
    shell();
    const desktopLink = screen.getByRole('link', { name: 'المنتجات' });
    desktopLink.focus();
    // Edge resets focus when CSS hides the sidebar before matchMedia dispatch.
    desktopLink.blur();
    expect(document.activeElement).toBe(document.body);
    media.matches = false; act(() => resize());
    const opener = screen.getByRole('button', { name: 'فتح القائمة' });
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    expect(document.body.style.overflow).toBe('hidden');
    media.matches = true; act(() => resize());
    expect(document.querySelector('dialog')!.open).toBe(false);
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'طي القائمة' }));
    document.body.style.overflow = '';
  });
  it('dismisses backdrop clicks while leaving internal padding open', () => {
    document.body.style.overflow = 'scroll';
    shell(); fireEvent.click(screen.getByRole('button', { name: 'فتح القائمة' }));
    const dialog = document.querySelector('dialog')!;
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 0, bottom: 700 } as DOMRect);
    fireEvent.click(dialog, { clientX: 120, clientY: 30 });
    expect(dialog.open).toBe(true);
    fireEvent.click(dialog, { clientX: 50, clientY: 30 });
    expect(dialog.open).toBe(false);
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });
  it('shows only authorized routes and Arabic labels', () => {
    shell(['support']);
    expect(screen.getAllByRole('link', { name: 'أمان الحساب' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'إعدادات المتجر' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'المنتجات' })).toBeNull();
  });
  it('matches root exactly and children at a segment boundary', () => {
    expect(isAdminRouteActive('/admin', '/admin')).toBe(true);
    expect(isAdminRouteActive('/admin/security', '/admin')).toBe(false);
    expect(isAdminRouteActive('/admin/catalog/products/123', '/admin/catalog/products')).toBe(true);
    expect(isAdminRouteActive('/admin/catalog/products-other', '/admin/catalog/products')).toBe(false);
    pathname = '/admin/catalog/products/123'; shell();
    expect(screen.getAllByRole('link', { name: 'المنتجات' }).every(link => link.getAttribute('aria-current') === 'page')).toBe(true);
  });
  it('collapses without removing accessible navigation names', () => {
    shell(); fireEvent.click(screen.getByRole('button', { name: 'طي القائمة' }));
    expect(screen.getByRole('button', { name: 'توسيع القائمة' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('link', { name: 'المنتجات' })).toHaveLength(1);
  });
  it('closes on Escape and same-route selection, restoring opener focus', () => {
    shell(); const opener = screen.getByRole('button', { name: 'فتح القائمة' });
    fireEvent.click(opener);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'إغلاق القائمة' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(dialog.querySelector('a[href="/admin"]')!);
    expect(dialog.open).toBe(false); expect(document.activeElement).toBe(opener);
  });
});

