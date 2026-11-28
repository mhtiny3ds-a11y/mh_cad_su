declare module 'libredwg-wasm/libredwg-web.js' {
  const createModule: (opts?: object) => Promise<unknown>;
  export default createModule;
}
declare module 'libredwg-wasm/libredwg-web.wasm?url' {
  const url: string;
  export default url;
}
