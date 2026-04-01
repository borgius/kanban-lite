import type { DrawerPosition } from './drawerResize'

export type { DrawerPosition } from './drawerResize'

const SLIDE_IN_CLASS: Record<DrawerPosition, string> = {
  right: 'animate-in slide-in-from-right duration-200',
  left: 'animate-in slide-in-from-left duration-200',
  top: 'animate-in slide-in-from-top duration-200',
  bottom: 'animate-in slide-in-from-bottom duration-200',
}

export function drawerContainerClass(pos: DrawerPosition): string {
  if (pos === 'right') return 'justify-end'
  if (pos === 'left') return 'justify-start'
  if (pos === 'top') return 'items-start'
  return 'items-end'
}

export function isHorizontalDrawer(pos: DrawerPosition): boolean {
  return pos === 'left' || pos === 'right'
}

export function drawerPanelClass(pos: DrawerPosition): string {
  const base = 'relative flex flex-col shadow-xl overflow-hidden pointer-events-auto card-view-shell card-view-shell--drawer'
  const slide = SLIDE_IN_CLASS[pos]
  const sizing = isHorizontalDrawer(pos) ? 'h-full' : 'w-full'
  return `${base} ${slide} ${sizing}`
}

export function drawerPanelStyle(pos: DrawerPosition, sizePercent: number, extra?: React.CSSProperties): React.CSSProperties {
  const borderProp: Record<DrawerPosition, string> = {
    right: 'borderLeft',
    left: 'borderRight',
    top: 'borderBottom',
    bottom: 'borderTop',
  }
  const sizeProp = isHorizontalDrawer(pos) ? 'width' : 'height'
  return {
    [sizeProp]: `${sizePercent}%`,
    [borderProp[pos]]: '1px solid var(--vscode-panel-border)',
    ...extra,
  }
}

export function boardShrinkStyle(pos: DrawerPosition, sizePercent: number): React.CSSProperties {
  switch (pos) {
    case 'right':
      return { width: `${100 - sizePercent}%` }
    case 'left':
      return { width: `${100 - sizePercent}%`, marginLeft: `${sizePercent}%` }
    case 'top':
      return { height: `${100 - sizePercent}vh`, marginTop: `${sizePercent}vh` }
    case 'bottom':
      return { height: `${100 - sizePercent}vh` }
  }
}

export function getSlideInClass(pos: DrawerPosition): string {
  return SLIDE_IN_CLASS[pos]
}

export const NEXT_POSITION: Record<DrawerPosition, DrawerPosition> = {
  right: 'bottom',
  bottom: 'left',
  left: 'top',
  top: 'right',
}
