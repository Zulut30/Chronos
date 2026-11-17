// chronos: stands in for "react/jsx-runtime" in the web app's own modules (vitePlugin.ts) and
// localizes element props on the way through. Imports here resolve to React's real runtime.
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";

import { localizeElementProps } from "./localizeElement";

type Jsx = typeof reactJsx;

export { Fragment };

export const jsx: Jsx = (type, props, key) =>
  reactJsx(type, localizeElementProps(type, props) as typeof props, key);

export const jsxs: Jsx = (type, props, key) =>
  reactJsxs(type, localizeElementProps(type, props) as typeof props, key);
