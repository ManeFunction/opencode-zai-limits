/**
 * Minimal ambient types for the TUI part, used only by `npm run typecheck`
 * (tsconfig.tui.json). At runtime OpenCode maps `solid-js` and
 * `@opentui/solid` to its own copies; installing them here would pull in
 * their native dependency tree just for types. Only the surface tui.tsx
 * uses is declared.
 */

declare module 'solid-js' {
  export type Accessor<T> = () => T
  export type Setter<T> = (value: T) => T
  export function createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  export function For<T>(props: { each: readonly T[]; children: (item: T) => JSX.Element }): JSX.Element
  export function Show<T>(props: { when: T; fallback?: JSX.Element; children: JSX.Element }): JSX.Element
}

declare module '@opentui/solid' {
  export interface KeyEvent {
    name?: string
  }
  export const useKeyboard: ((handler: (key: KeyEvent) => void) => void) | undefined
}

// OpenTUI's intrinsic elements (<box>, <text>, <scrollbox>, <b>, …) are not
// modelled: their props are checked by OpenCode's runtime, not here.
declare namespace JSX {
  type Element = unknown
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>
  }
  interface ElementChildrenAttribute {
    children: unknown
  }
}
