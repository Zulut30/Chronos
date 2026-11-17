// chronos: dev-mode twin of jsxRuntime.ts for "react/jsx-dev-runtime".
import { Fragment, jsxDEV as reactJsxDEV } from "react/jsx-dev-runtime";

import { localizeElementProps } from "./localizeElement";

type JsxDev = typeof reactJsxDEV;

export { Fragment };

export const jsxDEV: JsxDev = (type, props, key, isStatic, source, self) =>
  reactJsxDEV(type, localizeElementProps(type, props) as typeof props, key, isStatic, source, self);
