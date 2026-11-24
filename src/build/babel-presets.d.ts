// Neither Babel preset ships type declarations. The build passes them to
// Babel as opaque presets, so `unknown` is all the type it needs.
declare module '@babel/preset-typescript' {
  const preset: unknown;
  export default preset;
}
declare module 'babel-preset-solid' {
  const preset: unknown;
  export default preset;
}
