/**
 * Everything generated code may import as a "local" module.
 *
 * The react family MUST be here: generated code shares the shell's single React
 * instance or hooks blow up with an invalid-hook-call. All five come from the
 * shell's platform table (see tsdown.config.ts), so registering them costs no
 * bundle weight — it only republishes the instances we already received.
 *
 * We deliberately pre-register no component library. Anything else resolves
 * through the esm.sh fallback at compile time.
 */
import * as React from "react";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import { registerModules, registryImports } from "./registry.ts";

let installed = false;

/**
 * Installs a real `<script type="importmap">`.
 *
 * Compile-time rewriting only covers the code we generate. Packages pulled from
 * esm.sh arrive as already-compiled JS whose `import ... from "react"` survives
 * verbatim, and the browser resolves those bare specifiers against the document
 * import map alone — without it, any generated UI that uses a third-party
 * package dies on `Failed to resolve module specifier "react"`.
 *
 * It can only be installed once, and only before the first module resolution.
 */
function installDocumentImportMap(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // A host-owned map wins: overwriting it would break whoever installed it, and a
  // second map is ignored by the browser anyway.
  if (document.querySelector('script[type="importmap"]') !== null) {
    console.warn("[dsh-generative-ui] the shell already installs an import map; bare specifiers from esm.sh packages may not resolve");
    return;
  }
  const script = document.createElement("script");
  script.type = "importmap";
  script.textContent = JSON.stringify({ imports: registryImports() });
  document.head.prepend(script);
}

export function registerRuntimeModules(): void {
  registerModules({
    react: React,
    "react/jsx-runtime": ReactJsxRuntime,
    "react/jsx-dev-runtime": ReactJsxRuntime,
    "react-dom": ReactDom,
    "react-dom/client": ReactDomClient,
  });
  installDocumentImportMap();
}

export const hostReactVersion = React.version;
