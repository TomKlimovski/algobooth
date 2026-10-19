// The Strudel packages ship plain .mjs without type declarations.
declare module '@strudel/core';
declare module '@strudel/mini';
declare module '@strudel/tonal';
declare module '@strudel/draw';
declare module '@strudel/webaudio';
declare module '@strudel/codemirror';
declare module '@strudel/transpiler';
// Tests import the bundles directly, so every package shares one Pattern class.
declare module '@strudel/core/dist/index.mjs';
declare module '@strudel/mini/dist/index.mjs';
declare module '@strudel/transpiler/dist/index.mjs';
