import { createContext, useContext } from "react";

/** A screen pushed on top of a tab's root. */
export type Screen = { kind: "client"; id: number } | { kind: "project"; id: number };

/** Pushes inside the current tab, never another one. */
export const Nav = createContext<{ push: (screen: Screen) => void }>({ push: () => {} });
export const useNav = () => useContext(Nav);
