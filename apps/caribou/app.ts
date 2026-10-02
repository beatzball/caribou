// The client entry. It installs Lit's hydration support, then loads the app.
//
// LitElement looks for the hydration support exactly once: when its own
// module runs. If it finds none, it is never patched, and every
// server-rendered element renders a second copy of itself next to its server
// markup instead of hydrating it.
//
// So the support must run before the module that defines LitElement, and a
// first-line import does not guarantee that. The bundler moves LitElement
// into a shared chunk, the entry imports that chunk statically, and a static
// import runs before the body of the module that imports it — the body is
// where the support ends up.
//
// The dynamic import below is the guarantee: nothing this file loads
// statically can reach LitElement, so the app, and LitElement with it, runs
// only after this file's body has run. Do not add a static import here.
import '@lit-labs/ssr-client/lit-element-hydrate-support.js'

void import('./app-main.js')
